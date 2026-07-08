import { shiftMonth } from "@/lib/format";
import { logDuration, logEvent, time } from "@/lib/log";
import { resolveReportParams } from "@/lib/report-params";
import {
  getDashboard,
  getDesks,
  getDomainProducts,
  getMonthlyRows,
} from "@/dal/reports";
import { getDeskScorecard } from "@/dal/desks";
import {
  getCostHistory,
  getCoverageTrend,
  getMonthlyTotals,
  getTaggingScorecard,
} from "@/dal/analytics";
import { getAiEndpointUsage, getAiTrend, getUnmappedEndpoints } from "@/dal/ai";
import {
  getAzureDeskTotals,
  getAzureMethodMix,
  getAzureMonthResources,
  getAzureMonthlyRows,
  getDefaultAzureMonth,
  getAzureResourceAttributions,
  getAzureTrend,
  getTaggedAzureBridgeResources,
  listAzureRgRules,
  listAzureResourceMappings,
  listAzureSubscriptionRules,
} from "@/dal/azure";
import {
  getQueueSummary,
  getRogueTags,
  getTaggedBridgeJobs,
  getUnassignedWarehouses,
  getUnknownRunners,
  getUnknownWorkspaces,
  getUntaggedJobs,
} from "@/dal/workQueue";
import { getJobAttributions, getUnmappedRunners } from "@/dal/insights";
import {
  listCatalogue,
  listEndpointMappings,
  listJobMappings,
  listRunnerRules,
  listTagRules,
  listUsers,
  listWarehouseMappings,
  listWorkspaces,
} from "@/dal/mappings";
import { listDbuDiscounts } from "@/dal/discounts";

/**
 * Re-fills, in one pass, every cache entry the tabs read on their default
 * view, so that after "Refresh data" the whole app serves from cache again
 * (Power BI import-model semantics: the refresh pays for the queries, the
 * clicks afterwards are free). Called by actions/refresh.ts right after it
 * expires the tags — updateTag's read-your-writes guarantee means each call
 * below misses and stores a fresh result.
 *
 * Scope: the default month (latest closed) in live mode, plus the latest
 * published month for the Invoices tab and the published toggle. Older
 * months, per-desk/per-product drill-downs and non-default filters stay
 * lazy — their parameter space is unbounded and each is a single cached
 * query on first visit. 'health' stays out entirely, same as in the refresh
 * action (its reconciliation can run for minutes).
 */
export type WarmResult = { warmed: number; failed: string[] };

type WarmTask = readonly [label: string, run: () => Promise<unknown>];

/**
 * Matches the DAL's idle-session pool size (client.ts MAX_IDLE_SESSIONS):
 * more concurrency would just churn extra warehouse sessions open/closed.
 */
const WARM_CONCURRENCY = 4;

type PoolResult = { failed: string[]; timings: { label: string; ms: number }[] };

async function runPool(tasks: WarmTask[]): Promise<PoolResult> {
  const failed: string[] = [];
  const timings: { label: string; ms: number }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const [label, run] = tasks[next++];
      const t0 = performance.now();
      try {
        await run();
        const ms = performance.now() - t0;
        timings.push({ label, ms });
        logDuration("warm", label, ms);
      } catch (e) {
        failed.push(label);
        // Warm failures matter regardless of APP_LOG level — keep them loud.
        console.warn(`[warm] ${label} failed:`, e instanceof Error ? e.message : e);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WARM_CONCURRENCY, tasks.length) }, worker),
  );
  return { failed, timings };
}

export async function warmWarehouseCache(): Promise<WarmResult> {
  const startedAt = performance.now();
  // Month lists first: they are expired cached reads themselves, and every
  // month-scoped query below keys off them. resolveReportParams with empty
  // search params yields exactly the month/mode each report page defaults to.
  const [{ month, publishedMonths }, azureMonth] = await time("warm", "month lists", () =>
    Promise.all([resolveReportParams(Promise.resolve({})), getDefaultAzureMonth()]),
  );
  const prevMonth = shiftMonth(month, -1);
  const publishedMonth: string | undefined = publishedMonths[0];

  // The dashboard runs ahead of the pool: the drill tab's per-domain queries
  // key off its domain list.
  const failed: string[] = [];
  let domains: string[] = [];
  try {
    domains = (
      await time("warm", "dashboard live", () => getDashboard(month, "live"))
    ).byDomain.map((d) => d.data_domain);
  } catch (e) {
    failed.push("dashboard live");
    console.warn("[warm] dashboard live failed:", e instanceof Error ? e.message : e);
  }

  const tasks: WarmTask[] = [
    // Dashboard / Report / Analytics (live mode defaults). prevMonth rows
    // also cover the movement tables, which compose getMonthlyRows.
    ["monthly rows live", () => getMonthlyRows(month, "live")],
    ["prev monthly rows live", () => getMonthlyRows(prevMonth, "live")],
    ["desk scorecard", () => getDeskScorecard(month)],
    ["monthly totals", () => getMonthlyTotals(month)],
    ["coverage trend", () => getCoverageTrend(month)],
    ["tagging scorecard", () => getTaggingScorecard(month)],
    ["product cost history", () => getCostHistory(month, "data_product")],
    ["desk cost history", () => getCostHistory(month, "desk")],
    ["desks live", () => getDesks(month, "live")],
    ...domains.map(
      (d): WarmTask => [`drill ${d}`, () => getDomainProducts(month, d, "live")],
    ),

    // AI tab (current + previous month, like the page's MoM comparison)
    ["ai trend", () => getAiTrend(month)],
    ["ai endpoints", () => getAiEndpointUsage(month)],
    ["prev ai endpoints", () => getAiEndpointUsage(prevMonth)],
    ["unmapped endpoints", () => getUnmappedEndpoints()],

    // Azure tab (its month axis is azure_monthly_chargeback's, not DBU's)
    ...(azureMonth
      ? ([
          ["azure monthly rows", () => getAzureMonthlyRows(azureMonth)],
          ["prev azure monthly rows", () => getAzureMonthlyRows(shiftMonth(azureMonth, -1))],
          ["azure trend", () => getAzureTrend(azureMonth)],
          ["azure method mix", () => getAzureMethodMix(azureMonth)],
          ["azure month resources", () => getAzureMonthResources(azureMonth)],
        ] as WarmTask[])
      : []),

    // Work queue
    ["queue summary", () => getQueueSummary()],
    ["untagged jobs", () => getUntaggedJobs()],
    ["unknown runners", () => getUnknownRunners()],
    ["unknown workspaces", () => getUnknownWorkspaces()],
    ["rogue tags", () => getRogueTags()],
    ["unassigned warehouses", () => getUnassignedWarehouses()],

    // Admin: reference data + attribution coverage views
    ["catalogue", () => listCatalogue()],
    ["job mappings", () => listJobMappings()],
    ["tag rules", () => listTagRules()],
    ["runner rules", () => listRunnerRules()],
    ["warehouse mappings", () => listWarehouseMappings()],
    ["endpoint mappings", () => listEndpointMappings()],
    ["users", () => listUsers()],
    ["workspaces", () => listWorkspaces()],
    ["dbu discounts", () => listDbuDiscounts()],
    ["tagged bridge jobs", () => getTaggedBridgeJobs()],
    ["job attributions", () => getJobAttributions()],
    ["unmapped runners", () => getUnmappedRunners()],
    ["azure resource mappings", () => listAzureResourceMappings()],
    ["azure rg rules", () => listAzureRgRules()],
    ["azure subscription rules", () => listAzureSubscriptionRules()],
    ["azure attributions", () => getAzureResourceAttributions()],
    ["azure desk totals", () => getAzureDeskTotals()],
    ["tagged azure bridge resources", () => getTaggedAzureBridgeResources()],

    // Invoices tab + the published toggle on report pages
    ...(publishedMonth
      ? ([
          ["desks published", () => getDesks(publishedMonth, "published")],
          ["dashboard published", () => getDashboard(publishedMonth, "published")],
          ["monthly rows published", () => getMonthlyRows(publishedMonth, "published")],
        ] as WarmTask[])
      : []),
  ];

  const { failed: poolFailed, timings } = await runPool(tasks);
  failed.push(...poolFailed);
  // +3 for the month lists, +1 for the dashboard that ran ahead of the pool
  const total = tasks.length + 4;

  const slowest = timings
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)
    .map((t) => `${t.label} ${Math.round(t.ms)}ms`)
    .join(", ");
  logEvent("warm", "pass complete", {
    warmed: total - failed.length,
    failed: failed.length,
    wallMs: Math.round(performance.now() - startedAt),
    slowest: slowest || undefined,
  });

  return { warmed: total - failed.length, failed };
}
