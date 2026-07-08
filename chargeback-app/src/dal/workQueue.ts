import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { query, T } from "@/dal/client";
import { getUnmappedEndpoints } from "@/dal/ai";
import { getRunnerActivity30d } from "@/dal/insights";
import { listUsers, listWarehouseMappings, listWorkspaces } from "@/dal/mappings";
import { mockStore } from "@/dal/mock";
import { zId, zIdOrNull, zNum, zStr, zStrOrNull } from "@/dal/parse";
import type {
  RogueTagRow,
  UnassignedWarehouseRow,
  UnknownRunnerRow,
  UnknownWorkspaceRow,
  UnmatchedAzureResourceRow,
  UntaggedJobRow,
} from "@/dal/types";

/**
 * Work-queue reads (Methodology §7.2 / §7.3 → §10.4): the trailing 30 days
 * of unattributed cost across all three sources — Databricks (cost_fact),
 * Azure (azure_cost_fact) and AI serving (via dal/ai) — "what to map or tag
 * next". Readers are uncapped so the queue counts and cost totals are honest;
 * the page paginates.
 */

export async function getUntaggedJobs(): Promise<UntaggedJobRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  if (env.DAL_MOCK) return [...mockStore.queueUntaggedJobs];
  return query(
    // endpoint-dimension rows are the AI queue's — one item, one queue
    `SELECT usage_category, workspace_id,
            COALESCE(job_name, warehouse_id, runner, 'unknown') AS work_item,
            job_id, runner, SUM(cost) AS unallocated_cost_30d
     FROM ${T("cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND attribution_method = 'NONE'
       AND usage_category <> 'SQL_WAREHOUSE'
       AND endpoint_name IS NULL
     GROUP BY 1, 2, 3, 4, 5 ORDER BY unallocated_cost_30d DESC`,
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

/**
 * Plain wrapper (NOT "use cache", see getUnknownWorkspaces): filters the cached
 * activity scan against the cached user_mapping list, so a user save recomputes
 * it read-your-writes with no cost_fact rescan. Must stay plain — a "use cache"
 * wrapper calling another "use cache" (getRunnerActivity30d) deadlocks the prod
 * build when re-rendered inside a mapping action's updateTag.
 */
export async function getUnknownRunners(): Promise<UnknownRunnerRow[]> {
  if (env.DAL_MOCK) return [...mockStore.queueUnknownRunners];
  const [activity, users] = await Promise.all([getRunnerActivity30d(), listUsers()]);
  const mapped = new Set(users.map((u) => u.user_id));
  return activity
    .filter((r) => !mapped.has(r.runner))
    .map((r) => ({ runner: r.runner, cost_30d: r.cost_30d, rows_30d: r.rows_30d }));
}

/**
 * Inner scan: 30-day DBUs per workspace, regardless of workspace_mapping
 * membership. Split out (like getRunnerActivity30d) so a workspace save never
 * re-runs this billing.usage scan inline — the membership filter lives in the
 * cheap "mappings"-tagged wrapper below, which froze the save dialog when it
 * had to rescan.
 */
export async function getWorkspaceDbus30d(): Promise<UnknownWorkspaceRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  if (env.DAL_MOCK) return [...mockStore.queueUnknownWorkspaces];
  return query(
    `SELECT u.workspace_id, SUM(u.usage_quantity) AS dbus_30d
     FROM system.billing.usage u
     WHERE u.usage_date >= current_date() - INTERVAL 30 DAYS
     GROUP BY 1 ORDER BY 2 DESC`,
    {},
    z.object({ workspace_id: zId, dbus_30d: zNum }) as z.ZodType<UnknownWorkspaceRow>,
  );
}

/**
 * Plain wrapper (NOT "use cache"): filters the cached DBU scan against the
 * cached workspace_mapping list in memory. Both inputs are cached — the
 * expensive billing.usage scan under "queue", the mapping list under
 * "mappings" — so registering/removing a workspace refreshes this read-your-
 * writes with no rescan. It must stay plain: a "use cache" wrapper that calls
 * another "use cache" deadlocks the prod build when re-rendered inside a
 * mapping action's updateTag (dev's JIT tolerates it; `next start` hangs).
 */
export async function getUnknownWorkspaces(): Promise<UnknownWorkspaceRow[]> {
  const [activity, workspaces] = await Promise.all([getWorkspaceDbus30d(), listWorkspaces()]);
  const mapped = new Set(workspaces.map((w) => w.workspace_id));
  return activity.filter((r) => !mapped.has(r.workspace_id));
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

/**
 * Inner scan: 30-day cost + idle share per warehouse billing via USER/NONE,
 * regardless of warehouse_product_mapping membership. Split out so a warehouse
 * save never re-runs this cost_fact scan inline — the cheap "mappings"-tagged
 * wrapper below drops the ones already marked shared.
 */
export async function getWarehouseActivity30d(): Promise<UnassignedWarehouseRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue");
  if (env.DAL_MOCK) return [...mockStore.queueUnassignedWarehouses];
  return query(
    `SELECT warehouse_id, workspace_id, SUM(cost) AS cost_30d,
            SUM(CASE WHEN runner = 'UNALLOCATED_IDLE' THEN cost ELSE 0 END) / SUM(cost) AS idle_share
     FROM ${T("cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND warehouse_id IS NOT NULL
       AND attribution_method IN ('USER', 'NONE')
     GROUP BY 1, 2 ORDER BY cost_30d DESC`,
    {},
    z.object({
      warehouse_id: zStr,
      workspace_id: zId,
      cost_30d: zNum,
      idle_share: zNum,
    }) as z.ZodType<UnassignedWarehouseRow>,
  );
}

/**
 * Candidates for a dedicated warehouse_product_mapping row: warehouses billing
 * via USER/NONE that aren't already marked shared. Plain wrapper (NOT "use
 * cache", see getUnknownWorkspaces): filters the cached cost_fact scan against
 * the cached warehouse_product_mapping list in memory, so marking one shared
 * removes it read-your-writes via the "mappings" tag with no rescan.
 */
export async function getUnassignedWarehouses(): Promise<UnassignedWarehouseRow[]> {
  const [activity, mappings] = await Promise.all([
    getWarehouseActivity30d(),
    listWarehouseMappings(),
  ]);
  const shared = new Set(mappings.filter((m) => m.is_shared).map((m) => m.warehouse_id));
  return activity.filter((w) => !shared.has(w.warehouse_id));
}

/**
 * Azure resources whose trailing-30-day cost no waterfall rule matched
 * (attribution NONE in azure_cost_fact) — the Azure queue. Also tagged
 * 'azure' so rule edits on /admin/azure refresh it without a manual rescan.
 */
export async function getUnmatchedAzureResources(): Promise<UnmatchedAzureResourceRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("queue", "azure");
  if (env.DAL_MOCK) {
    return mockStore.azureAttributions
      .filter((a) => a.attribution_method === "NONE")
      .map((a) => ({
        subscription_id: a.subscription_id,
        resource_group: a.resource_group,
        resource_id: a.resource_id,
        resource_name: a.resource_name,
        meter_category: a.meter_category,
        cost_30d: a.cost_30d,
      }))
      .sort((a, b) => b.cost_30d - a.cost_30d);
  }
  return query(
    `SELECT subscription_id, resource_group, resource_id,
            MAX(resource_name) AS resource_name,
            MAX_BY(meter_category, cost) AS meter_category,
            SUM(cost) AS cost_30d
     FROM ${T("azure_cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND attribution_method = 'NONE'
       AND resource_id IS NOT NULL
     GROUP BY 1, 2, 3 ORDER BY cost_30d DESC`,
    {},
    z.object({
      subscription_id: zStr,
      resource_group: zStrOrNull,
      resource_id: zStr,
      resource_name: zStrOrNull,
      meter_category: zStrOrNull,
      cost_30d: zNum,
    }) as z.ZodType<UnmatchedAzureResourceRow>,
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
  unmatchedAzureResources: number;
  unmappedEndpoints: number;
  /** untagged jobs + rogue tags — the Databricks queues carrying real unallocated dollars */
  databricksUnallocatedCost30d: number;
  azureUnallocatedCost30d: number;
  aiUnallocatedCost30d: number;
  /** Databricks + Azure + AI — no queue's dollars are counted twice */
  totalUnallocatedCost30d: number;
}

export async function getQueueSummary(): Promise<QueueSummary> {
  const [jobs, runners, workspaces, tags, warehouses, azureResources, endpoints] =
    await Promise.all([
      getUntaggedJobs(),
      getUnknownRunners(),
      getUnknownWorkspaces(),
      getRogueTags(),
      getUnassignedWarehouses(),
      getUnmatchedAzureResources(),
      getUnmappedEndpoints(),
    ]);
  const databricks =
    jobs.reduce((s, r) => s + r.unallocated_cost_30d, 0) +
    tags.reduce((s, r) => s + r.cost_30d, 0);
  const azure = azureResources.reduce((s, r) => s + r.cost_30d, 0);
  const ai = endpoints.reduce((s, r) => s + r.cost_30d, 0);
  return {
    untaggedJobs: jobs.length,
    unknownRunners: runners.length,
    unknownWorkspaces: workspaces.length,
    rogueTags: tags.length,
    unassignedWarehouses: warehouses.length,
    unmatchedAzureResources: azureResources.length,
    unmappedEndpoints: endpoints.length,
    databricksUnallocatedCost30d: databricks,
    azureUnallocatedCost30d: azure,
    aiUnallocatedCost30d: ai,
    totalUnallocatedCost30d: databricks + azure + ai,
  };
}
