import Link from "next/link";
import { getJobAttributions } from "@/dal/insights";
import { listJobMappings, listWorkspaces } from "@/dal/mappings";
import { KPI_HELP } from "@/lib/kpi-help";
import { fmtMoney } from "@/lib/format";
import { EmptyState, FilteredCount, KpiTile, MethodBadge, METHOD_STYLE } from "@/components/ui";
import { mergeTagsJson, TagChips } from "@/components/tag-chips";
import { TableFilter } from "@/components/table-filter";
import { TablePagination } from "@/components/table-pagination";
import { paginate } from "@/lib/paginate";
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
import type { AttributionMethod, JobAttributionRow, JobMappingRow } from "@/dal/types";

const METHOD_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All jobs" },
  { key: "TAG", label: "Tagged at source" },
  { key: "JOB_MAPPING", label: "Via bridge" },
  { key: "TAG_RULE", label: "Via tag rule" },
  { key: "RUNNER_RULE", label: "Via runner rule" },
  { key: "NONE", label: "Unmapped" },
];

interface JobGroup {
  workspace_id: string;
  job_id: string;
  job_name: string | null;
  rows: JobAttributionRow[];
  methods: Set<AttributionMethod>;
  total_cost: number;
  bridge: JobMappingRow | undefined;
}

/** Read-only audit: how every job with recent cost was attributed. */
export async function CoverageView({
  q,
  method,
  page,
}: {
  q: string;
  method: string;
  page?: string;
}) {
  const query = q.toLowerCase();

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
    // disjoint from "Via bridge / rule": a job mid-transition (tagged AND still
    // bridge-attributed within the window) counts only as a cleanup candidate
    tagged: all.filter(
      (g) =>
        g.methods.has("TAG") &&
        !g.methods.has("NONE") &&
        !g.methods.has("JOB_MAPPING") &&
        !g.methods.has("TAG_RULE") &&
        !g.methods.has("RUNNER_RULE"),
    ).length,
    bridged: all.filter(
      (g) =>
        g.methods.has("JOB_MAPPING") || g.methods.has("TAG_RULE") || g.methods.has("RUNNER_RULE"),
    ).length,
    unmappedCost: all
      .filter((g) => g.methods.has("NONE"))
      .reduce((s, g) => s + g.rows.filter((r) => r.attribution_method === "NONE").reduce((c, r) => c + r.cost_30d, 0), 0),
  };

  const matchesQ = (g: JobGroup) =>
    !query ||
    [
      g.job_name ?? "",
      g.job_id,
      g.workspace_id,
      wsName.get(g.workspace_id) ?? "",
      ...g.rows.flatMap((r) => [r.data_product, r.desk]),
      ...Object.entries(mergeTagsJson(g.rows)).map(([k, v]) => `${k}=${v}`),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  const shown = all.filter(
    (g) => matchesQ(g) && (method === "all" || g.methods.has(method as AttributionMethod)),
  );
  const { rows: pageGroups, ...paged } = paginate(shown, page);

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile label="Jobs seen 30d" value={String(kpis.jobs)} info={KPI_HELP.jobsSeen30d} />
        <KpiTile
          label="Tagged at source"
          value={String(kpis.tagged)}
          hint="attribute via TAG only — goal state"
          tone="good"
          info={KPI_HELP.jobsTagged}
        />
        <KpiTile
          label="Via bridge / rule"
          value={String(kpis.bridged)}
          hint="candidates for tagging at source"
          tone={kpis.bridged > 0 ? "warn" : "good"}
          info={KPI_HELP.jobsBridged}
        />
        <KpiTile
          label="Unallocated job cost 30d"
          value={fmtMoney(kpis.unmappedCost)}
          hint="attribution NONE — fix in the work queue"
          tone={kpis.unmappedCost > 0 ? "bad" : "good"}
          info={KPI_HELP.jobsUnmappedCost}
          infoAlign="end"
        />
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        {METHOD_FILTERS.map((f) => {
          const href = `/admin/jobs?${new URLSearchParams({
            view: "coverage",
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
                <FilteredCount shown={shown.length} total={all.length} noun="job" />
              )}
              <Table className="align-top">
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Tags on the job</TableHead>
                    <TableHead>Attributed as</TableHead>
                    <TableHead className="text-right">Cost 30d</TableHead>
                    <TableHead>Bridge row</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageGroups.map((g) => (
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
                        <TagChips tags={mergeTagsJson(g.rows)} />
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
              <TablePagination {...paged} noun="job" />
            </>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        A job with several “attributed as” lines changed how it attributes within the window —
        e.g. bridge-mapped early, tagged at source since. TAG always wins from the moment the tag
        lands; bridge rows, tag rules and runner rules only matter for spend nothing earlier in
        the waterfall caught. Job spend never defaults to the runner&apos;s home desk — an
        unmapped job goes to the work queue instead.
      </p>
    </div>
  );
}

// Status chips reuse the waterfall palette from METHOD_STYLE — one source of
// truth, so the status column always matches the method badges next to it.
function JobStatus({ group }: { group: JobGroup }) {
  if (group.methods.has("NONE")) {
    return (
      <Link href="/queue" className="inline-block">
        <Badge variant="secondary" className={`${METHOD_STYLE.NONE.chip} hover:underline`}>
          unmapped → work queue
        </Badge>
      </Link>
    );
  }
  if (group.methods.has("TAG") && group.bridge) {
    return (
      <Badge variant="secondary" className={METHOD_STYLE.TAG.chip}>
        tag landed — bridge removable
      </Badge>
    );
  }
  if (group.methods.has("JOB_MAPPING")) {
    return (
      <Badge variant="secondary" className={METHOD_STYLE.JOB_MAPPING.chip}>
        via bridge — tag at source
      </Badge>
    );
  }
  if (group.methods.has("TAG_RULE")) {
    return (
      <Badge variant="secondary" className={METHOD_STYLE.TAG_RULE.chip}>
        via tag rule
      </Badge>
    );
  }
  if (group.methods.has("RUNNER_RULE")) {
    return (
      <Badge variant="secondary" className={METHOD_STYLE.RUNNER_RULE.chip}>
        via runner rule
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className={METHOD_STYLE.TAG.chip}>
      tagged at source
    </Badge>
  );
}
