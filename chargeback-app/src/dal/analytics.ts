import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { fmtDelta, fmtMoney, fmtMoneyExact, fmtPct, monthStart, shiftMonth } from "@/lib/format";
import { query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zMonth, zNum, zStr } from "@/dal/parse";
import type { DeskScorecardRow } from "@/dal/desks";
import type { ProductMovementRow } from "@/dal/movement";
import type { CoverageRow, MonthlyChargebackRow, SourceTaggingScore } from "@/dal/types";

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
  cacheLife("warehouse");
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
  cacheLife("warehouse");
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

/**
 * The month's tagging scorecard across ALL spend sources (tagging_scorecard
 * view): Databricks, its AI slice, and Azure measured against the same
 * standard — cost tagged at source (TAG) vs carried by rules vs unallocated.
 * AI ⊂ DATABRICKS, so the rows are compared, never summed. Cached under both
 * report tags: tag-rule edits re-attribute either side.
 */
export async function getTaggingScorecard(month: string): Promise<SourceTaggingScore[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("reports-live", "azure");
  if (env.DAL_MOCK) {
    const f = mockStore.monthFactor[month] ?? 0;
    const bucket = (method: string): keyof Omit<SourceTaggingScore, "source" | "total_cost"> =>
      method === "TAG" ? "tag_cost" : method === "NONE" ? "unallocated_cost" : "rule_cost";
    const empty = (source: SourceTaggingScore["source"]): SourceTaggingScore => ({
      source,
      total_cost: 0,
      tag_cost: 0,
      rule_cost: 0,
      unallocated_cost: 0,
    });
    const databricks = empty("DATABRICKS");
    for (const c of mockStore.coverage) {
      if (c.billing_month !== month) continue;
      databricks[bucket(c.attribution_method)] += c.cost;
      databricks.total_cost += c.cost;
    }
    const ai = empty("AI");
    for (const r of mockStore.aiEndpointUsage) {
      const cost = Math.round(r.cost * f * 100) / 100;
      ai[bucket(r.attribution_method)] += cost;
      ai.total_cost += cost;
    }
    const azure = empty("AZURE");
    for (const a of mockStore.azureAttributions) {
      const cost = Math.round(a.cost_30d * f * 100) / 100;
      azure[bucket(a.attribution_method)] += cost;
      azure.total_cost += cost;
    }
    return [databricks, ai, azure].filter((s) => s.total_cost > 0);
  }
  const rows = await query(
    `SELECT source, attribution_method, SUM(cost) AS cost
     FROM ${T("tagging_scorecard")}
     WHERE billing_month = :month
     GROUP BY 1, 2`,
    { month: monthStart(month) },
    z.object({ source: zStr, attribution_method: zStr, cost: zNum }),
  );
  const order: SourceTaggingScore["source"][] = ["DATABRICKS", "AI", "AZURE"];
  const bySource = new Map<string, SourceTaggingScore>();
  for (const r of rows) {
    const s = bySource.get(r.source) ?? {
      source: r.source as SourceTaggingScore["source"],
      total_cost: 0,
      tag_cost: 0,
      rule_cost: 0,
      unallocated_cost: 0,
    };
    s.total_cost += r.cost;
    if (r.attribution_method === "TAG") s.tag_cost += r.cost;
    else if (r.attribution_method === "NONE") s.unallocated_cost += r.cost;
    else s.rule_cost += r.cost;
    bySource.set(r.source, s);
  }
  return order.flatMap((s) => bySource.get(s) ?? []);
}

/** Cost per (month, entity) over the trailing 12 months — sparkline feed. */
export interface EntityCostPoint {
  billing_month: string;
  name: string;
  cost: number;
}

export async function getCostHistory(
  month: string,
  dim: "data_product" | "desk",
): Promise<EntityCostPoint[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("reports-live");
  if (env.DAL_MOCK) {
    const window = mockStore.months.filter((m) => m <= month).slice(-12);
    const map = new Map<string, EntityCostPoint>();
    for (const r of mockStore.monthly.filter((r) => window.includes(r.billing_month))) {
      const name = r[dim];
      const key = `${r.billing_month}|${name}`;
      const e = map.get(key) ?? { billing_month: r.billing_month, name, cost: 0 };
      e.cost += r.total_cost;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => a.billing_month.localeCompare(b.billing_month));
  }
  return query(
    `SELECT billing_month, ${dim} AS name, SUM(total_cost) AS cost
     FROM ${T("monthly_chargeback")}
     WHERE billing_month > add_months(:month, -12) AND billing_month <= :month
     GROUP BY 1, 2 ORDER BY 1`,
    { month: monthStart(month) },
    z.object({
      billing_month: zMonth,
      name: zStr,
      cost: zNum,
    }) as z.ZodType<EntityCostPoint>,
  );
}

// ---------- pure rollups over getMonthlyRows ----------

export interface TrendPoint {
  month: string;
  value: number;
}

/** history → per-entity 12-month series on a shared month axis (missing months = 0). */
function trendsByName(history: EntityCostPoint[]): {
  months: string[];
  trendFor: (name: string) => TrendPoint[];
} {
  const months = [...new Set(history.map((h) => h.billing_month))].sort();
  const byName = new Map<string, Map<string, number>>();
  for (const h of history) {
    const m = byName.get(h.name) ?? new Map<string, number>();
    m.set(h.billing_month, (m.get(h.billing_month) ?? 0) + h.cost);
    byName.set(h.name, m);
  }
  return {
    months,
    trendFor: (name) =>
      months.map((month) => ({ month, value: byName.get(name)?.get(month) ?? 0 })),
  };
}

export interface ProductKpiRow {
  data_product: string;
  data_domain: string;
  /** desks the product is billed to this month — the chargeback fan-out */
  desk_count: number;
  cost: number;
  dbus: number;
  /** share of the month's grand total */
  share: number;
  /** running share, cost-descending — the Pareto curve */
  cum_share: number;
  /** vs last month; null when no prior-month data exists at all */
  delta_abs: number | null;
  /** null without prior data or when the product is new (prev cost 0) */
  delta_pct: number | null;
  /** blended $/DBU, null when the product reported no DBUs */
  rate: number | null;
  /** trailing-12-month cost, live history */
  trend: TrendPoint[];
}

/** Per-product business KPIs, cost-descending — who drives the bill and how it's moving. */
export function productKpis(
  cur: MonthlyChargebackRow[],
  prev: MonthlyChargebackRow[],
  history: EntityCostPoint[],
): ProductKpiRow[] {
  const byProduct = new Map<
    string,
    { data_domain: string; cost: number; dbus: number; desks: Set<string> }
  >();
  for (const r of cur) {
    const e =
      byProduct.get(r.data_product) ??
      { data_domain: r.data_domain, cost: 0, dbus: 0, desks: new Set<string>() };
    e.cost += r.total_cost;
    e.dbus += r.total_dbus;
    e.desks.add(r.desk);
    byProduct.set(r.data_product, e);
  }
  const prevBy = new Map<string, number>();
  for (const r of prev) prevBy.set(r.data_product, (prevBy.get(r.data_product) ?? 0) + r.total_cost);
  const hasPrev = prev.length > 0;
  const { trendFor } = trendsByName(history);
  const total = cur.reduce((s, r) => s + r.total_cost, 0);
  let cum = 0;
  return [...byProduct.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([data_product, e]) => {
      const share = total > 0 ? e.cost / total : 0;
      cum += share;
      const prev_cost = hasPrev ? (prevBy.get(data_product) ?? 0) : null;
      return {
        data_product,
        data_domain: e.data_domain,
        desk_count: e.desks.size,
        cost: e.cost,
        dbus: e.dbus,
        share,
        cum_share: cum,
        delta_abs: prev_cost == null ? null : e.cost - prev_cost,
        delta_pct: prev_cost == null || prev_cost === 0 ? null : e.cost / prev_cost - 1,
        rate: e.dbus > 0 ? e.cost / e.dbus : null,
        trend: trendFor(data_product),
      };
    });
}

/** Smallest number of top entities whose combined share reaches `threshold` (e.g. 0.8). */
export function countToShare(rows: { cum_share: number }[], threshold: number): number | null {
  if (rows.length === 0) return null;
  const i = rows.findIndex((r) => r.cum_share >= threshold - 1e-9);
  return i === -1 ? rows.length : i + 1;
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

export interface DeskKpiRow {
  desk: string;
  cost: number;
  dbus: number;
  /** share of the month's grand total */
  share: number;
  /** running share, cost-descending — the Pareto curve */
  cum_share: number;
  /** share change vs last month in percentage points, null without a prior month */
  delta_pp: number | null;
  /** vs last month; null when no prior-month data exists at all */
  delta_abs: number | null;
  delta_pct: number | null;
  /** the desk's most expensive product this month and its share of the desk's bill */
  top_product: string | null;
  top_product_share: number | null;
  product_count: number;
  /** blended $/DBU, null when the desk reported no DBUs */
  rate: number | null;
  /** TAG-attributed share of the desk's cost (live cost_fact scorecard), null when absent */
  tag_pct: number | null;
  /** trailing-12-month cost, live history */
  trend: TrendPoint[];
}

/** Per-desk business KPIs, cost-descending — who pays the bill and how it's moving. */
export function deskKpis(
  cur: MonthlyChargebackRow[],
  prev: MonthlyChargebackRow[],
  history: EntityCostPoint[],
  scorecard: DeskScorecardRow[],
): DeskKpiRow[] {
  const byDesk = new Map<string, { cost: number; dbus: number; products: Map<string, number> }>();
  for (const r of cur) {
    const e = byDesk.get(r.desk) ?? { cost: 0, dbus: 0, products: new Map<string, number>() };
    e.cost += r.total_cost;
    e.dbus += r.total_dbus;
    e.products.set(r.data_product, (e.products.get(r.data_product) ?? 0) + r.total_cost);
    byDesk.set(r.desk, e);
  }
  const prevBy = new Map<string, number>();
  for (const r of prev) prevBy.set(r.desk, (prevBy.get(r.desk) ?? 0) + r.total_cost);
  const hasPrev = prev.length > 0;
  const { trendFor } = trendsByName(history);
  const tagBy = new Map(scorecard.map((s) => [s.desk, s.tag_pct]));
  const curTotal = [...byDesk.values()].reduce((s, e) => s + e.cost, 0);
  const prevTotal = [...prevBy.values()].reduce((s, v) => s + v, 0);
  let cum = 0;
  return [...new Set([...byDesk.keys(), ...prevBy.keys()])]
    .map((desk) => ({ desk, e: byDesk.get(desk) }))
    .sort((a, b) => (b.e?.cost ?? 0) - (a.e?.cost ?? 0))
    .map(({ desk, e }) => {
      const cost = e?.cost ?? 0;
      const share = curTotal > 0 ? cost / curTotal : 0;
      cum += share;
      const prev_cost = hasPrev ? (prevBy.get(desk) ?? 0) : null;
      const prev_share = prevTotal > 0 ? (prevBy.get(desk) ?? 0) / prevTotal : null;
      const top = e ? [...e.products.entries()].sort((a, b) => b[1] - a[1])[0] : undefined;
      return {
        desk,
        cost,
        dbus: e?.dbus ?? 0,
        share,
        cum_share: cum,
        delta_pp: prev_share == null ? null : (share - prev_share) * 100,
        delta_abs: prev_cost == null ? null : cost - prev_cost,
        delta_pct: prev_cost == null || prev_cost === 0 ? null : cost / prev_cost - 1,
        top_product: top?.[0] ?? null,
        top_product_share: top && cost > 0 ? top[1] / cost : null,
        product_count: e?.products.size ?? 0,
        rate: e && e.dbus > 0 ? e.cost / e.dbus : null,
        tag_pct: tagBy.get(desk) ?? null,
        trend: trendFor(desk),
      };
    });
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
  products: ProductKpiRow[];
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

  // 4 — product concentration
  if (products.length >= 3) {
    const share = products[2].cum_share;
    const n80 = countToShare(products, 0.8);
    out.push({
      tone: share > 0.75 ? "warn" : "default",
      text:
        `Top 3 products (${products
          .slice(0, 3)
          .map((p) => p.data_product)
          .join(", ")}) carry ${fmtPct(share)} of the month's spend` +
        (n80 == null ? "." : `; ${n80} of ${products.length} products reach 80%.`),
    });
  }

  // 5 — desk concentration
  const deskTotals = (rows: MonthlyChargebackRow[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.desk, (m.get(r.desk) ?? 0) + r.total_cost);
    return m;
  };
  const curDesks = deskTotals(curRows);
  const topDesk = [...curDesks.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topDesk && cur.total_cost > 0) {
    const [desk, cost] = topDesk;
    const share = cost / cur.total_cost;
    const prevDesks = deskTotals(prevRows);
    const prevTotal = [...prevDesks.values()].reduce((s, v) => s + v, 0);
    const pp = prevTotal > 0 ? (share - (prevDesks.get(desk) ?? 0) / prevTotal) * 100 : null;
    out.push({
      tone: share > 0.5 ? "warn" : "default",
      text:
        `Largest desk: ${desk} carries ${fmtPct(share)} of the bill (${fmtMoney(cost)})` +
        (pp == null ? "." : `, ${pp >= 0 ? "+" : ""}${pp.toFixed(1)}pp vs last month.`),
    });
  }

  // 6 — attribution quality
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
          ? `; ${fmtMoney(noneCur.cost)} still unallocated (NONE).`
          : "."),
    });
  }

  // 7 — unallocated direction
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
