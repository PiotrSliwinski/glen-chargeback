import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { query, T } from "@/dal/client";
import { listUsers } from "@/dal/mappings";
import { mockStore } from "@/dal/mock";
import { zDate, zId, zNum, zStr, zStrOrNull } from "@/dal/parse";
import type { JobAttributionRow, UnmappedRunnerRow } from "@/dal/types";

/**
 * Attribution-transparency reads on top of cost_fact: who is missing from the
 * mapping tables and how each job's spend actually landed. Both refresh when
 * mappings change (mutations expire 'mappings' + 'queue' together).
 */

/**
 * Inner scan shared by getUnmappedRunners and the work queue's unknown
 * runners: per-runner 30-day activity regardless of user_mapping membership.
 * Deliberately membership-independent so user saves never re-run it — the
 * membership filter lives in the cheap "mappings"-tagged wrappers. LIMIT 500
 * leaves headroom for those filters to still fill their lists even when the
 * biggest spenders are already mapped.
 */
export async function getRunnerActivity30d(): Promise<UnmappedRunnerRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  return query(
    `SELECT runner,
            SUM(cost)                    AS cost_30d,
            SUM(CASE WHEN is_serverless THEN cost ELSE 0 END) AS serverless_cost_30d,
            SUM(dbus)                    AS dbus_30d,
            COUNT(*)                     AS rows_30d,
            COUNT(DISTINCT workspace_id) AS workspace_count,
            MAX_BY(usage_category, cost) AS top_category,
            MAX(usage_date)              AS last_seen
     FROM ${T("cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND runner IS NOT NULL
       AND runner <> 'UNALLOCATED_IDLE'
     GROUP BY runner ORDER BY cost_30d DESC LIMIT 500`,
    {},
    z.object({
      runner: zStr,
      cost_30d: zNum,
      serverless_cost_30d: zNum,
      dbus_30d: zNum,
      rows_30d: zNum,
      workspace_count: zNum,
      top_category: zStr,
      last_seen: zDate,
    }) as z.ZodType<UnmappedRunnerRow>,
  );
}

/**
 * ALL runners with spend in the trailing 30 days who are NOT in user_mapping —
 * humans and service principals (GUID application ids) alike. No is_serverless
 * filter: SPNs mostly run classic job compute (is_serverless = false, or NULL
 * on per-query warehouse rows), so a serverless-only scan silently hides them.
 * Serverless spend is broken out as a column instead, because that slice is
 * the one the USER rule (waterfall rule 6) can never catch while unmapped.
 */
/**
 * Plain wrapper (NOT "use cache", see dal/workQueue getUnknownWorkspaces): a
 * user save recomputes this from the cached activity scan + one user_mapping
 * read, no rescan. Must stay plain — a "use cache" wrapper calling another
 * "use cache" (getRunnerActivity30d) deadlocks the prod build when re-rendered
 * inside a mapping action's updateTag.
 */
export async function getUnmappedRunners(): Promise<UnmappedRunnerRow[]> {
  if (env.DAL_MOCK) return [...mockStore.unmappedRunners];
  const [activity, users] = await Promise.all([getRunnerActivity30d(), listUsers()]);
  const mapped = new Set(users.map((u) => u.user_id));
  return activity.filter((r) => !mapped.has(r.runner)).slice(0, 100);
}

/**
 * Attribution outcome for every job that emitted cost in the trailing
 * 30 days: one row per (workspace, job, method, product) — a job that was
 * bridge-mapped mid-month and then tagged at source shows both rows.
 */
export async function getJobAttributions(): Promise<JobAttributionRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  cacheTag("mappings");
  if (env.DAL_MOCK) return [...mockStore.jobAttributions];
  return query(
    // tags_json: the slice's costliest row's tags — what the tag rules saw
    `SELECT workspace_id, job_id, MAX(job_name) AS job_name,
            attribution_method, data_product, desk,
            MAX_BY(tags_json, cost) AS tags_json,
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
      tags_json: zStrOrNull,
      dbus_30d: zNum,
      cost_30d: zNum,
    }) as z.ZodType<JobAttributionRow>,
  );
}
