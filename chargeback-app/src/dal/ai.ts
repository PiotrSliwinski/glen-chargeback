import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { monthStart } from "@/lib/format";
import { query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zDate, zId, zMonth, zNum, zStr, zStrOrNull } from "@/dal/parse";
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
 * One month's AI spend per endpoint × offering type × runner × product ×
 * desk, from live cost_fact (endpoint detail is never snapshotted — published
 * mode shows the same live rows, which the page states). runner is
 * identity_metadata.run_as carried through usage_view; first/last_seen are
 * the first/last usage_date with spend — day precision, because cost_fact is
 * daily. Per-call counts/timestamps are NOT derivable from billing data:
 * system.billing.usage emits pre-aggregated records, not one row per
 * inference call.
 */
export async function getAiEndpointUsage(month: string): Promise<AiEndpointUsageRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("reports-live");

  if (env.DAL_MOCK) {
    const f = mockScale(month);
    // fixtures carry base-month dates; re-month them so first/last seen
    // always fall inside the requested month
    const remonth = (d: string) => `${month}-${d.slice(8)}`;
    // workspace name resolved at read time so admin edits reflect immediately
    const wsName = (id: string) =>
      mockStore.workspaces.find((w) => w.workspace_id === id)?.workspace_name ?? `UNMAPPED: ${id}`;
    return mockStore.aiEndpointUsage
      .map((r) => ({
        ...r,
        workspace_name: wsName(r.workspace_id),
        first_seen: remonth(r.first_seen),
        last_seen: remonth(r.last_seen),
        dbus: Math.round(r.dbus * f),
        cost: Math.round(r.cost * f * 100) / 100,
      }))
      .filter((r) => r.cost > 0)
      .sort((a, b) => b.cost - a.cost);
  }

  return query(
    `SELECT cf.endpoint_name, cf.serving_type, cf.usage_category, cf.workspace_id,
            COALESCE(MAX(wm.workspace_name),
                     CONCAT('UNMAPPED: ', cf.workspace_id)) AS workspace_name,
            cf.runner, MAX(cf.runner_name) AS runner_name,
            cf.data_product, cf.desk, cf.attribution_method,
            MIN(cf.usage_date) AS first_seen, MAX(cf.usage_date) AS last_seen,
            SUM(cf.dbus) AS dbus, SUM(cf.cost) AS cost
     FROM ${T("cost_fact")} cf
     LEFT JOIN ${T("workspace_mapping")} wm
       ON cf.workspace_id = wm.workspace_id
     WHERE cf.usage_date >= :month AND cf.usage_date < add_months(:month, 1)
       AND cf.usage_category IN (${AI_CATEGORY_LIST})
     GROUP BY cf.endpoint_name, cf.serving_type, cf.usage_category, cf.workspace_id,
              cf.runner, cf.data_product, cf.desk, cf.attribution_method
     ORDER BY cost DESC LIMIT 500`,
    { month: monthStart(month) },
    z.object({
      endpoint_name: zStrOrNull,
      serving_type: zStrOrNull,
      usage_category: zStr,
      workspace_id: zId,
      workspace_name: zStr,
      runner: zStrOrNull,
      runner_name: zStrOrNull,
      data_product: zStr,
      desk: zStr,
      attribution_method: zStr,
      first_seen: zDate,
      last_seen: zDate,
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
 * for tagging at source or an endpoint-bridge row (rule 4b). top_runner shows
 * who created the cost (run-as of the costliest slice) — often the fastest
 * fix is mapping that runner, which routes the spend to their desk via the
 * USER rule without any endpoint bridge.
 */
export async function getUnmappedEndpoints(): Promise<UnmappedEndpointRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");

  if (env.DAL_MOCK) {
    // one fixture row per unmapped endpoint, so per-row mapping suffices
    return mockStore.aiEndpointUsage
      .filter((r) => r.endpoint_name != null && r.attribution_method === "NONE")
      .map((r) => ({
        workspace_id: r.workspace_id,
        endpoint_name: r.endpoint_name!,
        serving_type: r.serving_type,
        top_runner: r.runner_name ?? r.runner,
        runner_count: r.runner == null ? 0 : 1,
        cost_30d: r.cost,
      }))
      .sort((a, b) => b.cost_30d - a.cost_30d);
  }

  return query(
    `SELECT workspace_id, endpoint_name,
            MAX(serving_type) AS serving_type,
            MAX_BY(COALESCE(runner_name, runner), cost) AS top_runner,
            COUNT(DISTINCT runner) AS runner_count,
            SUM(cost) AS cost_30d
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
      top_runner: zStrOrNull,
      runner_count: zNum,
      cost_30d: zNum,
    }) as z.ZodType<UnmappedEndpointRow>,
  );
}
