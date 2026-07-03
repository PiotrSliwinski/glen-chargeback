import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { listJobMappings, listWorkspaces } from "@/dal/mappings";
import { getUnknownWorkspaces } from "@/dal/workQueue";
import { deleteWorkspaceAction, upsertWorkspaceAction } from "@/actions/mappings";
import { param, type SearchParams } from "@/lib/report-params";
import { ActionForm, Field } from "@/components/action-form";
import { PAGE_HELP } from "@/lib/kpi-help";
import { EmptyState, KpiTile, PageTitle } from "@/components/ui";
import { TableFilter } from "@/components/table-filter";
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

export const metadata = { title: "Workspaces" };

export default function WorkspacesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading workspaces from Databricks…" kpis withPicker={false} />}>
      <Workspaces searchParams={searchParams} />
    </Suspense>
  );
}

async function Workspaces({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const q = (param(sp.q) ?? "").toLowerCase();

  const [rows, jobMappings, unknownWorkspaces] = await Promise.all([
    listWorkspaces(),
    listJobMappings(),
    getUnknownWorkspaces(),
  ]);
  const jobRefs = (id: string) => jobMappings.filter((j) => j.workspace_id === id).length;
  const referencedCount = rows.filter((r) => jobRefs(r.workspace_id) > 0).length;

  const shown = rows.filter(
    (r) => !q || `${r.workspace_id} ${r.workspace_name}`.toLowerCase().includes(q),
  );

  return (
    <div>
      <PageTitle
        title="Workspace mapping"
        subtitle="workspace_mapping — workspace ID → friendly name. Unmapped workspaces surface in reports as UNMAPPED: <id>, never dropped."
        info={PAGE_HELP.workspaces}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Mapped workspaces" value={String(rows.length)} />
        <KpiTile
          label="Referenced by job bridge"
          value={String(referencedCount)}
          hint={`${jobMappings.length} bridge mapping${jobMappings.length === 1 ? "" : "s"} total`}
        />
        <KpiTile
          label="Unknown workspaces 30d"
          value={String(unknownWorkspaces.length)}
          hint="billing but not mapped"
          tone={unknownWorkspaces.length > 0 ? "warn" : "good"}
        />
        <Card size="sm" className="no-print">
          <CardContent>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Fix unknowns
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Prefer the{" "}
              <Link href="/queue" className="font-medium text-indigo-600 hover:underline">
                work queue
              </Link>{" "}
              — workspace IDs there are pre-filled from billing data.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <details>
          <Button asChild>
            <summary className="cursor-pointer">＋ Add workspace</summary>
          </Button>
          <Card className="mt-3 max-w-md">
            <CardContent>
              <ActionForm
                action={upsertWorkspaceAction}
                submitLabel="Save workspace"
                note="Prefer adding workspaces from the Work Queue — there the ID is pre-filled from billing data and cannot be mistyped."
              >
                <Field label="Workspace ID" name="workspace_id" />
                <Field label="Friendly name" name="workspace_name" />
              </ActionForm>
            </CardContent>
          </Card>
        </details>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by ID or name…" />
        </div>
      </div>

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              message={
                rows.length === 0 ? "No workspaces mapped yet." : "No workspaces match the filter."
              }
            />
          ) : (
            <>
              {q && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {shown.length} of {rows.length} workspaces shown
                </p>
              )}
            <Table className="align-top">
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Job bridge refs</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.workspace_id}>
                    <TableCell className="font-mono text-xs">{r.workspace_id}</TableCell>
                    <TableCell>{r.workspace_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {jobRefs(r.workspace_id) > 0 ? (
                        <Link
                          href={`/admin/jobs?q=${encodeURIComponent(r.workspace_id)}`}
                          className="text-indigo-600 hover:underline"
                        >
                          {jobRefs(r.workspace_id)} mapping{jobRefs(r.workspace_id) > 1 ? "s" : ""}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-4">
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                            Rename
                          </summary>
                          <div className="mt-2 max-w-md rounded-lg border bg-muted/50 p-3">
                            <ActionForm
                              action={upsertWorkspaceAction}
                              submitLabel="Update name"
                              note="Cosmetic only — the name appears in reports; attribution is unaffected. The ID cannot change: it comes from system.billing.usage."
                            >
                              <Field
                                label="Workspace ID"
                                name="workspace_id"
                                defaultValue={r.workspace_id}
                                readOnly
                              />
                              <Field
                                label="Friendly name"
                                name="workspace_name"
                                defaultValue={r.workspace_name}
                              />
                            </ActionForm>
                          </div>
                        </details>
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-destructive hover:underline">
                            Remove
                          </summary>
                          <div className="mt-2 max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                            <ActionForm
                              action={deleteWorkspaceAction}
                              submitLabel="Remove workspace"
                              danger
                              note={
                                jobRefs(r.workspace_id) > 0
                                  ? `Heads up: ${jobRefs(r.workspace_id)} job mapping(s) reference this workspace — they keep working, but reports will show 'UNMAPPED: ${r.workspace_id}'. Remove only for decommissioned workspaces.`
                                  : `If this workspace still bills, reports will show 'UNMAPPED: ${r.workspace_id}' and it reappears in the work queue. Remove only for decommissioned workspaces.`
                              }
                            >
                              <input type="hidden" name="workspace_id" value={r.workspace_id} />
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
