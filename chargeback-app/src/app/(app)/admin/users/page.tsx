import { Suspense } from "react";
import { requirePageRole } from "@/lib/guards";
import { listActiveProducts, listUsers } from "@/dal/mappings";
import { getUnknownRunners } from "@/dal/workQueue";
import {
  bulkDeleteUsersAction,
  bulkSetUserDeskAction,
  deleteUserAction,
  upsertUserAction,
} from "@/actions/mappings";
import { param, type SearchParams } from "@/lib/report-params";
import { paginate } from "@/lib/paginate";
import { KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { ArrowRightLeft, Plus, Trash2 } from "lucide-react";
import { ActionForm, DatalistField, Field } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import {
  BulkActionBar,
  BulkAppliesTo,
  BulkCheckbox,
  BulkCheckboxAll,
  BulkSelect,
  BulkSelectedInputs,
} from "@/components/bulk-select";
import { EmptyState, FilteredCount, KpiTile, PageTitle, QueueHintCard } from "@/components/ui";
import { UnmappedRunnersPanel } from "@/components/unmapped-runners-panel";
import { isServicePrincipal } from "@/lib/identity";
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

export const metadata = { title: "Users" };

export default function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading users from Databricks…" kpis withPicker={false} />}>
      <Users searchParams={searchParams} />
    </Suspense>
  );
}

async function Users({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const q = (param(sp.q) ?? "").toLowerCase();

  const [rows, products, unknownRunners] = await Promise.all([
    listUsers(),
    listActiveProducts(),
    getUnknownRunners(),
  ]);
  const deskOptions = [
    ...new Set([...products.map((p) => p.desk), ...rows.map((r) => r.desk)]),
  ].sort();
  const desksCovered = new Set(rows.map((r) => r.desk)).size;
  const spCount = rows.filter((r) => isServicePrincipal(r.user_id)).length;

  // include the derived Type column text so filtering matches what's visible
  const shown = rows.filter(
    (r) =>
      !q ||
      `${r.user_id} ${r.user_name} ${r.desk} ${isServicePrincipal(r.user_id) ? "service principal" : "user"}`
        .toLowerCase()
        .includes(q),
  );
  const { rows: pageRows, ...paged } = paginate(shown, param(sp.page));

  return (
    <div>
      <PageTitle
        title="User mapping"
        subtitle="user_mapping — runner identity → display name + home desk. user_id must match executed_by / identity_metadata.run_as exactly, including service principal IDs."
        info={PAGE_HELP.users}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile
          label="Mapped runners"
          value={String(rows.length)}
          hint={`${spCount} service principal${spCount === 1 ? "" : "s"}, ${rows.length - spCount} humans`}
          info={KPI_HELP.usersMappedRunners}
        />
        <KpiTile
          label="Desks covered"
          value={String(desksCovered)}
          hint={`of ${deskOptions.length} known desks`}
          info={KPI_HELP.usersDesksCovered}
        />
        <KpiTile
          label="Unknown runners 30d"
          value={String(unknownRunners.length)}
          hint="spending but not mapped"
          tone={unknownRunners.length > 0 ? "warn" : "good"}
          info={KPI_HELP.usersUnknownRunners}
        />
        <QueueHintCard>— runner IDs there are pre-filled from system tables.</QueueHintCard>
      </div>

      <UnmappedRunnersPanel deskOptions={deskOptions} />

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <EditDialog
          trigger={
            <Button>
              <Plus aria-hidden /> Add user
            </Button>
          }
          title="Add user"
          description="Prefer adding users from the Work Queue — there the user_id is pre-filled from the system tables and cannot be mistyped."
        >
          <ActionForm action={upsertUserAction} submitLabel="Save user" resetOnSuccess>
            <Field label="User ID (email or SP application id)" name="user_id" />
            <Field label="Display name" name="user_name" />
            <DatalistField label="Home desk" name="desk" options={deskOptions} />
          </ActionForm>
        </EditDialog>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by ID, name, desk…" />
        </div>
      </div>

      <BulkSelect values={pageRows.map((r) => r.user_id)}>
      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              message={rows.length === 0 ? "No users mapped yet." : "No users match the filter."}
            />
          ) : (
            <>
              {q && <FilteredCount shown={shown.length} total={rows.length} noun="user" />}
              <Table className="align-top">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <BulkCheckboxAll label="Select all shown users" />
                    </TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Display name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Desk</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={r.user_id}>
                      <TableCell>
                        <BulkCheckbox value={r.user_id} label={`Select user ${r.user_name}`} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.user_id}</TableCell>
                      <TableCell>{r.user_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {isServicePrincipal(r.user_id) ? "service principal" : "user"}
                      </TableCell>
                      <TableCell>{r.desk}</TableCell>
                      <TableCell>
                        <div className="flex gap-4">
                          <EditDialog
                            trigger={<RowAction>Edit</RowAction>}
                            title={`Edit ${r.user_name}`}
                            description="Changing the desk re-routes this runner's AD_HOC spend in live views from now on; published months are unaffected. The user_id itself cannot change — remove and re-add if the identity is wrong."
                          >
                            <ActionForm action={upsertUserAction} submitLabel="Update user">
                              <Field label="User ID" name="user_id" defaultValue={r.user_id} readOnly />
                              <Field label="Display name" name="user_name" defaultValue={r.user_name} />
                              <DatalistField label="Home desk" name="desk" options={deskOptions} defaultValue={r.desk} />
                            </ActionForm>
                          </EditDialog>
                          <EditDialog
                            trigger={<RowAction danger>Remove</RowAction>}
                            title={`Remove ${r.user_name}?`}
                            description="Their ad-hoc spend loses its desk (waterfall rule 4 stops matching) and the runner reappears in the work queue if they keep spending. Remove only for departed users or wrong identities."
                          >
                            <ActionForm action={deleteUserAction} submitLabel="Remove user" danger>
                              <input type="hidden" name="user_id" value={r.user_id} />
                            </ActionForm>
                          </EditDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination {...paged} noun="user" />
            </>
          )}
        </CardContent>
      </Card>

      <BulkActionBar noun="user">
        <EditDialog
          trigger={
            <Button variant="outline" size="sm">
              <ArrowRightLeft aria-hidden /> Change desk
            </Button>
          }
          title="Change desk for selected users"
          description="Re-routes the selected runners' AD_HOC spend in live views from now on; published months are unaffected."
        >
          <ActionForm action={bulkSetUserDeskAction} submitLabel="Apply to selected">
            <BulkSelectedInputs name="user_ids" />
            <DatalistField label="Home desk" name="desk" options={deskOptions} />
            <BulkAppliesTo noun="user" />
          </ActionForm>
        </EditDialog>
        <EditDialog
          trigger={
            <Button variant="destructive" size="sm">
              <Trash2 aria-hidden /> Remove selected
            </Button>
          }
          title="Remove selected users?"
          description="Their ad-hoc spend loses its desk (waterfall rule 4 stops matching) and they reappear in the work queue if they keep spending. Remove only departed users or wrong identities."
        >
          <ActionForm action={bulkDeleteUsersAction} submitLabel="Remove users" danger>
            <BulkSelectedInputs name="user_ids" />
            <BulkAppliesTo noun="user" />
          </ActionForm>
        </EditDialog>
      </BulkActionBar>
      </BulkSelect>
    </div>
  );
}

