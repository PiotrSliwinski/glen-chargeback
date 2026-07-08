import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { fmtDbu, fmtInt, fmtMoney, fmtPct } from "@/lib/format";
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
  getUnmatchedAzureResources,
  getUntaggedJobs,
} from "@/dal/workQueue";
import { getUnmappedEndpoints } from "@/dal/ai";
import { listActiveProducts, listUsers, listWorkspaces } from "@/dal/mappings";
import {
  addTagRuleAction,
  assignWarehouseAction,
  bulkAddUsersAction,
  bulkAddWorkspacesAction,
  bulkAssignWarehousesAction,
  bulkMapEndpointsAction,
  bulkMapJobsAction,
  mapEndpointAction,
  mapJobAction,
  upsertUserAction,
  upsertWorkspaceAction,
} from "@/actions/mappings";
import { bulkMapAzureResourcesAction, mapAzureResourceAction } from "@/actions/azure";
import { bulkCreateProductsAction, createProductAction } from "@/actions/products";
import { PRODUCT_KEY_RE } from "@/services/productCatalogue";
import { ArrowRightLeft, Download, PackagePlus, Tags, UserPlus } from "lucide-react";
import { ActionForm, DatalistField, Field, SelectField } from "@/components/action-form";
import {
  BulkActionBar,
  BulkAppliesTo,
  BulkCheckbox,
  BulkCheckboxAll,
  BulkSelect,
  BulkSelectedInputs,
} from "@/components/bulk-select";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import { SplitEditor } from "@/components/split-editor";
import { NextMonthDateField } from "@/components/next-month-date-field";
import { SpNameField } from "@/components/sp-name-field";
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

// Tabs grouped by cost source — one queue page covers all three areas, so
// "unallocated" always means the same trailing-30-day window everywhere.
type TabKey =
  | "jobs"
  | "runners"
  | "workspaces"
  | "tags"
  | "warehouses"
  | "azure"
  | "endpoints";
const TAB_GROUPS: { label: string; tabs: { key: TabKey; label: string }[] }[] = [
  {
    label: "Databricks",
    tabs: [
      { key: "jobs", label: "Untagged jobs" },
      { key: "runners", label: "Unknown runners" },
      { key: "workspaces", label: "Unknown workspaces" },
      { key: "tags", label: "Rogue tags" },
      { key: "warehouses", label: "Unassigned warehouses" },
    ],
  },
  {
    label: "Azure",
    tabs: [{ key: "azure", label: "Unmatched resources" }],
  },
  {
    label: "AI",
    tabs: [{ key: "endpoints", label: "Unmapped endpoints" }],
  },
];
const TABS = TAB_GROUPS.flatMap((g) => g.tabs);

export const unstable_instant = {
  // dev-only: skip the instant-nav validation prerender (re-runs on every
  // load/HMR; still validated at build). See app/(app)/page.tsx for why.
  unstable_disableDevValidation: true,
  prefetch: "runtime",
  samples: [{ searchParams: { month: null, mode: null, tab: null, page: null } }],
};

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
    azure: summary.unmatchedAzureResources,
    endpoints: summary.unmappedEndpoints,
  };
  const openItems = TABS.reduce((s, t) => s + counts[t.key], 0);

  return (
    <div>
      <PageTitle
        title="Work queue"
        subtitle={`Unallocated and unmapped cost drivers across Databricks, Azure and AI, trailing 30 days — ${openItems} open items, the number to drive to zero`}
        info={PAGE_HELP.queue}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile
          label="Unallocated cost 30d"
          value={fmtMoney(summary.totalUnallocatedCost30d)}
          tone={summary.totalUnallocatedCost30d > 0 ? "bad" : "good"}
          hint="Databricks + Azure + AI"
          info={KPI_HELP.queueUnallocated30d}
        />
        <KpiTile
          label="Databricks unallocated"
          value={fmtMoney(summary.databricksUnallocatedCost30d)}
          hint="untagged jobs + rogue tags"
          info={KPI_HELP.queueDatabricksUnallocated30d}
        />
        <KpiTile
          label="Azure unallocated"
          value={fmtMoney(summary.azureUnallocatedCost30d)}
          hint="unmatched resources — never billed"
          info={KPI_HELP.queueAzureUnallocated30d}
        />
        <KpiTile
          label="AI unallocated"
          value={fmtMoney(summary.aiUnallocatedCost30d)}
          hint="unmapped serving endpoints"
          info={KPI_HELP.queueAiUnallocated30d}
          infoAlign="end"
        />
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center gap-x-1 gap-y-2">
        {TAB_GROUPS.map((g, i) => (
          <div key={g.label} className={`flex items-center gap-1 ${i > 0 ? "ml-3" : ""}`}>
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.label}
            </span>
            {g.tabs.map((t) => (
              <Button
                key={t.key}
                asChild
                size="sm"
                variant={tab === t.key ? "secondary" : "ghost"}
                className={tab === t.key ? undefined : "text-muted-foreground"}
              >
                <Link
                  href={`/queue?tab=${t.key}`}
                  aria-current={tab === t.key ? "page" : undefined}
                >
                  {t.label}
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                    {counts[t.key]}
                  </span>
                </Link>
              </Button>
            ))}
          </div>
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
        The durable fix is always tagging at source — a mapping is a bridge.
      </p>

      {tab === "jobs" && (
        <UntaggedJobsTab productOptions={productOptions} wsName={wsName} runnerName={runnerName} page={page} />
      )}
      {tab === "runners" && <UnknownRunnersTab deskOptions={deskOptions} page={page} />}
      {tab === "workspaces" && <UnknownWorkspacesTab page={page} />}
      {tab === "tags" && (
        <RogueTagsTab productOptions={productOptions} deskOptions={deskOptions} page={page} />
      )}
      {tab === "warehouses" && (
        <UnassignedWarehousesTab productOptions={productOptions} wsName={wsName} page={page} />
      )}
      {tab === "azure" && <UnmatchedAzureResourcesTab productOptions={productOptions} page={page} />}
      {tab === "endpoints" && (
        <UnmappedEndpointsTab productOptions={productOptions} wsName={wsName} page={page} />
      )}
    </div>
  );
}


/** Closes the "target product doesn't exist yet" dead end inside fix dialogs. */
function ProductMissingHint() {
  return (
    <p className="text-xs text-muted-foreground">
      Product not in the list?{" "}
      <Link href="/admin/products" className="font-medium text-primary hover:underline">
        Register it first
      </Link>{" "}
      under Reference data → Products.
    </p>
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
  // Only rows with a job_id can take a bridge row; a job split across several
  // queue rows (by category/runner) is one selectable key, not many.
  const mappableKeys = [
    ...new Set(
      rows.filter((r) => r.job_id).map((r) => `${r.workspace_id}|${r.job_id}`),
    ),
  ];
  return (
    <BulkSelect values={mappableKeys}>
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <BulkCheckboxAll label="Select all mappable jobs on this page" />
              </TableHead>
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
              // job_id is null for non-job work items, so it alone can't identify a row
              <TableRow key={`${r.workspace_id}|${r.job_id}|${r.usage_category}|${r.work_item}|${r.runner}`}>
                <TableCell>
                  {r.job_id && (
                    <BulkCheckbox
                      value={`${r.workspace_id}|${r.job_id}`}
                      label={`Select ${r.work_item}`}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{r.work_item}</p>
                  {r.job_id && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {/* the job's 30-day attribution history */}
                      <Link
                        href={`/admin/jobs?view=coverage&q=${encodeURIComponent(r.job_id)}`}
                        className="hover:underline"
                      >
                        job {r.job_id}
                      </Link>
                    </p>
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
                      <ProductMissingHint />
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
    <BulkActionBar noun="job">
      <EditDialog
        trigger={
          <Button variant="outline" size="sm">
            <ArrowRightLeft aria-hidden /> Map selected to product
          </Button>
        }
        title="Map selected jobs to one product"
        description="Creates one bridge row per selected job. Bridge only — the durable fix is tagging each job at source; remind the owning teams."
      >
        <ActionForm action={bulkMapJobsAction} submitLabel="Map to product">
          <BulkSelectedInputs name="keys" />
          <SelectField label="Data product" name="data_product" options={productOptions} />
          <ProductMissingHint />
          <Field label="Note (why mapped manually)" name="note" required={false} />
          <BulkAppliesTo noun="job" />
        </ActionForm>
      </EditDialog>
    </BulkActionBar>
    </BulkSelect>
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
    <BulkSelect values={rows.map((r) => r.runner)}>
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <BulkCheckboxAll label="Select all runners on this page" />
              </TableHead>
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
                  <BulkCheckbox value={r.runner} label={`Select runner ${r.runner}`} />
                </TableCell>
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
    <BulkActionBar noun="runner">
      <EditDialog
        trigger={
          <Button variant="outline" size="sm">
            <UserPlus aria-hidden /> Add selected to desk
          </Button>
        }
        title="Add selected runners to one desk"
        description="Registers every selected runner on the chosen desk. Display names default to the raw identity — refine them under Reference data → Users."
      >
        <ActionForm action={bulkAddUsersAction} submitLabel="Add to desk">
          <BulkSelectedInputs name="user_ids" />
          <DatalistField label="Desk" name="desk" options={deskOptions} />
          <BulkAppliesTo noun="runner" />
        </ActionForm>
      </EditDialog>
    </BulkActionBar>
    </BulkSelect>
  );
}

async function UnknownWorkspacesTab({ page }: { page: string | undefined }) {
  const all = await getUnknownWorkspaces();
  if (all.length === 0) return <EmptyState message="All billing workspaces are mapped." />;
  const { rows, ...paged } = paginate(all, page);
  return (
    <BulkSelect values={rows.map((r) => r.workspace_id)}>
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <BulkCheckboxAll label="Select all workspaces on this page" />
              </TableHead>
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
                <TableCell>
                  <BulkCheckbox
                    value={r.workspace_id}
                    label={`Select workspace ${r.workspace_id}`}
                  />
                </TableCell>
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
    <BulkActionBar noun="workspace">
      <EditDialog
        trigger={
          <Button variant="outline" size="sm">
            <PackagePlus aria-hidden /> Register selected
          </Button>
        }
        title="Register selected workspaces"
        description="Adds every selected workspace to workspace_mapping. Friendly names default to the workspace ID — refine them under Reference data → Workspaces."
      >
        <ActionForm action={bulkAddWorkspacesAction} submitLabel="Register workspaces">
          <BulkSelectedInputs name="workspace_ids" />
          <BulkAppliesTo noun="workspace" />
        </ActionForm>
      </EditDialog>
    </BulkActionBar>
    </BulkSelect>
  );
}

async function RogueTagsTab({
  productOptions,
  deskOptions,
  page,
}: {
  productOptions: { value: string; label: string }[];
  deskOptions: string[];
  page: string | undefined;
}) {
  const all = await getRogueTags();
  if (all.length === 0)
    return <EmptyState message="Every tag in use matches the product catalogue." />;
  const { rows, ...paged } = paginate(all, page);
  // Only tags that are valid product keys can be registered; the rest are
  // typos to fix at source and must not enter a bulk batch.
  const registrableTags = rows
    .map((r) => r.raw_tag_data_product)
    .filter((t) => PRODUCT_KEY_RE.test(t));
  return (
    <BulkSelect values={registrableTags}>
    <Card>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Tags in use that don&apos;t match any catalogue product: a real product to register, or
          a typo — route its spend with a tag rule while the fix at source lands.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <BulkCheckboxAll label="Select all registrable tags on this page" />
              </TableHead>
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
                <TableCell>
                  {PRODUCT_KEY_RE.test(r.raw_tag_data_product) && (
                    <BulkCheckbox
                      value={r.raw_tag_data_product}
                      label={`Select tag ${r.raw_tag_data_product}`}
                    />
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.raw_tag_data_product}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtInt(r.rows_30d)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-start justify-end gap-4">
                    <EditDialog
                      trigger={<RowAction>Map via tag rule</RowAction>}
                      title={`Route tag ${r.raw_tag_data_product}`}
                      description="For typos: a Databricks-scoped tag rule (rule 3) routes all spend carrying this mis-tag to the chosen product — past and future — until the tag is corrected at source. The tag is read-only."
                    >
                      <ActionForm action={addTagRuleAction} submitLabel="Create tag rule">
                        <input type="hidden" name="tag_key" value="data_product" />
                        <input type="hidden" name="scope" value="databricks" />
                        <Field
                          label="Tag value (as emitted)"
                          name="tag_value"
                          defaultValue={r.raw_tag_data_product}
                          readOnly
                        />
                        <SelectField
                          label="Data product"
                          name="data_product"
                          options={productOptions}
                        />
                        <Field label="Note (why routed manually)" name="note" required={false} />
                      </ActionForm>
                    </EditDialog>
                    {PRODUCT_KEY_RE.test(r.raw_tag_data_product) && (
                      <EditDialog
                        trigger={<RowAction>Register as product</RowAction>}
                        title={`Register ${r.raw_tag_data_product}`}
                        description="If the tag is a typo, don't register it — use a tag rule (or fix it at source) instead. The product key must equal the tag and is read-only."
                      >
                        <ActionForm action={createProductAction} submitLabel="Register as product">
                          <Field
                            label="Product key (must equal the tag)"
                            name="data_product"
                            defaultValue={r.raw_tag_data_product}
                            readOnly
                          />
                          <Field label="Data domain" name="data_domain" placeholder="e.g. market-data" />
                          <SplitEditor deskOptions={deskOptions} />
                          <Field label="Product owner" name="product_owner" required={false} />
                          <NextMonthDateField label="Valid from" name="valid_from" />
                        </ActionForm>
                      </EditDialog>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...paged} noun="rogue tag" />
      </CardContent>
    </Card>
    <BulkActionBar noun="tag">
      <EditDialog
        trigger={
          <Button variant="outline" size="sm">
            <PackagePlus aria-hidden /> Register selected as products
          </Button>
        }
        title="Register selected tags as products"
        description="Creates one catalogue product per selected tag, all under the same domain and desk split. Typos should be fixed at source instead — only valid product keys are selectable."
      >
        <ActionForm action={bulkCreateProductsAction} submitLabel="Register as products">
          <BulkSelectedInputs name="data_products" />
          <Field label="Data domain" name="data_domain" placeholder="e.g. market-data" />
          <SplitEditor deskOptions={deskOptions} />
          <NextMonthDateField label="Valid from" name="valid_from" />
          <BulkAppliesTo noun="tag" />
        </ActionForm>
      </EditDialog>
    </BulkActionBar>
    </BulkSelect>
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
    <BulkSelect values={rows.map((r) => r.warehouse_id)}>
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
              <TableHead className="w-8">
                <BulkCheckboxAll label="Select all warehouses on this page" />
              </TableHead>
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
                <TableCell>
                  <BulkCheckbox value={r.warehouse_id} label={`Select warehouse ${r.warehouse_id}`} />
                </TableCell>
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
    <BulkActionBar noun="warehouse">
      <EditDialog
        trigger={
          <Button variant="outline" size="sm">
            <Tags aria-hidden /> Classify selected
          </Button>
        }
        title="Classify selected warehouses"
        description="Applies one classification to every selected warehouse. Dedicated requires a product (idle cost included); shared allocates per query."
      >
        <ActionForm action={bulkAssignWarehousesAction} submitLabel="Apply to selected">
          <BulkSelectedInputs name="warehouse_ids" />
          <SelectField
            label="Classification"
            name="mode"
            defaultValue="shared"
            options={[
              { value: "shared", label: "Shared — allocate per query" },
              { value: "dedicated", label: "Dedicated — whole warehouse to one product" },
            ]}
          />
          <SelectField
            label="Data product (dedicated only)"
            name="data_product"
            required={false}
            options={[{ value: "", label: "—" }, ...productOptions]}
          />
          <BulkAppliesTo noun="warehouse" />
        </ActionForm>
      </EditDialog>
    </BulkActionBar>
    </BulkSelect>
  );
}

/** Last ARM path segment — display only; actions always carry the full id. */
const azureResourceName = (id: string) => id.split("/").at(-1) ?? id;

async function UnmatchedAzureResourcesTab({
  productOptions,
  page,
}: {
  productOptions: { value: string; label: string }[];
  page: string | undefined;
}) {
  const all = await getUnmatchedAzureResources();
  if (all.length === 0)
    return <EmptyState message="Every Azure resource with recent cost is attributed." />;
  const { rows, ...paged } = paginate(all, page);
  return (
    <BulkSelect values={rows.map((r) => r.resource_id)}>
    <Card>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Azure cost no waterfall rule matched — visible in coverage, never billed to a desk. A
          bridge row routes one resource; for whole resource groups or subscriptions, add a scope
          rule under{" "}
          <Link href="/admin/azure" className="font-medium text-primary hover:underline">
            Reference data → Azure
          </Link>
          .
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <BulkCheckboxAll label="Select all resources on this page" />
              </TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Meter category</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.resource_id}>
                <TableCell>
                  <BulkCheckbox
                    value={r.resource_id}
                    label={`Select resource ${azureResourceName(r.resource_id)}`}
                  />
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium">
                    {r.resource_name ?? azureResourceName(r.resource_id)}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {/* the resource's 30-day attribution history */}
                    <Link
                      href={`/admin/azure?view=coverage&q=${encodeURIComponent(r.resource_id)}`}
                      className="hover:underline"
                    >
                      {r.resource_group ?? "—"} · {r.subscription_id.slice(0, 8)}…
                    </Link>
                  </p>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.meter_category ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right">
                  <EditDialog
                    trigger={<RowAction>Map to product</RowAction>}
                    title={`Map ${r.resource_name ?? azureResourceName(r.resource_id)}`}
                    description="Bridge only — the durable fix is a data_product tag on the resource. The ARM resource ID is pre-filled from the export and read-only; it is stored lowercase."
                  >
                    <ActionForm action={mapAzureResourceAction} submitLabel="Map to product">
                      <Field
                        label="Resource ID"
                        name="resource_id"
                        defaultValue={r.resource_id}
                        readOnly
                      />
                      <SelectField label="Data product" name="data_product" options={productOptions} />
                      <ProductMissingHint />
                      <Field label="Note (why mapped manually)" name="note" required={false} />
                    </ActionForm>
                  </EditDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...paged} noun="unmatched resource" />
      </CardContent>
    </Card>
    <BulkActionBar noun="resource">
      <EditDialog
        trigger={
          <Button variant="outline" size="sm">
            <ArrowRightLeft aria-hidden /> Map selected to product
          </Button>
        }
        title="Map selected resources to one product"
        description="Creates one bridge row per selected resource. Bridge only — the durable fix is tagging each resource at source."
      >
        <ActionForm action={bulkMapAzureResourcesAction} submitLabel="Map to product">
          <BulkSelectedInputs name="keys" />
          <SelectField label="Data product" name="data_product" options={productOptions} />
          <ProductMissingHint />
          <Field label="Note (why mapped manually)" name="note" required={false} />
          <BulkAppliesTo noun="resource" />
        </ActionForm>
      </EditDialog>
    </BulkActionBar>
    </BulkSelect>
  );
}

async function UnmappedEndpointsTab({
  productOptions,
  wsName,
  page,
}: {
  productOptions: { value: string; label: string }[];
  wsName: Map<string, string>;
  page: string | undefined;
}) {
  const all = await getUnmappedEndpoints();
  if (all.length === 0)
    return <EmptyState message="Every serving endpoint's spend is attributed." />;
  const { rows, ...paged } = paginate(all, page);
  return (
    <BulkSelect values={rows.map((r) => `${r.workspace_id}|${r.endpoint_name}`)}>
    <Card>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Serving endpoints whose spend fell to UNALLOCATED. AI serving is user-first: if the
          run-as identity should own the cost, map the runner instead (
          <Link href="/queue?tab=runners" className="font-medium text-primary hover:underline">
            Unknown runners
          </Link>
          ) — the endpoint bridge catches spend with no attributable user.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <BulkCheckboxAll label="Select all endpoints on this page" />
              </TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Run as</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead>
                <span className="sr-only">Action</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.workspace_id}|${r.endpoint_name}`}>
                <TableCell>
                  <BulkCheckbox
                    value={`${r.workspace_id}|${r.endpoint_name}`}
                    label={`Select endpoint ${r.endpoint_name}`}
                  />
                </TableCell>
                <TableCell>
                  <p className="font-mono text-xs font-medium">{r.endpoint_name}</p>
                  <p className="text-xs text-muted-foreground">
                    <WorkspaceCell id={r.workspace_id} wsName={wsName} />
                  </p>
                </TableCell>
                <TableCell>
                  {r.serving_type ? (
                    <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                      {r.serving_type}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-44 truncate text-xs" title={r.top_runner ?? undefined}>
                  {r.top_runner ?? "—"}
                  {r.runner_count > 1 && (
                    <span className="text-muted-foreground"> +{r.runner_count - 1} more</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right">
                  <EditDialog
                    trigger={<RowAction>Map to product</RowAction>}
                    title={`Map endpoint ${r.endpoint_name}`}
                    description="Routes this endpoint's spend with no attributable user — past and future, batch inference included — to the selected product. Spend run by mapped users keeps billing their desk (user-first). The durable fix is a data_product tag on the endpoint."
                  >
                    <ActionForm action={mapEndpointAction} submitLabel="Map endpoint">
                      <Field
                        label="Workspace ID"
                        name="workspace_id"
                        defaultValue={r.workspace_id}
                        readOnly
                      />
                      <Field
                        label="Endpoint name"
                        name="endpoint_name"
                        defaultValue={r.endpoint_name}
                        readOnly
                      />
                      <SelectField label="Data product" name="data_product" options={productOptions} />
                      <ProductMissingHint />
                      <Field label="Note (why mapped manually)" name="note" required={false} />
                    </ActionForm>
                  </EditDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...paged} noun="unmapped endpoint" />
      </CardContent>
    </Card>
    <BulkActionBar noun="endpoint">
      <EditDialog
        trigger={
          <Button variant="outline" size="sm">
            <ArrowRightLeft aria-hidden /> Map selected to product
          </Button>
        }
        title="Map selected endpoints to one product"
        description="Creates one endpoint-bridge row per selected endpoint. The durable fix is tagging each endpoint at source; spend run by mapped users keeps billing their desk."
      >
        <ActionForm action={bulkMapEndpointsAction} submitLabel="Map to product">
          <BulkSelectedInputs name="keys" />
          <SelectField label="Data product" name="data_product" options={productOptions} />
          <ProductMissingHint />
          <Field label="Note (why mapped manually)" name="note" required={false} />
          <BulkAppliesTo noun="endpoint" />
        </ActionForm>
      </EditDialog>
    </BulkActionBar>
    </BulkSelect>
  );
}
