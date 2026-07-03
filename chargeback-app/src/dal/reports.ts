import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { monthStart, shiftMonth } from "@/lib/format";
import { query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zBoolOrNull, zMonth, zNum, zStr, zStrOrNull } from "@/dal/parse";
import type {
  CoverageRow,
  DashboardData,
  DetailRow,
  DomainRollup,
  InvoiceRow,
  MonthlyChargebackRow,
  ProductRollup,
  ReportMode,
} from "@/dal/types";

/**
 * Read path for all reporting (Methodology §6, §10.2–10.3).
 * Live reads hit monthly_chargeback / cost_fact; published reads hit the
 * immutable monthly_chargeback_published snapshot — invoices only ever use
 * the latter.
 */

const monthlySource = (mode: ReportMode) =>
  mode === "published"
    ? { table: T("monthly_chargeback_published"), monthCol: "snapshot_month" }
    : { table: T("monthly_chargeback"), monthCol: "billing_month" };

const CoverageSchema = z.object({
  billing_month: zMonth,
  attribution_method: zStr,
  cost: zNum,
  pct_of_month: zNum,
}) as z.ZodType<CoverageRow>;

export async function getAvailableMonths(): Promise<string[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reports-live");
  if (env.DAL_MOCK) return [...mockStore.months].reverse();
  const rows = await query(
    `SELECT DISTINCT billing_month FROM ${T("monthly_chargeback")} ORDER BY 1 DESC`,
    {},
    z.object({ billing_month: zMonth }),
  );
  return rows.map((r) => r.billing_month);
}

export async function getPublishedMonths(): Promise<string[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reports-published");
  if (env.DAL_MOCK) return [...mockStore.publishedMonths].sort().reverse();
  const rows = await query(
    `SELECT DISTINCT snapshot_month FROM ${T("monthly_chargeback_published")} ORDER BY 1 DESC`,
    {},
    z.object({ snapshot_month: zMonth }),
  );
  return rows.map((r) => r.snapshot_month);
}

export async function getDashboard(month: string, mode: ReportMode): Promise<DashboardData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(mode === "published" ? "reports-published" : "reports-live");

  if (env.DAL_MOCK) {
    const rows = mockStore.monthly.filter((r) => r.billing_month === month);
    const prevRows = mockStore.monthly.filter((r) => r.billing_month === shiftMonth(month, -1));
    const byDomainMap = new Map<string, DomainRollup>();
    for (const r of rows) {
      const d = byDomainMap.get(r.data_domain) ?? {
        data_domain: r.data_domain,
        total_cost: 0,
        total_dbus: 0,
      };
      d.total_cost += r.total_cost;
      d.total_dbus += r.total_dbus;
      byDomainMap.set(r.data_domain, d);
    }
    const coverage = mockStore.coverage.filter((c) => c.billing_month === month);
    const trendMonths = mockStore.months.filter((m) => m <= month).slice(-12);
    const trend = mockStore.monthly
      .filter((r) => trendMonths.includes(r.billing_month))
      .reduce((acc, r) => {
        const key = `${r.billing_month}|${r.data_domain}`;
        acc.set(key, {
          billing_month: r.billing_month,
          data_domain: r.data_domain,
          total_cost: (acc.get(key)?.total_cost ?? 0) + r.total_cost,
        });
        return acc;
      }, new Map<string, { billing_month: string; data_domain: string; total_cost: number }>());
    return {
      month,
      mode,
      totalCost: rows.reduce((s, r) => s + r.total_cost, 0),
      prevMonthCost: prevRows.length ? prevRows.reduce((s, r) => s + r.total_cost, 0) : null,
      tagCoveragePct: coverage.find((c) => c.attribution_method === "TAG")?.pct_of_month ?? 0,
      unallocatedCost: rows
        .filter((r) => r.data_product === "UNALLOCATED")
        .reduce((s, r) => s + r.total_cost, 0),
      byDomain: [...byDomainMap.values()].sort((a, b) => b.total_cost - a.total_cost),
      trend: [...trend.values()].sort((a, b) => a.billing_month.localeCompare(b.billing_month)),
      coverage,
    };
  }

  const src = monthlySource(mode);
  const m = monthStart(month);
  const prevM = monthStart(shiftMonth(month, -1));

  const [byDomain, totals, prev, unalloc, coverage, trend] = await Promise.all([
    query(
      `SELECT data_domain, SUM(total_cost) AS total_cost, SUM(total_dbus) AS total_dbus
       FROM ${src.table} WHERE ${src.monthCol} = :month GROUP BY 1 ORDER BY 2 DESC`,
      { month: m },
      z.object({ data_domain: zStr, total_cost: zNum, total_dbus: zNum }) as z.ZodType<DomainRollup>,
    ),
    query(
      `SELECT SUM(total_cost) AS c FROM ${src.table} WHERE ${src.monthCol} = :month`,
      { month: m },
      z.object({ c: zNum }),
    ),
    query(
      // MoM always compares against live figures for the prior month
      `SELECT SUM(total_cost) AS c FROM ${T("monthly_chargeback")} WHERE billing_month = :month`,
      { month: prevM },
      z.object({ c: z.union([zNum, z.null()]) }),
    ),
    query(
      `SELECT SUM(total_cost) AS c FROM ${src.table}
       WHERE ${src.monthCol} = :month AND data_product = 'UNALLOCATED'`,
      { month: m },
      z.object({ c: zNum }),
    ),
    query(
      `SELECT billing_month, attribution_method, cost, pct_of_month
       FROM ${T("attribution_coverage")} WHERE billing_month = :month`,
      { month: m },
      CoverageSchema,
    ),
    query(
      `SELECT billing_month, data_domain, SUM(total_cost) AS total_cost
       FROM ${T("monthly_chargeback")}
       WHERE billing_month > add_months(:month, -12) AND billing_month <= :month
       GROUP BY 1, 2 ORDER BY 1`,
      { month: m },
      z.object({ billing_month: zMonth, data_domain: zStr, total_cost: zNum }),
    ),
  ]);

  return {
    month,
    mode,
    totalCost: totals[0]?.c ?? 0,
    prevMonthCost: prev[0]?.c ?? null,
    tagCoveragePct: coverage.find((c) => c.attribution_method === "TAG")?.pct_of_month ?? 0,
    unallocatedCost: unalloc[0]?.c ?? 0,
    byDomain,
    trend,
    coverage,
  };
}

/** All monthly_chargeback rows for a month — feeds the report pack, movement analysis and CSV exports. */
export async function getMonthlyRows(
  month: string,
  mode: ReportMode,
): Promise<MonthlyChargebackRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(mode === "published" ? "reports-published" : "reports-live");

  if (env.DAL_MOCK) {
    if (mode === "published" && !mockStore.publishedMonths.includes(month)) return [];
    return mockStore.monthly.filter((r) => r.billing_month === month);
  }

  const src = monthlySource(mode);
  return query(
    `SELECT ${src.monthCol} AS billing_month, data_domain, data_product, desk,
            usage_category, distinct_runners, total_dbus, total_cost
     FROM ${src.table} WHERE ${src.monthCol} = :month
     ORDER BY total_cost DESC`,
    { month: monthStart(month) },
    z.object({
      billing_month: zMonth,
      data_domain: zStr,
      data_product: zStr,
      desk: zStr,
      usage_category: zStr,
      distinct_runners: zNum,
      total_dbus: zNum,
      total_cost: zNum,
    }) as z.ZodType<MonthlyChargebackRow>,
  );
}

/** Level 1 → 2 drill: products within a domain (Methodology §10.3). */
export async function getDomainProducts(
  month: string,
  domain: string,
  mode: ReportMode,
): Promise<ProductRollup[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(mode === "published" ? "reports-published" : "reports-live");

  if (env.DAL_MOCK) {
    const map = new Map<string, ProductRollup>();
    for (const r of mockStore.monthly.filter(
      (r) => r.billing_month === month && r.data_domain === domain,
    )) {
      const p = map.get(r.data_product) ?? {
        data_product: r.data_product,
        desk: r.desk,
        cost: 0,
        dbus: 0,
      };
      p.cost += r.total_cost;
      p.dbus += r.total_dbus;
      map.set(r.data_product, p);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }

  const src = monthlySource(mode);
  return query(
    `SELECT data_product, desk, SUM(total_cost) AS cost, SUM(total_dbus) AS dbus
     FROM ${src.table} WHERE ${src.monthCol} = :month AND data_domain = :domain
     GROUP BY 1, 2 ORDER BY cost DESC`,
    { month: monthStart(month), domain },
    z.object({ data_product: zStr, desk: zStr, cost: zNum, dbus: zNum }) as z.ZodType<ProductRollup>,
  );
}

/** Level 2 → detail: what makes up a product's cost. Live cost_fact only. */
export async function getProductDetail(month: string, product: string): Promise<DetailRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reports-live");

  if (env.DAL_MOCK) return mockStore.detail[product] ?? [];

  return query(
    `SELECT usage_category, is_serverless, job_name, warehouse_id, runner_name,
            attribution_method, SUM(dbus) AS dbus, SUM(cost) AS cost
     FROM ${T("cost_fact")}
     WHERE usage_date >= :month AND usage_date < add_months(:month, 1)
       AND data_product = :product
     GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY cost DESC LIMIT 200`,
    { month: monthStart(month), product },
    z.object({
      usage_category: zStr,
      is_serverless: zBoolOrNull,
      job_name: zStrOrNull,
      warehouse_id: zStrOrNull,
      runner_name: zStrOrNull,
      attribution_method: zStr,
      dbus: zNum,
      cost: zNum,
    }) as z.ZodType<DetailRow>,
  );
}

/** Desk invoice — published snapshot only (Methodology §9: desks are invoiced from the snapshot). */
export async function getDeskInvoice(month: string, desk: string): Promise<InvoiceRow[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("reports-published");

  if (env.DAL_MOCK) {
    if (!mockStore.publishedMonths.includes(month)) return [];
    const rows = mockStore.monthly.filter((r) => r.billing_month === month && r.desk === desk);
    const map = new Map<string, InvoiceRow>();
    for (const r of rows) {
      const key = `${r.data_domain}|${r.data_product}`;
      const inv = map.get(key) ?? {
        billing_month: month,
        desk,
        data_domain: r.data_domain,
        data_product: r.data_product,
        total_dbus: 0,
        total_cost: 0,
        desk_month_total: 0,
      };
      inv.total_dbus += r.total_dbus;
      inv.total_cost += r.total_cost;
      map.set(key, inv);
    }
    const total = [...map.values()].reduce((s, r) => s + r.total_cost, 0);
    return [...map.values()]
      .map((r) => ({ ...r, desk_month_total: total }))
      .sort((a, b) => b.total_cost - a.total_cost);
  }

  return query(
    `SELECT snapshot_month AS billing_month, desk, data_domain, data_product,
            SUM(total_dbus) AS total_dbus, SUM(total_cost) AS total_cost,
            SUM(SUM(total_cost)) OVER (PARTITION BY desk) AS desk_month_total
     FROM ${T("monthly_chargeback_published")}
     WHERE snapshot_month = :month AND desk = :desk
     GROUP BY 1, 2, 3, 4 ORDER BY total_cost DESC`,
    { month: monthStart(month), desk },
    z.object({
      billing_month: zMonth,
      desk: zStr,
      data_domain: zStr,
      data_product: zStr,
      total_dbus: zNum,
      total_cost: zNum,
      desk_month_total: zNum,
    }) as z.ZodType<InvoiceRow>,
  );
}

/** Desks with cost in a month (for the invoice list). */
export async function getDesks(
  month: string,
  mode: ReportMode,
): Promise<{ desk: string; total_cost: number }[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(mode === "published" ? "reports-published" : "reports-live");

  if (env.DAL_MOCK) {
    if (mode === "published" && !mockStore.publishedMonths.includes(month)) return [];
    const map = new Map<string, number>();
    for (const r of mockStore.monthly.filter((r) => r.billing_month === month)) {
      map.set(r.desk, (map.get(r.desk) ?? 0) + r.total_cost);
    }
    return [...map.entries()]
      .map(([desk, total_cost]) => ({ desk, total_cost }))
      .sort((a, b) => b.total_cost - a.total_cost);
  }

  const src = monthlySource(mode);
  return query(
    `SELECT desk, SUM(total_cost) AS total_cost
     FROM ${src.table} WHERE ${src.monthCol} = :month GROUP BY 1 ORDER BY 2 DESC`,
    { month: monthStart(month) },
    z.object({ desk: zStr, total_cost: zNum }),
  );
}
