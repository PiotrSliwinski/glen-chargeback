import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { query, T } from "@/dal/client";
import { getRunnerActivity30d } from "@/dal/insights";
import { listUsers } from "@/dal/mappings";
import { mockStore } from "@/dal/mock";
import { zId, zIdOrNull, zNum, zStr, zStrOrNull } from "@/dal/parse";
import type {
  RogueTagRow,
  UnassignedWarehouseRow,
  UnknownRunnerRow,
  UnknownWorkspaceRow,
  UntaggedJobRow,
} from "@/dal/types";

/**
 * Work-queue reads (Methodology §7.2 / §7.3 → §10.4). All queries look at
 * the trailing 30 days of cost_fact — "what to map or tag next".
 */

export async function getUntaggedJobs(): Promise<UntaggedJobRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  if (env.DAL_MOCK) return [...mockStore.queueUntaggedJobs];
  return query(
    `SELECT usage_category, workspace_id,
            COALESCE(job_name, warehouse_id, runner, 'unknown') AS work_item,
            job_id, runner, SUM(cost) AS unallocated_cost_30d
     FROM ${T("cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND attribution_method = 'NONE'
       AND usage_category <> 'SQL_WAREHOUSE'
     GROUP BY 1, 2, 3, 4, 5 ORDER BY unallocated_cost_30d DESC LIMIT 50`,
    {},
    z.object({
      usage_category: zStr,
      workspace_id: zId,
      work_item: zStr,
      job_id: zIdOrNull,
      runner: zStrOrNull,
      unallocated_cost_30d: zNum,
    }) as z.ZodType<UntaggedJobRow>,
  );
}

export async function getUnknownRunners(): Promise<UnknownRunnerRow[]> {
  "use cache";
  cacheLife("warehouse");
  // Also "mappings"-tagged: a user save recomputes this instantly from the
  // cached shared activity scan + one user_mapping read instead of a
  // cost_fact scan (the scan itself must not re-run inline — it froze the
  // save dialog).
  cacheTag("queue", "mappings");
  if (env.DAL_MOCK) return [...mockStore.queueUnknownRunners];
  const [activity, users] = await Promise.all([getRunnerActivity30d(), listUsers()]);
  const mapped = new Set(users.map((u) => u.user_id));
  return activity
    .filter((r) => !mapped.has(r.runner))
    .slice(0, 50)
    .map((r) => ({ runner: r.runner, cost_30d: r.cost_30d, rows_30d: r.rows_30d }));
}

export async function getUnknownWorkspaces(): Promise<UnknownWorkspaceRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  if (env.DAL_MOCK) return [...mockStore.queueUnknownWorkspaces];
  return query(
    `SELECT u.workspace_id, SUM(u.usage_quantity) AS dbus_30d
     FROM system.billing.usage u
     WHERE u.usage_date >= current_date() - INTERVAL 30 DAYS
       AND u.workspace_id NOT IN (SELECT workspace_id FROM ${T("workspace_mapping")})
     GROUP BY 1 ORDER BY 2 DESC`,
    {},
    z.object({ workspace_id: zId, dbus_30d: zNum }) as z.ZodType<UnknownWorkspaceRow>,
  );
}

export async function getRogueTags(): Promise<RogueTagRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  if (env.DAL_MOCK) return [...mockStore.queueRogueTags];
  return query(
    `SELECT raw_tag_data_product, SUM(cost) AS cost_30d, COUNT(*) AS rows_30d
     FROM ${T("cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND raw_tag_data_product IS NOT NULL
       AND data_domain = 'UNALLOCATED'
     GROUP BY 1 ORDER BY 2 DESC`,
    {},
    z.object({
      raw_tag_data_product: zStr,
      cost_30d: zNum,
      rows_30d: zNum,
    }) as z.ZodType<RogueTagRow>,
  );
}

export async function getUnassignedWarehouses(): Promise<UnassignedWarehouseRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  if (env.DAL_MOCK) return [...mockStore.queueUnassignedWarehouses];
  return query(
    // Warehouses attributed only via USER/NONE with a meaningful idle share —
    // candidates for a dedicated warehouse_product_mapping row.
    `SELECT warehouse_id, workspace_id, SUM(cost) AS cost_30d,
            SUM(CASE WHEN runner = 'UNALLOCATED_IDLE' THEN cost ELSE 0 END) / SUM(cost) AS idle_share
     FROM ${T("cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND warehouse_id IS NOT NULL
       AND attribution_method IN ('USER', 'NONE')
       AND warehouse_id NOT IN (
         SELECT warehouse_id FROM ${T("warehouse_product_mapping")} WHERE is_shared = true
       )
     GROUP BY 1, 2 ORDER BY cost_30d DESC LIMIT 50`,
    {},
    z.object({
      warehouse_id: zStr,
      workspace_id: zId,
      cost_30d: zNum,
      idle_share: zNum,
    }) as z.ZodType<UnassignedWarehouseRow>,
  );
}

export interface TaggedBridgeJob {
  workspace_id: string;
  job_id: string;
  data_product: string;
  tagged_cost_30d: number;
}

/**
 * Janitor (Methodology §8.3 / Phase 4): bridge rows whose jobs now emit
 * TAG-attributed cost — the tag at source has landed, the bridge row is
 * redundant and safe to remove.
 */
export async function getTaggedBridgeJobs(): Promise<TaggedBridgeJob[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  if (env.DAL_MOCK) {
    // fixture: pnl-explain (job 1022) has been tagged at source since mapping
    return mockStore.jobMappings
      .filter((j) => j.workspace_id === "2222222222222222" && j.job_id === "1022")
      .map((j) => ({
        workspace_id: j.workspace_id,
        job_id: j.job_id,
        data_product: j.data_product,
        tagged_cost_30d: 4870,
      }));
  }
  return query(
    `SELECT jm.workspace_id, jm.job_id, jm.data_product,
            SUM(cf.cost) AS tagged_cost_30d
     FROM ${T("job_product_mapping")} jm
     JOIN ${T("cost_fact")} cf
       ON  cf.workspace_id = jm.workspace_id
       AND cf.job_id = jm.job_id
       AND cf.attribution_method = 'TAG'
       AND cf.usage_date >= current_date() - INTERVAL 30 DAYS
     GROUP BY 1, 2, 3 ORDER BY tagged_cost_30d DESC`,
    {},
    z.object({
      workspace_id: zId,
      job_id: zId,
      data_product: zStr,
      tagged_cost_30d: zNum,
    }) as z.ZodType<TaggedBridgeJob>,
  );
}

export interface QueueSummary {
  untaggedJobs: number;
  unknownRunners: number;
  unknownWorkspaces: number;
  rogueTags: number;
  unassignedWarehouses: number;
  totalUnallocatedCost30d: number;
}

export async function getQueueSummary(): Promise<QueueSummary> {
  const [jobs, runners, workspaces, tags, warehouses] = await Promise.all([
    getUntaggedJobs(),
    getUnknownRunners(),
    getUnknownWorkspaces(),
    getRogueTags(),
    getUnassignedWarehouses(),
  ]);
  return {
    untaggedJobs: jobs.length,
    unknownRunners: runners.length,
    unknownWorkspaces: workspaces.length,
    rogueTags: tags.length,
    unassignedWarehouses: warehouses.length,
    totalUnallocatedCost30d:
      jobs.reduce((s, r) => s + r.unallocated_cost_30d, 0) +
      tags.reduce((s, r) => s + r.cost_30d, 0),
  };
}
