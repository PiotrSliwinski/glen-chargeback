import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { listJobMappings, listWorkspaces } from "@/dal/mappings";
import { getUnknownWorkspaces } from "@/dal/workQueue";
import {
  bulkDeleteWorkspacesAction,
  deleteWorkspaceAction,
  upsertWorkspaceAction,
} from "@/actions/mappings";
import { param, type SearchParams } from "@/lib/report-params";
import { paginate } from "@/lib/paginate";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import {
  BulkActionBar,
  BulkAppliesTo,
  BulkCheckbox,
  BulkCheckboxAll,
  BulkSelect,
  BulkSelectedInputs,
} from "@/components/bulk-select";
import { PAGE_HELP } from "@/lib/kpi-help";
import { plural } from "@/lib/format";
import { EmptyState, FilteredCount, KpiTile, PageTitle, QueueHintCard } from "@/components/ui";
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
import { TablePagination } from "@/components/table-pagination";
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
  const { rows: pageRows, ...paged } = paginate(shown, param(sp.page));

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
          hint={`${jobMappings.length} bridge ${plural(jobMappings.length, "mapping")} total`}
        />
        <KpiTile
          label="Unknown workspaces 30d"
          value={String(unknownWorkspaces.length)}
          hint="billing but not mapped"
          tone={unknownWorkspaces.length > 0 ? "warn" : "good"}
        />
        <QueueHintCard>— workspace IDs there are pre-filled from billing data.</QueueHintCard>
      </div>

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <EditDialog
          trigger={
            <Button>
              <Plus aria-hidden /> Add workspace
            </Button>
          }
          title="Add workspace"
          description="Prefer adding workspaces from the Work Queue — there the ID is pre-filled from billing data and cannot be mistyped."
        >
          <ActionForm action={upsertWorkspaceAction} submitLabel="Save workspace" resetOnSuccess>
            <Field label="Workspace ID" name="workspace_id" />
            <Field label="Friendly name" name="workspace_name" />
          </ActionForm>
        </EditDialog>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by ID or name…" />
        </div>
      </div>

      <BulkSelect values={pageRows.map((r) => r.workspace_id)}>
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
              {q && <FilteredCount shown={shown.length} total={rows.length} noun="workspace" />}
            <Table className="align-top">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <BulkCheckboxAll label="Select all shown workspaces" />
                  </TableHead>
                  <TableHead>Workspace ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Job bridge refs</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.workspace_id}>
                    <TableCell>
                      <BulkCheckbox
                        value={r.workspace_id}
                        label={`Select workspace ${r.workspace_name}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.workspace_id}</TableCell>
                    <TableCell>{r.workspace_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {jobRefs(r.workspace_id) > 0 ? (
                        <Link
                          href={`/admin/jobs?q=${encodeURIComponent(r.workspace_id)}`}
                          className="text-indigo-600 hover:underline"
                        >
                          {jobRefs(r.workspace_id)} {plural(jobRefs(r.workspace_id), "mapping")}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-4">
                        <EditDialog
                          trigger={<RowAction>Rename</RowAction>}
                          title={`Rename workspace ${r.workspace_id}`}
                          description="Cosmetic only — the name appears in reports; attribution is unaffected. The ID cannot change: it comes from system.billing.usage."
                        >
                          <ActionForm action={upsertWorkspaceAction} submitLabel="Update name">
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
                        </EditDialog>
                        <EditDialog
                          trigger={<RowAction danger>Remove</RowAction>}
                          title={`Remove workspace ${r.workspace_name}?`}
                          description={
                            jobRefs(r.workspace_id) > 0
                              ? `Heads up: ${jobRefs(r.workspace_id)} job mapping(s) reference this workspace — they keep working, but reports will show 'UNMAPPED: ${r.workspace_id}'. Remove only for decommissioned workspaces.`
                              : `If this workspace still bills, reports will show 'UNMAPPED: ${r.workspace_id}' and it reappears in the work queue. Remove only for decommissioned workspaces.`
                          }
                        >
                          <ActionForm
                            action={deleteWorkspaceAction}
                            submitLabel="Remove workspace"
                            danger
                          >
                            <input type="hidden" name="workspace_id" value={r.workspace_id} />
                          </ActionForm>
                        </EditDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination {...paged} noun="workspace" />
            </>
          )}
        </CardContent>
      </Card>

      <BulkActionBar noun="workspace">
        <EditDialog
          trigger={
            <Button variant="destructive" size="sm">
              <Trash2 aria-hidden /> Remove selected
            </Button>
          }
          title="Remove selected workspaces?"
          description="Any that still bill show as 'UNMAPPED: <id>' in reports and reappear in the work queue — spend is never dropped. Remove only decommissioned workspaces."
        >
          <ActionForm action={bulkDeleteWorkspacesAction} submitLabel="Remove workspaces" danger>
            <BulkSelectedInputs name="workspace_ids" />
            <BulkAppliesTo noun="workspace" />
          </ActionForm>
        </EditDialog>
      </BulkActionBar>
      </BulkSelect>
    </div>
  );
}
