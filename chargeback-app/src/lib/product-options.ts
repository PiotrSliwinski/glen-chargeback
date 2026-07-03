import type { DataProductRow } from "@/dal/types";

/**
 * Select options for the active catalogue. The catalogue holds one row per
 * product per desk (multi-desk % splits), so options must dedupe by product
 * key — otherwise split products render duplicate <option> values and
 * duplicate React keys. Split products list every paying desk in the label.
 */
export function toProductOptions(
  products: DataProductRow[],
): { value: string; label: string }[] {
  const desks = new Map<string, string[]>();
  for (const p of products) {
    desks.set(p.data_product, [...(desks.get(p.data_product) ?? []), p.desk]);
  }
  return [...desks.entries()].map(([value, d]) => ({
    value,
    label: `${value} (${d.join(" + ")})`,
  }));
}
