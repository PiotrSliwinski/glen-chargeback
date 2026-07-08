/**
 * The one definition of the shared reference vocabularies — desk (who pays)
 * and data_domain (the level-1 rollup). Both are free-text columns on
 * data_product_mapping, so before this the "vocabulary" was whatever had been
 * typed before, re-derived four different ways per page and, for data_domain,
 * not offered at all.
 *
 * The vocabulary is OPEN: these lists drive the <datalist> suggestions shared
 * across every form (product catalogue, work-queue triage, user mapping, AI
 * endpoint desk), so the same values are offered everywhere — but a steward
 * can still type a new one (e.g. registering the first product of a brand-new
 * domain). Values are the distinct desks/domains already in use, unioned with
 * the curated seeds below so canonical values show up even before any row
 * uses them. Pin values in the seeds to define reference data up front; leave
 * them empty to derive purely from live data.
 */

/** Catch-all bucket for un-attributed cost — never a real, assignable desk/domain. */
const UNALLOCATED = "UNALLOCATED";

/** Canonical desks to always offer, even with no product/user on them yet. */
export const SEED_DESKS: readonly string[] = [];
/** Canonical data domains to always offer, even with no product in them yet. */
export const SEED_DATA_DOMAINS: readonly string[] = [];

export interface ReferenceOptions {
  desks: string[];
  dataDomains: string[];
}

/** Distinct, trimmed, sorted values from `seed` + `values`, minus blanks and the UNALLOCATED sentinel. */
function canonical(seed: readonly string[], values: Iterable<string>): string[] {
  const set = new Set<string>(seed);
  for (const v of values) {
    const t = v?.trim();
    if (t && t !== UNALLOCATED) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Build the shared desk / data-domain option lists for a form. Pass the
 * catalogue (or active-product) rows the page already loaded; optionally add
 * user home desks so the desk list is the same union everywhere.
 */
export function referenceOptions(
  rows: ReadonlyArray<{ desk: string; data_domain: string }>,
  userDesks: readonly string[] = [],
): ReferenceOptions {
  return {
    desks: canonical(SEED_DESKS, [...rows.map((r) => r.desk), ...userDesks]),
    dataDomains: canonical(SEED_DATA_DOMAINS, rows.map((r) => r.data_domain)),
  };
}
