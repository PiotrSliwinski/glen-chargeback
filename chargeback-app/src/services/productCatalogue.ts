import * as mappings from "@/dal/mappings";
import { getIntegrityViolations } from "@/dal/health";
import { DomainError } from "@/services/errors";

/**
 * Write-path business rules for data_product_mapping (Methodology §4.3, §10.5):
 *  - product keys are the tag vocabulary: lowercase, hyphen/underscore, no spaces
 *  - at most one active validity window per product, no overlaps; a window
 *    holds one row per desk (multi-desk split) with shares summing to 100%
 *  - desk/domain/split changes close the old rows and insert successors
 *    (never UPDATE in place — that would restate published history)
 *  - no deletes, ever; retirement = closing the validity window
 * Each write runs the scoped §7.4 checks as a post-condition.
 */

export const PRODUCT_KEY_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

/** One desk's slice of a product as submitted by the UI — pct in percent (0–100]. */
export interface DeskSplitInput {
  desk: string;
  pct: number;
}

/**
 * Validate a submitted split set and convert percentages to the 0–1
 * fractions stored in cost_split_pct. Shares must be positive, desks
 * unique, and the total 100% (±0.01pp) — otherwise cost_fact would mint
 * or lose money on every row of the product.
 */
export function normalizeSplits(splits: DeskSplitInput[]): mappings.DeskShare[] {
  if (splits.length === 0) {
    throw new DomainError("VALIDATION", "at least one desk share is required");
  }
  const seen = new Set<string>();
  for (const s of splits) {
    const desk = s.desk.trim();
    if (!desk) throw new DomainError("VALIDATION", "desk name must not be empty");
    if (seen.has(desk)) {
      throw new DomainError("VALIDATION", `desk '${desk}' appears more than once in the split`);
    }
    seen.add(desk);
    if (!Number.isFinite(s.pct) || s.pct <= 0 || s.pct > 100) {
      throw new DomainError("VALIDATION", `share for desk '${desk}' must be between 0 and 100%`);
    }
  }
  const total = splits.reduce((sum, s) => sum + s.pct, 0);
  if (Math.abs(total - 100) > 0.01) {
    throw new DomainError(
      "VALIDATION",
      `desk shares must sum to 100% — currently ${Number(total.toFixed(2))}%`,
    );
  }
  return splits.map((s) => ({ desk: s.desk.trim(), cost_split_pct: s.pct / 100 }));
}

/** All active rows of a product — one per desk of the current split. */
async function activeRows(product: string) {
  const rows = await mappings.listCatalogue();
  return rows.filter((r) => r.data_product === product && r.valid_to == null);
}

async function postCheck(product: string): Promise<void> {
  const violations = await getIntegrityViolations(product);
  if (violations.length > 0) {
    throw new DomainError(
      "CHECKS_FAILED",
      `write completed but integrity check failed — review the catalogue: ${violations
        .map((v) => v.detail)
        .join("; ")}`,
    );
  }
}

export async function createProduct(
  input: {
    data_product: string;
    data_domain: string;
    splits: DeskSplitInput[];
    product_owner: string | null;
    valid_from: string;
  },
  actor: string,
): Promise<void> {
  if (!PRODUCT_KEY_RE.test(input.data_product)) {
    throw new DomainError(
      "BAD_KEY_FORMAT",
      "product key must be lowercase alphanumeric with hyphens/underscores (it is the tag vocabulary), e.g. pricing-curves",
    );
  }
  const splits = normalizeSplits(input.splits);
  if ((await activeRows(input.data_product)).length > 0) {
    throw new DomainError("DUPLICATE_KEY", `product '${input.data_product}' already has an active row`);
  }
  // The new window must not overlap any historical window either.
  const history = (await mappings.listCatalogue()).filter(
    (r) => r.data_product === input.data_product,
  );
  for (const h of history) {
    if ((h.valid_to ?? "9999-12-31") > input.valid_from) {
      throw new DomainError(
        "OVERLAP",
        `product '${input.data_product}' has a historical window ending ${h.valid_to} — valid_from must be on or after that date`,
      );
    }
  }
  await mappings.insertProduct(
    {
      data_product: input.data_product,
      data_domain: input.data_domain,
      product_owner: input.product_owner,
      valid_from: input.valid_from,
      splits,
    },
    actor,
  );
  await postCheck(input.data_product);
}

export async function moveProduct(
  input: {
    data_product: string;
    cutover: string;
    new_domain: string;
    splits: DeskSplitInput[];
    new_owner: string | null;
  },
  actor: string,
): Promise<void> {
  const active = await activeRows(input.data_product);
  if (active.length === 0) {
    throw new DomainError("NOT_FOUND", `product '${input.data_product}' has no active row to move`);
  }
  const splits = normalizeSplits(input.splits);
  const windowStart = active.reduce((max, r) => (r.valid_from > max ? r.valid_from : max), active[0].valid_from);
  if (input.cutover <= windowStart) {
    throw new DomainError(
      "OVERLAP",
      `cutover ${input.cutover} must be after the active window's start ${windowStart}`,
    );
  }
  const sameDomain = active.every((r) => r.data_domain === input.new_domain);
  const sameSplit =
    active.length === splits.length &&
    splits.every((s) =>
      active.some((r) => r.desk === s.desk && Math.abs(r.cost_split_pct - s.cost_split_pct) < 1e-9),
    );
  if (sameDomain && sameSplit) {
    throw new DomainError("VALIDATION", "new domain and desk split are identical to the current ones");
  }
  await mappings.moveProduct(
    {
      data_product: input.data_product,
      cutover: input.cutover,
      new_domain: input.new_domain,
      new_owner: input.new_owner,
      splits,
    },
    actor,
  );
  await postCheck(input.data_product);
}

export async function retireProduct(
  data_product: string,
  valid_to: string,
  actor: string,
): Promise<void> {
  const active = await activeRows(data_product);
  if (active.length === 0) {
    throw new DomainError("NOT_FOUND", `product '${data_product}' has no active row`);
  }
  const windowStart = active.reduce((max, r) => (r.valid_from > max ? r.valid_from : max), active[0].valid_from);
  if (valid_to <= windowStart) {
    throw new DomainError("VALIDATION", `retirement date must be after ${windowStart}`);
  }
  const [jobs, warehouses, tagRules, runnerRules] = await Promise.all([
    mappings.listJobMappings(),
    mappings.listWarehouseMappings(),
    mappings.listTagRules(),
    mappings.listRunnerRules(),
  ]);
  const jobRefs = jobs.filter((j) => j.data_product === data_product).length;
  const whRefs = warehouses.filter((w) => w.data_product === data_product).length;
  const ruleRefs =
    tagRules.filter((r) => r.data_product === data_product).length +
    runnerRules.filter((r) => r.data_product === data_product).length;
  if (jobRefs + whRefs + ruleRefs > 0) {
    throw new DomainError(
      "REFERENCED",
      `product is still referenced by ${jobRefs} job mapping(s), ${whRefs} warehouse mapping(s) and ${ruleRefs} attribution rule(s) — remove or remap those first`,
    );
  }
  await mappings.retireProduct(data_product, valid_to, actor);
  await postCheck(data_product);
}

export async function updateProductOwner(
  data_product: string,
  product_owner: string | null,
  actor: string,
): Promise<void> {
  if ((await activeRows(data_product)).length === 0) {
    throw new DomainError("NOT_FOUND", `product '${data_product}' has no active row`);
  }
  await mappings.updateProductOwner(data_product, product_owner, actor);
}

/** A bridge row may only reference an existing catalogue product (§7.4(b)). */
export async function assertProductExists(data_product: string): Promise<void> {
  const rows = await mappings.listCatalogue();
  if (!rows.some((r) => r.data_product === data_product)) {
    throw new DomainError(
      "ORPHAN_PRODUCT",
      `'${data_product}' is not in the product catalogue — register it first`,
    );
  }
}
