import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { listActiveProducts, listUsers } from "@/dal/mappings";
import { getUnknownRunners } from "@/dal/workQueue";
import { deleteUserAction, upsertUserAction } from "@/actions/mappings";
import { param, type SearchParams } from "@/lib/report-params";
import { KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { ActionForm, Field } from "@/components/action-form";
import { EmptyState, KpiTile, PageTitle } from "@/components/ui";
import { ServerlessGapPanel } from "@/components/serverless-gap-panel";
import { TableFilter } from "@/components/table-filter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePageSkeleton } from "@/components/loading-skeletons";

export const metadata = { title: "Users" };

/** Heuristic for display only: service principals are IDs, humans are emails. */
const isServicePrincipal = (id: string) => !id.includes("@");

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

  const shown = rows.filter(
    (r) => !q || `${r.user_id} ${r.user_name} ${r.desk}`.toLowerCase().includes(q),
  );

  return (
    <div>
      <PageTitle
        title="User mapping"
        subtitle="user_mapping — runner identity → display name + home desk. user_id must match executed_by / identity_metadata.run_as exactly, including service principal IDs."
        info={PAGE_HELP.users}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              — runner IDs there are pre-filled from system tables.
            </p>
          </CardContent>
        </Card>
      </div>

      <ServerlessGapPanel deskOptions={deskOptions} />

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <details>
          <Button asChild>
            <summary className="cursor-pointer">＋ Add user</summary>
          </Button>
          <Card className="mt-3 max-w-md">
            <CardContent>
              <ActionForm
                action={upsertUserAction}
                submitLabel="Save user"
                note="Prefer adding users from the Work Queue — there the user_id is pre-filled from the system tables and cannot be mistyped."
              >
                <Field label="User ID (email or SP application id)" name="user_id" />
                <Field label="Display name" name="user_name" />
                <DeskField deskOptions={deskOptions} />
              </ActionForm>
            </CardContent>
          </Card>
        </details>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by ID, name, desk…" />
        </div>
      </div>

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              message={rows.length === 0 ? "No users mapped yet." : "No users match the filter."}
            />
          ) : (
            <>
              {q && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {shown.length} of {rows.length} users shown
                </p>
              )}
              <Table className="align-top">
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Display name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Desk</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.user_id}>
                      <TableCell className="font-mono text-xs">{r.user_id}</TableCell>
                      <TableCell>{r.user_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {isServicePrincipal(r.user_id) ? "service principal" : "user"}
                      </TableCell>
                      <TableCell>{r.desk}</TableCell>
                      <TableCell>
                        <div className="flex gap-4">
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                              Edit
                            </summary>
                            <div className="mt-2 max-w-md rounded-lg border bg-muted/50 p-3">
                              <ActionForm
                                action={upsertUserAction}
                                submitLabel="Update user"
                                note="Changing the desk re-routes this runner's AD_HOC spend in live views from now on; published months are unaffected. The user_id itself cannot change — remove and re-add if the identity is wrong."
                              >
                                <Field label="User ID" name="user_id" defaultValue={r.user_id} readOnly />
                                <Field label="Display name" name="user_name" defaultValue={r.user_name} />
                                <DeskField deskOptions={deskOptions} defaultValue={r.desk} id={`desk-${r.user_id}`} />
                              </ActionForm>
                            </div>
                          </details>
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-destructive hover:underline">
                              Remove
                            </summary>
                            <div className="mt-2 max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                              <ActionForm
                                action={deleteUserAction}
                                submitLabel="Remove user"
                                danger
                                note="Their ad-hoc spend loses its desk (waterfall rule 4 stops matching) and the runner reappears in the work queue if they keep spending. Remove only for departed users or wrong identities."
                              >
                                <input type="hidden" name="user_id" value={r.user_id} />
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

function DeskField({
  deskOptions,
  defaultValue,
  id = "desk",
}: {
  deskOptions: string[];
  defaultValue?: string;
  id?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground" htmlFor={id}>
        Home desk
      </Label>
      <Input
        id={id}
        name="desk"
        required
        defaultValue={defaultValue}
        list="desk-options-list"
      />
      <datalist id="desk-options-list">
        {deskOptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}
