import { getMonthlyRows } from "@/dal/reports";
import { shiftMonth } from "@/lib/format";
import type { ReportMode } from "@/dal/types";

/**
 * Month-over-month movement (Methodology §7.5) — the report commentary layer.
 * Pure composition over the cached getMonthlyRows reads: the selected month
 * in the requested mode, the prior month always live (published prior months
 * are identical to live at publish time, and live keeps working for months
 * that were never published).
 */

export interface DeskMovementRow {
  desk: string;
  cost: number;
  prev_cost: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
}

export interface ProductMovementRow {
  data_product: string;
  data_domain: string;
  desk: string;
  cost: number;
  prev_cost: number;
  delta_abs: number;
}

function sumBy<T>(rows: T[], key: (r: T) => string, value: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + value(r));
  return m;
}

export async function getDeskMovement(
  month: string,
  mode: ReportMode,
): Promise<DeskMovementRow[]> {
  const [cur, prev] = await Promise.all([
    getMonthlyRows(month, mode),
    getMonthlyRows(shiftMonth(month, -1), "live"),
  ]);
  const curByDesk = sumBy(cur, (r) => r.desk, (r) => r.total_cost);
  const prevByDesk = sumBy(prev, (r) => r.desk, (r) => r.total_cost);
  const hasPrev = prev.length > 0;

  return [...new Set([...curByDesk.keys(), ...prevByDesk.keys()])]
    .map((desk) => {
      const cost = curByDesk.get(desk) ?? 0;
      const prev_cost = hasPrev ? (prevByDesk.get(desk) ?? 0) : null;
      const delta_abs = prev_cost == null ? null : cost - prev_cost;
      const delta_pct =
        prev_cost == null || prev_cost === 0 ? null : cost / prev_cost - 1;
      return { desk, cost, prev_cost, delta_abs, delta_pct };
    })
    .sort((a, b) => Math.abs(b.delta_abs ?? 0) - Math.abs(a.delta_abs ?? 0) || b.cost - a.cost);
}

export async function getProductMovement(
  month: string,
  mode: ReportMode,
): Promise<ProductMovementRow[]> {
  const [cur, prev] = await Promise.all([
    getMonthlyRows(month, mode),
    getMonthlyRows(shiftMonth(month, -1), "live"),
  ]);
  const key = (r: { data_product: string; desk: string }) => `${r.data_product}|${r.desk}`;
  const curBy = sumBy(cur, key, (r) => r.total_cost);
  const prevBy = sumBy(prev, key, (r) => r.total_cost);
  const meta = new Map(
    [...cur, ...prev].map((r) => [
      key(r),
      { data_product: r.data_product, data_domain: r.data_domain, desk: r.desk },
    ]),
  );

  return [...new Set([...curBy.keys(), ...prevBy.keys()])]
    .map((k) => {
      const m = meta.get(k)!;
      const cost = curBy.get(k) ?? 0;
      const prev_cost = prevBy.get(k) ?? 0;
      return { ...m, cost, prev_cost, delta_abs: cost - prev_cost };
    })
    .sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs));
}

export interface DeskCommentary {
  desk: string;
  text: string;
}

/**
 * Plain-language driver analysis per desk: "rates +$1,234 (+8.2%) — driven by
 * pricing-curves (+$900)". Uses the largest same-direction product move.
 */
export function buildCommentary(
  desks: DeskMovementRow[],
  products: ProductMovementRow[],
  fmtMoney: (v: number) => string,
): DeskCommentary[] {
  return desks
    .filter((d) => d.delta_abs != null && Math.round(d.delta_abs) !== 0)
    .map((d) => {
      const delta = d.delta_abs!;
      const sign = delta >= 0 ? "+" : "−";
      const pct =
        d.delta_pct == null ? "" : ` (${delta >= 0 ? "+" : ""}${(d.delta_pct * 100).toFixed(1)}%)`;
      const driver = products
        .filter((p) => p.desk === d.desk && Math.sign(p.delta_abs) === Math.sign(delta))
        .sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs))[0];
      const driverText = driver
        ? ` — driven by ${driver.data_product} (${driver.delta_abs >= 0 ? "+" : "−"}${fmtMoney(Math.abs(driver.delta_abs))})`
        : "";
      return {
        desk: d.desk,
        text: `${sign}${fmtMoney(Math.abs(delta))}${pct}${driverText}`,
      };
    });
}
