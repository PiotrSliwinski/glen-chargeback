import * as mappings from "@/dal/mappings";
import { getIntegrityViolationsLive } from "@/dal/health";
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
  const violations = await getIntegrityViolationsLive(product);
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

/** Count bridge/rule rows still pointing at a product (§7.4(b) referents). */
async function countProductReferences(product: string) {
  const [jobs, warehouses, endpoints, tagRules, runnerRules] = await Promise.all([
    mappings.listJobMappings(),
    mappings.listWarehouseMappings(),
    mappings.listEndpointMappings(),
    mappings.listTagRules(),
    mappings.listRunnerRules(),
  ]);
  const jobRefs = jobs.filter((j) => j.data_product === product).length;
  const whRefs = warehouses.filter((w) => w.data_product === product).length;
  const epRefs = endpoints.filter((e) => e.data_product === product).length;
  const ruleRefs =
    tagRules.filter((r) => r.data_product === product).length +
    runnerRules.filter((r) => r.data_product === product).length;
  return { jobRefs, whRefs, epRefs, ruleRefs, total: jobRefs + whRefs + epRefs + ruleRefs };
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
  const refs = await countProductReferences(data_product);
  if (refs.total > 0) {
    throw new DomainError(
      "REFERENCED",
      `product is still referenced by ${refs.jobRefs} job mapping(s), ${refs.whRefs} warehouse mapping(s), ${refs.epRefs} endpoint mapping(s) and ${refs.ruleRefs} attribution rule(s) — remove or remap those first`,
    );
  }
  await mappings.retireProduct(data_product, valid_to, actor);
  await postCheck(data_product);
}

/** Does `r` belong to the validity window identified by (from, to)? */
function isWindow(from: string, to: string | null) {
  return (r: { valid_from: string; valid_to: string | null }) =>
    r.valid_from === from && (r.valid_to ?? null) === (to ?? null);
}

/**
 * Full in-place edit of one validity window (domain, desk split, owner and
 * the window's own dates). A correction tool — it rewrites the window rather
 * than versioning it (that is moveProduct's job). Validates the split, the
 * date order, and that the (possibly re-dated) window does not overlap
 * another window of the same product on the same desk (§7.4(a)).
 */
export async function editProductVersion(
  input: {
    data_product: string;
    old_valid_from: string;
    old_valid_to: string | null;
    data_domain: string;
    splits: DeskSplitInput[];
    product_owner: string | null;
    valid_from: string;
    valid_to: string | null;
  },
  actor: string,
): Promise<void> {
  const rows = (await mappings.listCatalogue()).filter((r) => r.data_product === input.data_product);
  if (rows.length === 0) {
    throw new DomainError("NOT_FOUND", `product '${input.data_product}' is not in the catalogue`);
  }
  const belongsToWindow = isWindow(input.old_valid_from, input.old_valid_to);
  if (!rows.some(belongsToWindow)) {
    throw new DomainError(
      "NOT_FOUND",
      `'${input.data_product}' has no version starting ${input.old_valid_from}`,
    );
  }
  const splits = normalizeSplits(input.splits);
  if (input.valid_to && input.valid_to <= input.valid_from) {
    throw new DomainError(
      "VALIDATION",
      `valid-to (${input.valid_to}) must be after valid-from (${input.valid_from})`,
    );
  }
  // Per-desk overlap against every OTHER window (§7.4(a)): concurrent rows for
  // different desks are a legal split, same-desk overlap is not.
  const newTo = input.valid_to ?? "9999-12-31";
  for (const o of rows.filter((r) => !belongsToWindow(r))) {
    const oTo = o.valid_to ?? "9999-12-31";
    const overlaps = input.valid_from < oTo && o.valid_from < newTo;
    if (overlaps && splits.some((s) => s.desk === o.desk)) {
      throw new DomainError(
        "OVERLAP",
        `desk '${o.desk}' already has a version ${o.valid_from} → ${o.valid_to ?? "open"} that would overlap ${input.valid_from} → ${input.valid_to ?? "open"}`,
      );
    }
  }
  await mappings.editProductVersion(
    {
      data_product: input.data_product,
      old_valid_from: input.old_valid_from,
      old_valid_to: input.old_valid_to,
      new_domain: input.data_domain,
      new_owner: input.product_owner,
      new_valid_from: input.valid_from,
      new_valid_to: input.valid_to,
      splits,
    },
    actor,
  );
  await postCheck(input.data_product);
}

/**
 * Hard-delete one validity window (guarded). Blocked when removing it would
 * leave the product with no active window while bridge/rule mappings still
 * reference it — that would orphan live spend. Deleting a historical window
 * while an active one remains is allowed (with a UI restatement warning).
 */
export async function deleteProductVersion(
  data_product: string,
  valid_from: string,
  valid_to: string | null,
): Promise<void> {
  const rows = (await mappings.listCatalogue()).filter((r) => r.data_product === data_product);
  const belongsToWindow = isWindow(valid_from, valid_to);
  if (!rows.some(belongsToWindow)) {
    throw new DomainError("NOT_FOUND", `'${data_product}' has no version starting ${valid_from}`);
  }
  const activeRemains = rows.some((r) => r.valid_to == null && !belongsToWindow(r));
  const refs = await countProductReferences(data_product);
  if (refs.total > 0 && !activeRemains) {
    throw new DomainError(
      "REFERENCED",
      `deleting this version leaves '${data_product}' with no active window while ${refs.jobRefs} job, ${refs.whRefs} warehouse and ${refs.epRefs} endpoint mapping(s) and ${refs.ruleRefs} rule(s) still reference it — remove or remap those first`,
    );
  }
  await mappings.deleteProductVersion(data_product, valid_from, valid_to);
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
