import * as mappings from "@/dal/mappings";
import { getIntegrityViolations } from "@/dal/health";
import { DomainError } from "@/services/errors";

/**
 * Write-path business rules for data_product_mapping (Methodology §4.3, §10.5):
 *  - product keys are the tag vocabulary: lowercase, hyphen/underscore, no spaces
 *  - at most one active validity window per product, no overlaps
 *  - desk/domain changes close the old row and insert a successor (never
 *    UPDATE in place — that would restate published history)
 *  - no deletes, ever; retirement = closing the validity window
 * Each write runs the scoped §7.4 checks as a post-condition.
 */

export const PRODUCT_KEY_RE = /^[a-z0-9]+([_-][a-z0-9]+)*$/;

async function activeRow(product: string) {
  const rows = await mappings.listCatalogue();
  return rows.find((r) => r.data_product === product && r.valid_to == null) ?? null;
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
    desk: string;
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
  if (await activeRow(input.data_product)) {
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
  await mappings.insertProduct(input, actor);
  await postCheck(input.data_product);
}

export async function moveProduct(
  input: {
    data_product: string;
    cutover: string;
    new_domain: string;
    new_desk: string;
    new_owner: string | null;
  },
  actor: string,
): Promise<void> {
  const active = await activeRow(input.data_product);
  if (!active) {
    throw new DomainError("NOT_FOUND", `product '${input.data_product}' has no active row to move`);
  }
  if (input.cutover <= active.valid_from) {
    throw new DomainError(
      "OVERLAP",
      `cutover ${input.cutover} must be after the active window's start ${active.valid_from}`,
    );
  }
  if (active.data_domain === input.new_domain && active.desk === input.new_desk) {
    throw new DomainError("VALIDATION", "new domain and desk are identical to the current ones");
  }
  await mappings.moveProduct(input, actor);
  await postCheck(input.data_product);
}

export async function retireProduct(
  data_product: string,
  valid_to: string,
  actor: string,
): Promise<void> {
  const active = await activeRow(data_product);
  if (!active) {
    throw new DomainError("NOT_FOUND", `product '${data_product}' has no active row`);
  }
  if (valid_to <= active.valid_from) {
    throw new DomainError("VALIDATION", `retirement date must be after ${active.valid_from}`);
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
  if (!(await activeRow(data_product))) {
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
