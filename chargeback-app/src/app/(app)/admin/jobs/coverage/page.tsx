import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { getJobAttributions } from "@/dal/insights";
import { listJobMappings, listWorkspaces } from "@/dal/mappings";
import { param, type SearchParams } from "@/lib/report-params";
import { KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { fmtMoney } from "@/lib/format";
import { EmptyState, KpiTile, MethodBadge, PageTitle } from "@/components/ui";
import { TableFilter } from "@/components/table-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePageSkeleton } from "@/components/loading-skeletons";
import type { AttributionMethod, JobAttributionRow, JobMappingRow } from "@/dal/types";

export const metadata = { title: "Job attribution coverage" };

const METHOD_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All jobs" },
  { key: "TAG", label: "Tagged at source" },
  { key: "JOB_MAPPING", label: "Via bridge" },
  { key: "NONE", label: "Unmapped" },
];

export default function JobCoveragePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Tracing job attributions…" kpis withPicker={false} />}>
      <JobCoverage searchParams={searchParams} />
    </Suspense>
  );
}

interface JobGroup {
  workspace_id: string;
  job_id: string;
  job_name: string | null;
  rows: JobAttributionRow[];
  methods: Set<AttributionMethod>;
  total_cost: number;
  bridge: JobMappingRow | undefined;
}

async function JobCoverage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const q = (param(sp.q) ?? "").toLowerCase();
  const method = param(sp.method) ?? "all";

  const [attributions, bridges, workspaces] = await Promise.all([
    getJobAttributions(),
    listJobMappings(),
    listWorkspaces(),
  ]);
  const wsName = new Map(workspaces.map((w) => [w.workspace_id, w.workspace_name]));
  const bridgeByKey = new Map(bridges.map((b) => [`${b.workspace_id}|${b.job_id}`, b]));

  // one group per job; a job can attribute via several methods within the window
  const groups = new Map<string, JobGroup>();
  for (const row of attributions) {
    const key = `${row.workspace_id}|${row.job_id}`;
    const g = groups.get(key) ?? {
      workspace_id: row.workspace_id,
      job_id: row.job_id,
      job_name: row.job_name,
      rows: [],
      methods: new Set<AttributionMethod>(),
      total_cost: 0,
      bridge: bridgeByKey.get(key),
    };
    g.rows.push(row);
    g.methods.add(row.attribution_method);
    g.total_cost += row.cost_30d;
    g.job_name ??= row.job_name;
    groups.set(key, g);
  }
  const all = [...groups.values()].sort((a, b) => b.total_cost - a.total_cost);

  const kpis = {
    jobs: all.length,
    tagged: all.filter((g) => g.methods.has("TAG") && !g.methods.has("NONE")).length,
    bridged: all.filter((g) => g.methods.has("JOB_MAPPING")).length,
    unmappedCost: all
      .filter((g) => g.methods.has("NONE"))
      .reduce((s, g) => s + g.rows.filter((r) => r.attribution_method === "NONE").reduce((c, r) => c + r.cost_30d, 0), 0),
  };

  const matchesQ = (g: JobGroup) =>
    !q ||
    [
      g.job_name ?? "",
      g.job_id,
      g.workspace_id,
      wsName.get(g.workspace_id) ?? "",
      ...g.rows.flatMap((r) => [r.data_product, r.desk]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  const shown = all.filter(
    (g) => matchesQ(g) && (method === "all" || g.methods.has(method as AttributionMethod)),
  );

  return (
    <div>
      <PageTitle
        title="Job attribution coverage"
        subtitle="Every job that emitted cost in the trailing 30 days and how it was mapped — tag, bridge row, or nothing. The transparency behind the waterfall."
        info={PAGE_HELP.jobCoverage}
      >
        <Button asChild variant="outline">
          <Link href="/admin/jobs">← Job bridge</Link>
        </Button>
      </PageTitle>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Jobs seen 30d" value={String(kpis.jobs)} info={KPI_HELP.jobsSeen30d} />
        <KpiTile
          label="Tagged at source"
          value={String(kpis.tagged)}
          hint="attribute via TAG only — goal state"
          tone="good"
          info={KPI_HELP.jobsTagged}
        />
        <KpiTile
          label="Via job bridge"
          value={String(kpis.bridged)}
          hint="candidates for tagging at source"
          tone={kpis.bridged > 0 ? "warn" : "good"}
          info={KPI_HELP.jobsBridged}
        />
        <KpiTile
          label="Unmapped job cost 30d"
          value={fmtMoney(kpis.unmappedCost)}
          hint="attribution NONE — fix in the work queue"
          tone={kpis.unmappedCost > 0 ? "bad" : "good"}
          info={KPI_HELP.jobsUnmappedCost}
          infoAlign="end"
        />
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        {METHOD_FILTERS.map((f) => {
          const href = `/admin/jobs/coverage?${new URLSearchParams({
            ...(f.key !== "all" ? { method: f.key } : {}),
            ...(q ? { q } : {}),
          })}`;
          const active = method === f.key;
          return (
            <Button key={f.key} asChild size="sm" variant={active ? "default" : "outline"}>
              <Link href={href}>{f.label}</Link>
            </Button>
          );
        })}
        <div className="ml-auto">
          <TableFilter placeholder="Filter by job, workspace, product, desk…" />
        </div>
      </div>

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              message={
                all.length === 0
                  ? "No job cost in the trailing 30 days."
                  : "No jobs match the current filter."
              }
            />
          ) : (
            <>
              {(q || method !== "all") && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {shown.length} of {all.length} jobs shown
                </p>
              )}
              <Table className="align-top">
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Attributed as</TableHead>
                    <TableHead className="text-right">Cost 30d</TableHead>
                    <TableHead>Bridge row</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((g) => (
                    <TableRow key={`${g.workspace_id}|${g.job_id}`}>
                      <TableCell>
                        <p className="text-sm font-medium">{g.job_name ?? "—"}</p>
                        <p className="font-mono text-xs text-muted-foreground">job {g.job_id}</p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {wsName.get(g.workspace_id) ?? (
                          <span className="font-mono">UNMAPPED: {g.workspace_id}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1.5">
                          {[...g.rows]
                            .sort((a, b) => b.cost_30d - a.cost_30d)
                            .map((r) => (
                              <div
                                key={`${r.attribution_method}|${r.data_product}|${r.desk}`}
                                className="flex flex-wrap items-center gap-2 text-xs"
                              >
                                <MethodBadge method={r.attribution_method} />
                                <span className="font-mono">{r.data_product}</span>
                                <span className="text-muted-foreground">→ desk {r.desk}</span>
                                <span className="tabular-nums text-muted-foreground">
                                  {fmtMoney(r.cost_30d)}
                                </span>
                              </div>
                            ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMoney(g.total_cost)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {g.bridge ? (
                          <>
                            <p className="font-mono text-foreground">{g.bridge.data_product}</p>
                            <p>
                              {g.bridge.mapped_by ?? "—"}
                              {g.bridge.mapped_at && <> · {g.bridge.mapped_at.slice(0, 10)}</>}
                            </p>
                            {g.bridge.note && <p className="italic">“{g.bridge.note}”</p>}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <JobStatus group={g} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        A job with several “attributed as” lines changed how it attributes within the window —
        e.g. bridge-mapped early, tagged at source since. TAG always wins from the moment the tag
        lands; the bridge row then only matters for rows from before that.
      </p>
    </div>
  );
}

function JobStatus({ group }: { group: JobGroup }) {
  if (group.methods.has("NONE")) {
    return (
      <Link href="/queue" className="inline-block">
        <Badge variant="secondary" className="bg-red-100 text-red-800 hover:underline">
          unmapped → work queue
        </Badge>
      </Link>
    );
  }
  if (group.methods.has("TAG") && group.bridge) {
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
        tag landed — bridge removable
      </Badge>
    );
  }
  if (group.methods.has("JOB_MAPPING")) {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-800">
        via bridge — tag at source
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
      tagged at source
    </Badge>
  );
}
