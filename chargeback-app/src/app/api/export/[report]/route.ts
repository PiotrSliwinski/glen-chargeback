import { getSession } from "@/lib/auth";
import { atLeast, type Role } from "@/lib/rbac";
import { csvResponse, toCsv } from "@/lib/csv";
import { getDeskMovement, getProductMovement } from "@/dal/movement";
import { getDeskScorecard } from "@/dal/desks";
import {
  getDashboard,
  getDeskInvoice,
  getMonthlyRows,
  getPublishedMonths,
} from "@/dal/reports";
import { listCatalogue } from "@/dal/mappings";
import { getAiEndpointUsage, getUnmappedEndpoints } from "@/dal/ai";
import { getAzureMonthResources } from "@/dal/azure";
import {
  getRogueTags,
  getUnassignedWarehouses,
  getUnknownRunners,
  getUnknownWorkspaces,
  getUnmatchedAzureResources,
  getUntaggedJobs,
} from "@/dal/workQueue";
import type { ReportMode } from "@/dal/types";

/**
 * CSV exports — one route, one report per name, reusing the cached DAL reads.
 * Role model mirrors the pages: reports are viewer+, queues/catalogue steward+.
 */

type Fetcher = (q: {
  month: string;
  mode: ReportMode;
  desk: string | null;
}) => Promise<object[]>;

const REPORTS: Record<string, { role: Role; fetch: Fetcher }> = {
  "monthly-chargeback": {
    role: "viewer",
    fetch: ({ month, mode }) => getMonthlyRows(month, mode),
  },
  coverage: {
    role: "viewer",
    fetch: async ({ month, mode }) => (await getDashboard(month, mode)).coverage,
  },
  movement: {
    role: "viewer",
    fetch: ({ month, mode }) => getDeskMovement(month, mode),
  },
  "movement-products": {
    role: "viewer",
    fetch: ({ month, mode }) => getProductMovement(month, mode),
  },
  scorecard: {
    role: "viewer",
    fetch: ({ month }) => getDeskScorecard(month),
  },
  "ai-endpoints": {
    role: "viewer",
    // endpoint detail is live-only — cost_fact is never snapshotted
    fetch: ({ month }) => getAiEndpointUsage(month),
  },
  "azure-resources": {
    role: "viewer",
    // Azure cost is live-only — it never enters the published snapshot
    fetch: ({ month }) => getAzureMonthResources(month),
  },
  "desk-invoice": {
    role: "viewer",
    fetch: async ({ month, desk }) => {
      if (!desk) throw new Error("desk parameter required");
      return getDeskInvoice(month, desk);
    },
  },
  catalogue: { role: "steward", fetch: () => listCatalogue() },
  "queue-jobs": { role: "steward", fetch: () => getUntaggedJobs() },
  "queue-runners": { role: "steward", fetch: () => getUnknownRunners() },
  "queue-workspaces": { role: "steward", fetch: () => getUnknownWorkspaces() },
  "queue-tags": { role: "steward", fetch: () => getRogueTags() },
  "queue-warehouses": { role: "steward", fetch: () => getUnassignedWarehouses() },
  "queue-azure": { role: "steward", fetch: () => getUnmatchedAzureResources() },
  "queue-endpoints": { role: "steward", fetch: () => getUnmappedEndpoints() },
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  const { report } = await params;
  const def = REPORTS[report];
  if (!def) return new Response("unknown report", { status: 404 });

  const session = await getSession();
  if (!session) return new Response("unauthenticated", { status: 401 });
  if (!atLeast(session.user.role, def.role)) return new Response("forbidden", { status: 403 });

  const url = new URL(request.url);
  const mode: ReportMode = url.searchParams.get("mode") === "published" ? "published" : "live";
  const desk = url.searchParams.get("desk");
  let month = url.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const published = await getPublishedMonths();
    month = published[0] ?? new Date().toISOString().slice(0, 7);
  }

  try {
    const rows = await def.fetch({ month, mode, desk });
    const suffix = desk ? `-${desk}` : "";
    return csvResponse(toCsv(rows), `${report}${suffix}-${month}-${mode}.csv`);
  } catch (e) {
    console.error("[export]", report, e);
    return new Response("export failed — check server logs", { status: 500 });
  }
}
