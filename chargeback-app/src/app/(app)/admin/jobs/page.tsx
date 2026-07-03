import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { listActiveProducts, listJobMappings, listWorkspaces } from "@/dal/mappings";
import { getTaggedBridgeJobs, getUntaggedJobs } from "@/dal/workQueue";
import { deleteJobMappingAction, mapJobAction } from "@/actions/mappings";
import { param, type SearchParams } from "@/lib/report-params";
import { ActionForm, Field, SelectField } from "@/components/action-form";
import { PAGE_HELP } from "@/lib/kpi-help";
import { EmptyState, KpiTile, PageTitle } from "@/components/ui";
import { TableFilter } from "@/components/table-filter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtMoney } from "@/lib/format";
import { TablePageSkeleton } from "@/components/loading-skeletons";

export const metadata = { title: "Job bridge" };

export default function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading job mappings from Databricks…" kpis withPicker={false} />}>
      <Jobs searchParams={searchParams} />
    </Suspense>
  );
}

async function Jobs({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const q = (param(sp.q) ?? "").toLowerCase();

  const [rows, products, workspaces, taggedJobs, untaggedJobs] = await Promise.all([
    listJobMappings(),
    listActiveProducts(),
    listWorkspaces(),
    getTaggedBridgeJobs(),
    getUntaggedJobs(),
  ]);
  const productOptions = products.map((p) => ({
    value: p.data_product,
    label: `${p.data_product} (${p.desk})`,
  }));
  const wsName = new Map(workspaces.map((w) => [w.workspace_id, w.workspace_name]));
  const productsReferenced = new Set(rows.map((r) => r.data_product)).size;

  const shown = rows.filter(
    (r) =>
      !q ||
      `${wsName.get(r.workspace_id) ?? ""} ${r.workspace_id} ${r.job_id} ${r.data_product} ${r.note ?? ""} ${r.mapped_by ?? ""}`
        .toLowerCase()
        .includes(q),
  );

  return (
    <div>
      <PageTitle
        title="Job bridge"
        subtitle="job_product_mapping — manual bridge for jobs not yet tagged at source (waterfall rule 2). Target state: this table is empty."
        info={PAGE_HELP.jobs}
      >
        <Button asChild variant="outline">
          <Link href="/admin/jobs/coverage">How jobs were attributed →</Link>
        </Button>
      </PageTitle>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Bridge rows"
          value={String(rows.length)}
          hint="goal state: 0 — tag at source"
          tone={rows.length === 0 ? "good" : "default"}
        />
        <KpiTile
          label="Safe to remove"
          value={String(taggedJobs.length)}
          hint="now tagged at source (janitor)"
          tone={taggedJobs.length > 0 ? "warn" : "good"}
        />
        <KpiTile
          label="Products referenced"
          value={String(productsReferenced)}
          hint="block those products from retiring"
        />
        <KpiTile
          label="Untagged jobs 30d"
          value={String(untaggedJobs.length)}
          hint="in the work queue, waiting for a mapping"
          tone={untaggedJobs.length > 0 ? "warn" : "good"}
        />
      </div>

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <details>
          <Button asChild>
            <summary className="cursor-pointer">＋ Map a job</summary>
          </Button>
          <Card className="mt-3 max-w-md">
            <CardContent>
              <ActionForm
                action={mapJobAction}
                submitLabel="Map job"
                note="job_id is only unique within a workspace — both are required."
              >
                <SelectField
                  label="Workspace"
                  name="workspace_id"
                  options={workspaces.map((w) => ({
                    value: w.workspace_id,
                    label: `${w.workspace_name} (${w.workspace_id})`,
                  }))}
                />
                <Field label="Job ID" name="job_id" />
                <SelectField label="Data product" name="data_product" options={productOptions} />
                <Field label="Note (why mapped manually)" name="note" required={false} />
              </ActionForm>
            </CardContent>
          </Card>
        </details>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by workspace, job, product, note…" />
        </div>
      </div>

      {taggedJobs.length > 0 && (
        <Card className="mb-4 ring-emerald-200 bg-emerald-50/50">
          <CardHeader>
            <CardTitle className="text-emerald-800">
              🧹 Safe to remove — now tagged at source
            </CardTitle>
            <CardDescription className="text-xs text-emerald-700">
              These bridge rows point at jobs that produced TAG-attributed cost in the last 30
              days: the tag has landed, the bridge is redundant. Removing them shrinks this table
              toward its goal state (empty). The tag keeps winning either way — it is rule 1 of
              the waterfall.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="max-w-2xl">
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">TAG cost 30d</TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taggedJobs.map((j) => (
                  <TableRow key={`${j.workspace_id}|${j.job_id}`}>
                    <TableCell>{wsName.get(j.workspace_id) ?? j.workspace_id}</TableCell>
                    <TableCell className="font-mono text-xs">{j.job_id}</TableCell>
                    <TableCell className="font-mono text-xs">{j.data_product}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtMoney(j.tagged_cost_30d)}
                    </TableCell>
                    <TableCell>
                      <ActionForm action={deleteJobMappingAction} submitLabel="Remove bridge">
                        <input type="hidden" name="workspace_id" value={j.workspace_id} />
                        <input type="hidden" name="job_id" value={j.job_id} />
                      </ActionForm>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              message={
                rows.length === 0
                  ? "No bridge mappings — every job attributes via tags. That's the goal state."
                  : "No mappings match the filter."
              }
            />
          ) : (
            <>
              {q && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {shown.length} of {rows.length} mappings shown
                </p>
              )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Mapped by / at</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={`${r.workspace_id}|${r.job_id}`}>
                    <TableCell>{wsName.get(r.workspace_id) ?? r.workspace_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.job_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.data_product}</TableCell>
                    <TableCell className="text-xs">{r.note ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.mapped_by ?? "—"}
                      {r.mapped_at && <> · {r.mapped_at.slice(0, 10)}</>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-4">
                      <Link
                        href={`/admin/jobs/coverage?q=${encodeURIComponent(r.job_id)}`}
                        className="text-xs font-medium text-indigo-600 hover:underline"
                      >
                        Attribution
                      </Link>
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-destructive hover:underline">
                          Remove
                        </summary>
                        <div className="mt-2 max-w-xs rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                          <ActionForm
                            action={deleteJobMappingAction}
                            submitLabel="Remove mapping"
                            danger
                            note="Remove once the job is tagged at source — otherwise its spend falls back to the work queue."
                          >
                            <input type="hidden" name="workspace_id" value={r.workspace_id} />
                            <input type="hidden" name="job_id" value={r.job_id} />
                          </ActionForm>
                        </div>
                      </details>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
