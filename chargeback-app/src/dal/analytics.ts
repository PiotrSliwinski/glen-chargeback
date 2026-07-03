import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { fmtDelta, fmtMoney, fmtMoneyExact, fmtPct, monthStart, shiftMonth } from "@/lib/format";
import { query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zMonth, zNum, zStr } from "@/dal/parse";
import type { ProductMovementRow } from "@/dal/movement";
import type { CoverageRow, MonthlyChargebackRow } from "@/dal/types";

/**
 * Advanced-analytics layer: trailing-12-month reads (always live — trends
 * need history that a published snapshot doesn't carry) plus pure rollups
 * over the cached getMonthlyRows reads. Prior-month comparisons follow the
 * movement convention: selected month in the requested mode, prior month
 * always live.
 */

export interface MonthTotals {
  billing_month: string;
  total_cost: number;
  total_dbus: number;
}

/** Total cost and DBUs per month, trailing 12 months up to the selected one. */
export async function getMonthlyTotals(month: string): Promise<MonthTotals[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reports-live");
  if (env.DAL_MOCK) {
    return mockStore.months
      .filter((m) => m <= month)
      .slice(-12)
      .map((m) => {
        const rows = mockStore.monthly.filter((r) => r.billing_month === m);
        return {
          billing_month: m,
          total_cost: rows.reduce((s, r) => s + r.total_cost, 0),
          total_dbus: rows.reduce((s, r) => s + r.total_dbus, 0),
        };
      });
  }
  return query(
    `SELECT billing_month, SUM(total_cost) AS total_cost, SUM(total_dbus) AS total_dbus
     FROM ${T("monthly_chargeback")}
     WHERE billing_month > add_months(:month, -12) AND billing_month <= :month
     GROUP BY 1 ORDER BY 1`,
    { month: monthStart(month) },
    z.object({
      billing_month: zMonth,
      total_cost: zNum,
      total_dbus: zNum,
    }) as z.ZodType<MonthTotals>,
  );
}

/** Attribution mix per month, trailing 12 months — the TAG-vs-NONE trajectory. */
export async function getCoverageTrend(month: string): Promise<CoverageRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reports-live");
  if (env.DAL_MOCK) {
    const window = mockStore.months.filter((m) => m <= month).slice(-12);
    return mockStore.coverage.filter((c) => window.includes(c.billing_month));
  }
  return query(
    `SELECT billing_month, attribution_method, cost, pct_of_month
     FROM ${T("attribution_coverage")}
     WHERE billing_month > add_months(:month, -12) AND billing_month <= :month
     ORDER BY 1`,
    { month: monthStart(month) },
    z.object({
      billing_month: zMonth,
      attribution_method: zStr,
      cost: zNum,
      pct_of_month: zNum,
    }) as z.ZodType<CoverageRow>,
  );
}

// ---------- pure rollups over getMonthlyRows ----------

export interface ProductShareRow {
  data_product: string;
  data_domain: string;
  cost: number;
  /** share of the month's grand total */
  share: number;
  /** running share, cost-descending — the Pareto curve */
  cum_share: number;
}

/** Products ranked by cost with cumulative share — how few things drive the bill. */
export function paretoProducts(rows: MonthlyChargebackRow[]): ProductShareRow[] {
  const byProduct = new Map<string, { data_domain: string; cost: number }>();
  for (const r of rows) {
    const e = byProduct.get(r.data_product) ?? { data_domain: r.data_domain, cost: 0 };
    e.cost += r.total_cost;
    byProduct.set(r.data_product, e);
  }
  const total = rows.reduce((s, r) => s + r.total_cost, 0);
  let cum = 0;
  return [...byProduct.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([data_product, e]) => {
      const share = total > 0 ? e.cost / total : 0;
      cum += share;
      return { data_product, data_domain: e.data_domain, cost: e.cost, share, cum_share: cum };
    });
}

export interface CategoryEconomicsRow {
  usage_category: string;
  cost: number;
  dbus: number;
  /** share of the month's grand total */
  share: number;
  /** blended $/DBU, null when the category reported no DBUs */
  rate: number | null;
  prev_rate: number | null;
}

/** Unit economics per usage category: cost, DBUs, blended $/DBU vs last month. */
export function categoryEconomics(
  cur: MonthlyChargebackRow[],
  prev: MonthlyChargebackRow[],
): CategoryEconomicsRow[] {
  const roll = (rows: MonthlyChargebackRow[]) => {
    const m = new Map<string, { cost: number; dbus: number }>();
    for (const r of rows) {
      const e = m.get(r.usage_category) ?? { cost: 0, dbus: 0 };
      e.cost += r.total_cost;
      e.dbus += r.total_dbus;
      m.set(r.usage_category, e);
    }
    return m;
  };
  const curBy = roll(cur);
  const prevBy = roll(prev);
  const total = cur.reduce((s, r) => s + r.total_cost, 0);
  return [...curBy.entries()]
    .map(([usage_category, e]) => {
      const p = prevBy.get(usage_category);
      return {
        usage_category,
        cost: e.cost,
        dbus: e.dbus,
        share: total > 0 ? e.cost / total : 0,
        rate: e.dbus > 0 ? e.cost / e.dbus : null,
        prev_rate: p && p.dbus > 0 ? p.cost / p.dbus : null,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

export interface DeskShareRow {
  desk: string;
  cost: number;
  /** share of the month's grand total */
  share: number;
  prev_share: number | null;
  /** share change in percentage points, null without a prior month */
  delta_pp: number | null;
}

/** Each desk's share of total cost vs last month — relative growth in pp. */
export function deskShareShift(
  cur: MonthlyChargebackRow[],
  prev: MonthlyChargebackRow[],
): DeskShareRow[] {
  const roll = (rows: MonthlyChargebackRow[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.desk, (m.get(r.desk) ?? 0) + r.total_cost);
    return m;
  };
  const curBy = roll(cur);
  const prevBy = roll(prev);
  const curTotal = [...curBy.values()].reduce((s, v) => s + v, 0);
  const prevTotal = [...prevBy.values()].reduce((s, v) => s + v, 0);
  return [...new Set([...curBy.keys(), ...prevBy.keys()])]
    .map((desk) => {
      const cost = curBy.get(desk) ?? 0;
      const share = curTotal > 0 ? cost / curTotal : 0;
      const prev_share = prevTotal > 0 ? (prevBy.get(desk) ?? 0) / prevTotal : null;
      return {
        desk,
        cost,
        share,
        prev_share,
        delta_pp: prev_share == null ? null : (share - prev_share) * 100,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

// ---------- auto-generated findings ----------

export interface Insight {
  text: string;
  tone: "good" | "warn" | "bad" | "default";
}

const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${fmtPct(v)}`;

/**
 * Plain-language findings, rule-based and reproducible from the figures on
 * the page: trajectory, largest moves, rate-vs-volume decomposition,
 * concentration, attribution quality and unallocated direction.
 */
export function buildInsights(input: {
  month: string;
  totals: MonthTotals[];
  products: ProductShareRow[];
  movers: ProductMovementRow[];
  coverage: CoverageRow[];
  curRows: MonthlyChargebackRow[];
  prevRows: MonthlyChargebackRow[];
}): Insight[] {
  const { month, totals, products, movers, coverage, curRows, prevRows } = input;
  const out: Insight[] = [];
  const cur = totals.find((t) => t.billing_month === month);
  if (!cur || cur.total_cost <= 0) return out;
  const prev = totals.find((t) => t.billing_month === shiftMonth(month, -1));
  const threeAgo = totals.find((t) => t.billing_month === shiftMonth(month, -3));

  // 1 — spend trajectory
  if (prev && prev.total_cost > 0) {
    const mom = cur.total_cost / prev.total_cost - 1;
    const three =
      threeAgo && threeAgo.total_cost > 0 ? cur.total_cost / threeAgo.total_cost - 1 : null;
    out.push({
      tone: mom > 0.1 ? "bad" : mom > 0.02 ? "warn" : "good",
      text:
        `Total spend ${fmtMoney(cur.total_cost)}, ${signedPct(mom)} month-over-month` +
        (three == null ? "." : `; ${signedPct(three)} over the trailing three months.`),
    });
  }

  // 2 — largest product moves (only when material: ≥1% of the month's total,
  // and only when a prior month exists — otherwise everything reads as "new")
  const hasPrev = prevRows.length > 0;
  const material = cur.total_cost * 0.01;
  const up = hasPrev ? movers.find((p) => p.delta_abs > 0) : undefined;
  const down = hasPrev ? movers.find((p) => p.delta_abs < 0) : undefined;
  if (up && up.delta_abs >= material) {
    const pct = up.prev_cost > 0 ? ` (${signedPct(up.cost / up.prev_cost - 1)})` : ", new spend this month";
    out.push({
      tone: "warn",
      text: `Largest increase: ${up.data_product} on ${up.desk}, ${fmtDelta(up.delta_abs)} month-over-month${pct}.`,
    });
  }
  if (down && -down.delta_abs >= material) {
    out.push({
      tone: "good",
      text: `Largest decrease: ${down.data_product} on ${down.desk}, ${fmtDelta(down.delta_abs)} month-over-month.`,
    });
  }

  // 3 — rate vs volume decomposition
  const rate = cur.total_dbus > 0 ? cur.total_cost / cur.total_dbus : null;
  const prevRate = prev && prev.total_dbus > 0 ? prev.total_cost / prev.total_dbus : null;
  if (rate != null && prevRate != null && prev) {
    const rateChg = rate / prevRate - 1;
    const volChg = cur.total_dbus / prev.total_dbus - 1;
    const driver =
      Math.abs(rateChg) < 0.01
        ? "volume-driven — the blended rate is flat"
        : rateChg > 0
          ? "partly rate-driven — the workload mix shifted toward pricier compute"
          : "cheaper per DBU — the mix shifted toward cheaper compute";
    out.push({
      tone: rateChg > 0.02 ? "warn" : "default",
      text: `Blended rate ${fmtMoneyExact(rate)}/DBU (${signedPct(rateChg)}), DBU volume ${signedPct(volChg)} — cost movement is ${driver}.`,
    });
  }

  // 4 — concentration
  if (products.length >= 3) {
    const share = products[2].cum_share;
    out.push({
      tone: share > 0.75 ? "warn" : "default",
      text: `Top 3 products (${products
        .slice(0, 3)
        .map((p) => p.data_product)
        .join(", ")}) carry ${fmtPct(share)} of the month's spend.`,
    });
  }

  // 5 — attribution quality
  const tagCur = coverage.find(
    (c) => c.billing_month === month && c.attribution_method === "TAG",
  );
  const tag3 = coverage.find(
    (c) => c.billing_month === shiftMonth(month, -3) && c.attribution_method === "TAG",
  );
  const noneCur = coverage.find(
    (c) => c.billing_month === month && c.attribution_method === "NONE",
  );
  if (tagCur) {
    const pp = tag3 == null ? null : (tagCur.pct_of_month - tag3.pct_of_month) * 100;
    out.push({
      tone: tagCur.pct_of_month >= 0.7 ? "good" : "warn",
      text:
        `TAG coverage ${fmtPct(tagCur.pct_of_month)}` +
        (pp == null ? "" : ` (${pp >= 0 ? "+" : ""}${pp.toFixed(1)}pp over three months)`) +
        (noneCur && noneCur.cost > 0
          ? `; ${fmtMoney(noneCur.cost)} still unattributed (NONE).`
          : "."),
    });
  }

  // 6 — unallocated direction
  const unalloc = (rows: MonthlyChargebackRow[]) =>
    rows.filter((r) => r.data_product === "UNALLOCATED").reduce((s, r) => s + r.total_cost, 0);
  const curUn = unalloc(curRows);
  const prevUn = prevRows.length > 0 ? unalloc(prevRows) : null;
  if (curUn > 0) {
    const delta = prevUn == null ? null : curUn - prevUn;
    out.push({
      tone: delta != null && delta > 0 ? "bad" : "warn",
      text:
        `Unallocated cost ${fmtMoney(curUn)} (${fmtPct(cur.total_cost > 0 ? curUn / cur.total_cost : 0)} of total)` +
        (delta == null ? "." : `, ${fmtDelta(delta)} month-over-month.`),
    });
  } else {
    out.push({ tone: "good", text: "No unallocated cost — every dollar reached a desk." });
  }

  return out;
}
