import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zDate, zId, zNum, zStr, zStrOrNull } from "@/dal/parse";
import type { JobAttributionRow, ServerlessGapRow } from "@/dal/types";

/**
 * Attribution-transparency reads on top of cost_fact: who is missing from the
 * mapping tables and how each job's spend actually landed. Both refresh when
 * mappings change (mutations expire 'mappings' + 'queue' together).
 */

/**
 * Runners with serverless spend in the trailing 30 days who are NOT in
 * user_mapping. Serverless compute has no warehouse to classify, so an
 * unmapped runner means the USER rule (waterfall rule 4) can never catch
 * their ad-hoc serverless spend — it falls straight to NONE.
 */
export async function getServerlessGap(): Promise<ServerlessGapRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("queue");
  cacheTag("mappings");
  if (env.DAL_MOCK) return [...mockStore.serverlessGap];
  return query(
    `SELECT runner,
            SUM(cost)                    AS serverless_cost_30d,
            SUM(dbus)                    AS serverless_dbus_30d,
            COUNT(*)                     AS rows_30d,
            COUNT(DISTINCT workspace_id) AS workspace_count,
            MAX_BY(usage_category, cost) AS top_category,
            MAX(usage_date)              AS last_seen
     FROM ${T("cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND is_serverless = true
       AND runner IS NOT NULL
       AND runner <> 'UNALLOCATED_IDLE'
       AND runner NOT IN (SELECT user_id FROM ${T("user_mapping")})
     GROUP BY runner ORDER BY serverless_cost_30d DESC LIMIT 100`,
    {},
    z.object({
      runner: zStr,
      serverless_cost_30d: zNum,
      serverless_dbus_30d: zNum,
      rows_30d: zNum,
      workspace_count: zNum,
      top_category: zStr,
      last_seen: zDate,
    }) as z.ZodType<ServerlessGapRow>,
  );
}

/**
 * Attribution outcome for every job that emitted cost in the trailing
 * 30 days: one row per (workspace, job, method, product) — a job that was
 * bridge-mapped mid-month and then tagged at source shows both rows.
 */
export async function getJobAttributions(): Promise<JobAttributionRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("queue");
  cacheTag("mappings");
  if (env.DAL_MOCK) return [...mockStore.jobAttributions];
  return query(
    `SELECT workspace_id, job_id, MAX(job_name) AS job_name,
            attribution_method, data_product, desk,
            SUM(dbus) AS dbus_30d, SUM(cost) AS cost_30d
     FROM ${T("cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND job_id IS NOT NULL
     GROUP BY workspace_id, job_id, attribution_method, data_product, desk
     ORDER BY cost_30d DESC LIMIT 500`,
    {},
    z.object({
      workspace_id: zId,
      job_id: zId,
      job_name: zStrOrNull,
      attribution_method: zStr,
      data_product: zStr,
      desk: zStr,
      dbus_30d: zNum,
      cost_30d: zNum,
    }) as z.ZodType<JobAttributionRow>,
  );
}
