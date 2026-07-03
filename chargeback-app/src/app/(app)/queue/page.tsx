import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { firstOfNextMonth, fmtDbu, fmtInt, fmtMoney, fmtPct } from "@/lib/format";
import { param, type SearchParams } from "@/lib/report-params";
import { paginate } from "@/lib/paginate";
import { toProductOptions } from "@/lib/product-options";
import { KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { isServicePrincipal } from "@/lib/identity";
import {
  getQueueSummary,
  getRogueTags,
  getUnassignedWarehouses,
  getUnknownRunners,
  getUnknownWorkspaces,
  getUntaggedJobs,
} from "@/dal/workQueue";
import { listActiveProducts, listUsers, listWorkspaces } from "@/dal/mappings";
import {
  assignWarehouseAction,
  mapJobAction,
  upsertUserAction,
  upsertWorkspaceAction,
} from "@/actions/mappings";
import { createProductAction } from "@/actions/products";
import { Download } from "lucide-react";
import { ActionForm, DatalistField, Field, SelectField } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import { SpNameField } from "@/components/unmapped-runners-body";
import { EmptyState, KpiTile, PageTitle } from "@/components/ui";
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
import { TablePagination } from "@/components/table-pagination";
import { TablePageSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";

export const metadata = { title: "Work queue" };

const TABS = [
  { key: "jobs", label: "Untagged jobs" },
  { key: "runners", label: "Unknown runners" },
  { key: "workspaces", label: "Unknown workspaces" },
  { key: "tags", label: "Rogue tags" },
  { key: "warehouses", label: "Unassigned warehouses" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function QueuePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense
      searchParams={searchParams}
      fallback={
        <TablePageSkeleton label="Loading work queue from Databricks…" kpis withPicker={false} />
      }
    >
      <Queue searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

async function Queue({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === param(sp.tab))?.key ?? "jobs") as TabKey;
  const page = param(sp.page);

  const [summary, products, workspaces, users] = await Promise.all([
    getQueueSummary(),
    listActiveProducts(),
    listWorkspaces(),
    listUsers(),
  ]);
  const productOptions = toProductOptions(products);
  const deskOptions = [...new Set(products.map((p) => p.desk))].sort();
  const wsName = new Map(workspaces.map((w) => [w.workspace_id, w.workspace_name]));
  const runnerName = new Map(users.map((u) => [u.user_id, u.user_name]));

  const counts: Record<TabKey, number> = {
    jobs: summary.untaggedJobs,
    runners: summary.unknownRunners,
    workspaces: summary.unknownWorkspaces,
    tags: summary.rogueTags,
    warehouses: summary.unassignedWarehouses,
  };

  return (
    <div>
      <PageTitle
        title="Work queue"
        subtitle="Unallocated and unmapped cost drivers, trailing 30 days — the number to drive to zero"
        info={PAGE_HELP.queue}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <KpiTile
          label="Unallocated cost (30d)"
          value={fmtMoney(summary.totalUnallocatedCost30d)}
          tone={summary.totalUnallocatedCost30d > 0 ? "bad" : "good"}
          hint="untagged jobs + rogue tags"
          info={KPI_HELP.queueUnallocated30d}
        />
        <KpiTile
          label="Open items"
          value={String(
            summary.untaggedJobs +
              summary.unknownRunners +
              summary.unknownWorkspaces +
              summary.rogueTags +
              summary.unassignedWarehouses,
          )}
          hint="across all five queues"
          info={KPI_HELP.queueOpenItems}
          infoAlign="end"
        />
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <Button
            key={t.key}
            asChild
            size="sm"
            variant={tab === t.key ? "secondary" : "ghost"}
            className={tab === t.key ? undefined : "text-muted-foreground"}
          >
            <Link href={`/queue?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined}>
              {t.label}
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                {counts[t.key]}
              </span>
            </Link>
          </Button>
        ))}
        <a
          href={`/api/export/queue-${tab}`}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Download className="size-3.5" aria-hidden />
          CSV — {TABS.find((t) => t.key === tab)?.label}
        </a>
      </div>

      <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Fixes here affect <strong>live</strong> views immediately; published months never change.
        For jobs, the durable fix is tagging at source — a mapping is a bridge.
      </p>

      {tab === "jobs" && (
        <UntaggedJobsTab productOptions={productOptions} wsName={wsName} runnerName={runnerName} page={page} />
      )}
      {tab === "runners" && <UnknownRunnersTab deskOptions={deskOptions} page={page} />}
      {tab === "workspaces" && <UnknownWorkspacesTab page={page} />}
      {tab === "tags" && <RogueTagsTab deskOptions={deskOptions} page={page} />}
      {tab === "warehouses" && (
        <UnassignedWarehousesTab productOptions={productOptions} wsName={wsName} page={page} />
      )}
    </div>
  );
}

/** Workspace cell: friendly name when mapped, otherwise the raw billing ID. */
function WorkspaceCell({ id, wsName }: { id: string; wsName: Map<string, string> }) {
  const name = wsName.get(id);
  if (!name) return <span className="font-mono text-xs">{id}</span>;
  return (
    <span title={`workspace ${id}`} className="text-sm">
      {name}
    </span>
  );
}

/** Runner cell: mapped display name, else the raw identity (SPN GUIDs flagged). */
function RunnerCell({
  runner,
  runnerName,
}: {
  runner: string | null;
  runnerName: Map<string, string>;
}) {
  if (!runner) return <span className="text-muted-foreground">—</span>;
  const name = runnerName.get(runner);
  if (name) {
    return (
      <span title={runner} className="text-sm">
        {name}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span title={runner} className="inline-block max-w-44 truncate align-bottom font-mono text-xs">
        {runner}
      </span>
      {isServicePrincipal(runner) && (
        <Badge variant="secondary" className="font-sans">
          SP
        </Badge>
      )}
    </span>
  );
}

async function UntaggedJobsTab({
  productOptions,
  wsName,
  runnerName,
  page,
}: {
  productOptions: { value: string; label: string }[];
  wsName: Map<string, string>;
  runnerName: Map<string, string>;
  page: string | undefined;
}) {
  const all = await getUntaggedJobs();
  if (all.length === 0) return <EmptyState message="No untagged jobs — queue clear." />;
  const { rows, ...paged } = paginate(all, page);
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Work item</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Runner</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.workspace_id}|${r.job_id}`}>
                <TableCell>
                  <p className="text-sm font-medium">{r.work_item}</p>
                  {r.job_id && (
                    <p className="font-mono text-xs text-muted-foreground">job {r.job_id}</p>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.usage_category}</TableCell>
                <TableCell>
                  <WorkspaceCell id={r.workspace_id} wsName={wsName} />
                </TableCell>
                <TableCell>
                  <RunnerCell runner={r.runner} runnerName={runnerName} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtMoney(r.unallocated_cost_30d)}
                </TableCell>
                <TableCell className="text-right">
                  <EditDialog
                    trigger={<RowAction>Map to product</RowAction>}
                    title={`Map ${r.work_item}`}
                    description="Bridge only — the durable fix is tagging the job at source; remind the owning team. The job ID is pre-filled from billing data and read-only."
                  >
                    <ActionForm action={mapJobAction} submitLabel="Map to product">
                      <input type="hidden" name="workspace_id" value={r.workspace_id} />
                      <Field label="Job ID" name="job_id" defaultValue={r.job_id ?? ""} readOnly />
                      <SelectField label="Data product" name="data_product" options={productOptions} />
                      <Field label="Note (why mapped manually)" name="note" required={false} />
                    </ActionForm>
                  </EditDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...paged} noun="untagged job" />
      </CardContent>
    </Card>
  );
}

async function UnknownRunnersTab({
  deskOptions,
  page,
}: {
  deskOptions: string[];
  page: string | undefined;
}) {
  const all = await getUnknownRunners();
  if (all.length === 0) return <EmptyState message="Every spending runner is mapped." />;
  const { rows, ...paged } = paginate(all, page);
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Runner (as in system tables)</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead className="text-right">Rows 30d</TableHead>
              <TableHead>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.runner}>
                <TableCell>
                  <span className="font-mono text-xs">{r.runner}</span>
                  {isServicePrincipal(r.runner) && (
                    <Badge variant="secondary" className="ml-2">
                      SP
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(r.rows_30d)}</TableCell>
                <TableCell className="text-right">
                  <EditDialog
                    trigger={<RowAction>Add user</RowAction>}
                    title={`Add user ${r.runner}`}
                    description="The user ID is pre-filled from the system tables and read-only — it must match executed_by / run_as exactly, so stewards never type it."
                  >
                    <ActionForm action={upsertUserAction} submitLabel="Add user">
                      <Field label="User ID" name="user_id" defaultValue={r.runner} readOnly />
                      {isServicePrincipal(r.runner) ? (
                        <SpNameField runnerId={r.runner} />
                      ) : (
                        <Field label="Display name" name="user_name" />
                      )}
                      <DatalistField label="Desk" name="desk" options={deskOptions} />
                    </ActionForm>
                  </EditDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...paged} noun="unknown runner" />
      </CardContent>
    </Card>
  );
}

async function UnknownWorkspacesTab({ page }: { page: string | undefined }) {
  const all = await getUnknownWorkspaces();
  if (all.length === 0) return <EmptyState message="All billing workspaces are mapped." />;
  const { rows, ...paged } = paginate(all, page);
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace ID</TableHead>
              <TableHead className="text-right">DBUs 30d</TableHead>
              <TableHead>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.workspace_id}>
                <TableCell className="font-mono text-xs">{r.workspace_id}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtDbu(r.dbus_30d)}</TableCell>
                <TableCell className="text-right">
                  <EditDialog
                    trigger={<RowAction>Add workspace</RowAction>}
                    title={`Add workspace ${r.workspace_id}`}
                    description="The workspace ID is pre-filled from billing data and read-only. The friendly name appears in reports; attribution is unaffected."
                  >
                    <ActionForm action={upsertWorkspaceAction} submitLabel="Add workspace">
                      <Field
                        label="Workspace ID"
                        name="workspace_id"
                        defaultValue={r.workspace_id}
                        readOnly
                      />
                      <Field label="Friendly name" name="workspace_name" />
                    </ActionForm>
                  </EditDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...paged} noun="unknown workspace" />
      </CardContent>
    </Card>
  );
}

async function RogueTagsTab({
  deskOptions,
  page,
}: {
  deskOptions: string[];
  page: string | undefined;
}) {
  const all = await getRogueTags();
  if (all.length === 0)
    return <EmptyState message="Every tag in use matches the product catalogue." />;
  const { rows, ...paged } = paginate(all, page);
  return (
    <Card>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Tags in use that don&apos;t match any catalogue product: either a typo to fix at source,
          or a real product to register.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tag value</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead className="text-right">Rows 30d</TableHead>
              <TableHead>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.raw_tag_data_product}>
                <TableCell className="font-mono text-xs">{r.raw_tag_data_product}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(r.rows_30d)}</TableCell>
                <TableCell className="text-right">
                  <EditDialog
                    trigger={<RowAction>Register as product</RowAction>}
                    title={`Register ${r.raw_tag_data_product}`}
                    description="If the tag is a typo, don't register it — get it fixed at source instead. The product key must equal the tag and is read-only."
                  >
                    <ActionForm action={createProductAction} submitLabel="Register as product">
                      <Field
                        label="Product key (must equal the tag)"
                        name="data_product"
                        defaultValue={r.raw_tag_data_product}
                        readOnly
                      />
                      <Field label="Data domain" name="data_domain" placeholder="e.g. market-data" />
                      <DatalistField label="Desk" name="desk" options={deskOptions} />
                      <Field label="Product owner" name="product_owner" required={false} />
                      <Field
                        label="Valid from"
                        name="valid_from"
                        type="date"
                        defaultValue={firstOfNextMonth()}
                      />
                    </ActionForm>
                  </EditDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...paged} noun="rogue tag" />
      </CardContent>
    </Card>
  );
}

async function UnassignedWarehousesTab({
  productOptions,
  wsName,
  page,
}: {
  productOptions: { value: string; label: string }[];
  wsName: Map<string, string>;
  page: string | undefined;
}) {
  const all = await getUnassignedWarehouses();
  if (all.length === 0) return <EmptyState message="No dedicated-warehouse candidates." />;
  const { rows, ...paged } = paginate(all, page);
  return (
    <Card>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Warehouses attributed only per-user (or not at all) with meaningful idle cost — if one
          belongs to a single product, dedicating it charges the whole warehouse (idle included) to
          that product.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Warehouse</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead className="text-right">Idle share</TableHead>
              <TableHead>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.warehouse_id}>
                <TableCell className="font-medium">{r.warehouse_id}</TableCell>
                <TableCell>
                  <WorkspaceCell id={r.workspace_id} wsName={wsName} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(r.idle_share)}</TableCell>
                <TableCell className="text-right">
                  <EditDialog
                    trigger={<RowAction>Classify</RowAction>}
                    title={`Classify warehouse ${r.warehouse_id}`}
                    description="Dedicated charges the whole warehouse (idle included) to one product; shared allocates per query. A dedicated warehouse requires a product."
                  >
                    <ActionForm action={assignWarehouseAction} submitLabel="Save">
                      <Field
                        label="Warehouse ID"
                        name="warehouse_id"
                        defaultValue={r.warehouse_id}
                        readOnly
                      />
                      <SelectField
                        label="Classification"
                        name="mode"
                        options={[
                          { value: "dedicated", label: "Dedicated — whole warehouse to one product" },
                          { value: "shared", label: "Shared — allocate per query" },
                        ]}
                      />
                      <SelectField
                        label="Data product (for dedicated)"
                        name="data_product"
                        required={false}
                        options={[{ value: "", label: "—" }, ...productOptions]}
                      />
                    </ActionForm>
                  </EditDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...paged} noun="warehouse" />
      </CardContent>
    </Card>
  );
}
