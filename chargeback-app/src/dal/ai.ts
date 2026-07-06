import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { monthStart } from "@/lib/format";
import { query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zId, zMonth, zNum, zStr, zStrOrNull } from "@/dal/parse";
import type { AiEndpointUsageRow, AiTrendPoint, UnmappedEndpointRow } from "@/dal/types";

/**
 * AI cost tracking (Methodology §6B): model serving — realtime endpoints and
 * ai_query batch inference alike — plus vector search and the other AI-native
 * billing origins, read from the same cost_fact every other report uses, so
 * AI figures always reconcile with the monthly chargeback.
 *
 * Freshness caveat: system.billing.usage lags real usage by ~1–2 hours (no
 * official SLA) and the billing pipeline emits hourly aggregates before DBUs
 * appear in the system tables — the current day's AI spend is always
 * incomplete. Every AI screen states this.
 */

/** billing_origin_product values counted as AI spend — keep in sync with PAGE_HELP.ai. */
export const AI_CATEGORIES = [
  "MODEL_SERVING",
  "VECTOR_SEARCH",
  "FOUNDATION_MODEL_TRAINING",
  "AGENT_EVALUATION",
] as const;

export const isAiCategory = (category: string): boolean =>
  (AI_CATEGORIES as readonly string[]).includes(category);

/** SQL literal list — constants only, never user input. */
const AI_CATEGORY_LIST = AI_CATEGORIES.map((c) => `'${c}'`).join(", ");

/** Scale a base fixture by the mock month factor (growth trend). */
const mockScale = (month: string) => mockStore.monthFactor[month] ?? 0;

/**
 * One month's AI spend per endpoint × offering type × product × desk, from
 * live cost_fact (endpoint detail is never snapshotted — published mode shows
 * the same live rows, which the page states).
 */
export async function getAiEndpointUsage(month: string): Promise<AiEndpointUsageRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("reports-live");

  if (env.DAL_MOCK) {
    const f = mockScale(month);
    return mockStore.aiEndpointUsage
      .map((r) => ({
        ...r,
        dbus: Math.round(r.dbus * f),
        cost: Math.round(r.cost * f * 100) / 100,
      }))
      .filter((r) => r.cost > 0)
      .sort((a, b) => b.cost - a.cost);
  }

  return query(
    `SELECT endpoint_name, serving_type, usage_category, workspace_id,
            data_product, desk, attribution_method,
            SUM(dbus) AS dbus, SUM(cost) AS cost
     FROM ${T("cost_fact")}
     WHERE usage_date >= :month AND usage_date < add_months(:month, 1)
       AND usage_category IN (${AI_CATEGORY_LIST})
     GROUP BY 1, 2, 3, 4, 5, 6, 7
     ORDER BY cost DESC LIMIT 500`,
    { month: monthStart(month) },
    z.object({
      endpoint_name: zStrOrNull,
      serving_type: zStrOrNull,
      usage_category: zStr,
      workspace_id: zId,
      data_product: zStr,
      desk: zStr,
      attribution_method: zStr,
      dbus: zNum,
      cost: zNum,
    }) as z.ZodType<AiEndpointUsageRow>,
  );
}

/** AI cost per month × usage category, trailing 12 months — the AI trend feed. */
export async function getAiTrend(month: string): Promise<AiTrendPoint[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("reports-live");

  if (env.DAL_MOCK) {
    const window = mockStore.months.filter((m) => m <= month).slice(-12);
    const map = new Map<string, AiTrendPoint>();
    for (const r of mockStore.monthly) {
      if (!window.includes(r.billing_month) || !isAiCategory(r.usage_category)) continue;
      const key = `${r.billing_month}|${r.usage_category}`;
      const e = map.get(key) ?? {
        billing_month: r.billing_month,
        usage_category: r.usage_category,
        total_cost: 0,
      };
      e.total_cost += r.total_cost;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => a.billing_month.localeCompare(b.billing_month));
  }

  return query(
    `SELECT billing_month, usage_category, SUM(total_cost) AS total_cost
     FROM ${T("monthly_chargeback")}
     WHERE billing_month > add_months(:month, -12) AND billing_month <= :month
       AND usage_category IN (${AI_CATEGORY_LIST})
     GROUP BY 1, 2 ORDER BY 1`,
    { month: monthStart(month) },
    z.object({
      billing_month: zMonth,
      usage_category: zStr,
      total_cost: zNum,
    }) as z.ZodType<AiTrendPoint>,
  );
}

/**
 * Endpoints whose trailing-30-day spend fell to UNALLOCATED — the candidates
 * for tagging at source or an endpoint-bridge row (rule 4b).
 */
export async function getUnmappedEndpoints(): Promise<UnmappedEndpointRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");

  if (env.DAL_MOCK) {
    return mockStore.aiEndpointUsage
      .filter((r) => r.endpoint_name != null && r.attribution_method === "NONE")
      .map((r) => ({
        workspace_id: r.workspace_id,
        endpoint_name: r.endpoint_name!,
        serving_type: r.serving_type,
        cost_30d: r.cost,
      }))
      .sort((a, b) => b.cost_30d - a.cost_30d);
  }

  return query(
    `SELECT workspace_id, endpoint_name,
            MAX(serving_type) AS serving_type, SUM(cost) AS cost_30d
     FROM ${T("cost_fact")}
     WHERE endpoint_name IS NOT NULL
       AND attribution_method = 'NONE'
       AND usage_date >= current_date() - INTERVAL 30 DAYS
     GROUP BY 1, 2 ORDER BY cost_30d DESC`,
    {},
    z.object({
      workspace_id: zId,
      endpoint_name: zStr,
      serving_type: zStrOrNull,
      cost_30d: zNum,
    }) as z.ZodType<UnmappedEndpointRow>,
  );
}
