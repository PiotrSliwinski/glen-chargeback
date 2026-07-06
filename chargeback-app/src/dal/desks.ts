import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { monthStart } from "@/lib/format";
import { query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zBoolOrNull, zMonth, zNum, zStr, zStrOrNull } from "@/dal/parse";
import type { AttributionMethod, DeskDetailRow } from "@/dal/types";

/**
 * Desk-level analytics: self-service views for desk heads and the per-desk
 * tagging scorecard that drives adoption (Methodology §8).
 */

export interface DeskTrendPoint {
  billing_month: string;
  total_cost: number;
}

export async function getDeskTrend(desk: string): Promise<DeskTrendPoint[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reports-live");

  if (env.DAL_MOCK) {
    const map = new Map<string, number>();
    for (const r of mockStore.monthly.filter((r) => r.desk === desk)) {
      map.set(r.billing_month, (map.get(r.billing_month) ?? 0) + r.total_cost);
    }
    return [...map.entries()]
      .map(([billing_month, total_cost]) => ({ billing_month, total_cost }))
      .sort((a, b) => a.billing_month.localeCompare(b.billing_month))
      .slice(-12);
  }

  return query(
    `SELECT billing_month, SUM(total_cost) AS total_cost
     FROM ${T("monthly_chargeback")}
     WHERE desk = :desk AND billing_month > add_months(current_date(), -13)
     GROUP BY 1 ORDER BY 1`,
    { desk },
    z.object({ billing_month: zMonth, total_cost: zNum }) as z.ZodType<DeskTrendPoint>,
  );
}

/**
 * Line-item drill-down for one desk's month: every (category × serverless ×
 * product × job/warehouse × runner × method) slice of cost_fact that landed on
 * the desk — the full construction of the desk's invoice number.
 */
export async function getDeskDetail(month: string, desk: string): Promise<DeskDetailRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reports-live");

  if (env.DAL_MOCK) {
    const products = new Set(
      mockStore.monthly
        .filter((r) => r.billing_month === month && r.desk === desk)
        .map((r) => r.data_product),
    );
    const deskOf = new Map(mockStore.users.map((u) => [u.user_name, u.desk]));
    return [...products]
      .flatMap((p) =>
        (mockStore.detail[p] ?? [])
          // AD_HOC fixtures are shared across desks; keep only this desk's runners
          .filter((d) => p !== "AD_HOC" || deskOf.get(d.runner_name ?? "") === desk)
          .map((d) => ({ ...d, data_product: p })),
      )
      .sort((a, b) => b.cost - a.cost);
  }

  return query(
    `SELECT usage_category, is_serverless, data_product, job_name, warehouse_id,
            endpoint_name, runner_name, attribution_method,
            SUM(dbus) AS dbus, SUM(cost) AS cost
     FROM ${T("cost_fact")}
     WHERE usage_date >= :month AND usage_date < add_months(:month, 1)
       AND desk = :desk
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8 ORDER BY cost DESC LIMIT 500`,
    { month: monthStart(month), desk },
    z.object({
      usage_category: zStr,
      is_serverless: zBoolOrNull,
      data_product: zStr,
      job_name: zStrOrNull,
      warehouse_id: zStrOrNull,
      endpoint_name: zStrOrNull,
      runner_name: zStrOrNull,
      attribution_method: zStr,
      dbus: zNum,
      cost: zNum,
    }) as z.ZodType<DeskDetailRow>,
  );
}

export interface DeskCoverageRow {
  desk: string;
  attribution_method: AttributionMethod;
  cost: number;
}

export interface DeskScorecardRow {
  desk: string;
  total_cost: number;
  tag_cost: number;
  tag_pct: number;
  none_cost: number;
}

/** Cost per desk × attribution method for a month (live cost_fact). */
export async function getDeskCoverage(month: string): Promise<DeskCoverageRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reports-live");

  if (env.DAL_MOCK) {
    // Deterministic fixture: apply the month's global method shares to each
    // desk's total, skewing TAG per desk so the leaderboard isn't flat.
    const shares = mockStore.coverage.filter((c) => c.billing_month === month);
    const deskTotals = new Map<string, number>();
    for (const r of mockStore.monthly.filter((r) => r.billing_month === month)) {
      deskTotals.set(r.desk, (deskTotals.get(r.desk) ?? 0) + r.total_cost);
    }
    const skews: Record<string, number> = { rates: 0.08, risk: 0.02, credit: -0.06, UNALLOCATED: -0.35 };
    const rows: DeskCoverageRow[] = [];
    for (const [desk, total] of deskTotals) {
      const skew = skews[desk] ?? 0;
      for (const s of shares) {
        const pct =
          s.attribution_method === "TAG"
            ? Math.max(s.pct_of_month + skew, 0)
            : s.pct_of_month - skew / 4;
        rows.push({
          desk,
          attribution_method: s.attribution_method,
          cost: Math.round(total * Math.max(pct, 0) * 100) / 100,
        });
      }
    }
    return rows;
  }

  return query(
    `SELECT desk, attribution_method, SUM(cost) AS cost
     FROM ${T("cost_fact")}
     WHERE usage_date >= :month AND usage_date < add_months(:month, 1)
     GROUP BY 1, 2`,
    { month: monthStart(month) },
    z.object({
      desk: zStr,
      attribution_method: zStr,
      cost: zNum,
    }) as z.ZodType<DeskCoverageRow>,
  );
}

/** Leaderboard: TAG share per desk — social pressure for tagging adoption. */
export async function getDeskScorecard(month: string): Promise<DeskScorecardRow[]> {
  const coverage = await getDeskCoverage(month);
  const byDesk = new Map<string, DeskScorecardRow>();
  for (const r of coverage) {
    const e =
      byDesk.get(r.desk) ??
      ({ desk: r.desk, total_cost: 0, tag_cost: 0, tag_pct: 0, none_cost: 0 } as DeskScorecardRow);
    e.total_cost += r.cost;
    if (r.attribution_method === "TAG") e.tag_cost += r.cost;
    if (r.attribution_method === "NONE") e.none_cost += r.cost;
    byDesk.set(r.desk, e);
  }
  return [...byDesk.values()]
    .map((e) => ({ ...e, tag_pct: e.total_cost > 0 ? e.tag_cost / e.total_cost : 0 }))
    .sort((a, b) => b.tag_pct - a.tag_pct);
}
