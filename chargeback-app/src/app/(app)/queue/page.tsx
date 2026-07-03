import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { fmtMoney, fmtDbu, fmtPct } from "@/lib/format";
import { param, type SearchParams } from "@/lib/report-params";
import { KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import {
  getQueueSummary,
  getRogueTags,
  getUnassignedWarehouses,
  getUnknownRunners,
  getUnknownWorkspaces,
  getUntaggedJobs,
} from "@/dal/workQueue";
import { listActiveProducts } from "@/dal/mappings";
import {
  assignWarehouseAction,
  mapJobAction,
  upsertUserAction,
  upsertWorkspaceAction,
} from "@/actions/mappings";
import { createProductAction } from "@/actions/products";
import { ActionForm, Field, SelectField } from "@/components/action-form";
import { EmptyState, KpiTile, PageTitle } from "@/components/ui";
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

  const [summary, products] = await Promise.all([getQueueSummary(), listActiveProducts()]);
  const productOptions = products.map((p) => ({
    value: p.data_product,
    label: `${p.data_product} (${p.desk})`,
  }));
  const deskOptions = [...new Set(products.map((p) => p.desk))].sort();

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
            <Link href={`/queue?tab=${t.key}`}>
              {t.label}
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                {counts[t.key]}
              </span>
            </Link>
          </Button>
        ))}
        <a
          href={`/api/export/queue-${tab}`}
          className="ml-auto text-xs font-medium text-primary hover:underline"
        >
          ⬇ CSV — {TABS.find((t) => t.key === tab)?.label}
        </a>
      </div>

      <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Fixes here affect <strong>live</strong> views immediately; published months never change.
        For jobs, the durable fix is tagging at source — a mapping is a bridge.
      </p>

      {tab === "jobs" && <UntaggedJobsTab productOptions={productOptions} />}
      {tab === "runners" && <UnknownRunnersTab deskOptions={deskOptions} />}
      {tab === "workspaces" && <UnknownWorkspacesTab />}
      {tab === "tags" && <RogueTagsTab deskOptions={deskOptions} />}
      {tab === "warehouses" && <UnassignedWarehousesTab productOptions={productOptions} />}
    </div>
  );
}

function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm font-medium text-primary hover:underline">
        Fix →
      </summary>
      <div className="mt-2 max-w-md rounded-lg border bg-muted/50 p-3">{children}</div>
    </details>
  );
}

async function UntaggedJobsTab({
  productOptions,
}: {
  productOptions: { value: string; label: string }[];
}) {
  const rows = await getUntaggedJobs();
  if (rows.length === 0) return <EmptyState message="No untagged jobs — queue clear. 🎉" />;
  return (
    <Card>
      <CardContent>
        <Table className="align-top">
          <TableHeader>
            <TableRow>
              <TableHead>Work item</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Runner</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.workspace_id}|${r.job_id}`}>
                <TableCell className="font-medium">{r.work_item}</TableCell>
                <TableCell>{r.usage_category}</TableCell>
                <TableCell>{r.workspace_id}</TableCell>
                <TableCell>{r.runner ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtMoney(r.unallocated_cost_30d)}
                </TableCell>
                <TableCell>
                  <RowActions>
                    <ActionForm
                      action={mapJobAction}
                      submitLabel="Map to product"
                      note="Bridge only — remind the owning team to tag the job at source."
                    >
                      <input type="hidden" name="workspace_id" value={r.workspace_id} />
                      <Field label="Job ID" name="job_id" defaultValue={r.job_id ?? ""} readOnly />
                      <SelectField label="Data product" name="data_product" options={productOptions} />
                      <Field label="Note (why mapped manually)" name="note" required={false} />
                    </ActionForm>
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function UnknownRunnersTab({ deskOptions }: { deskOptions: string[] }) {
  const rows = await getUnknownRunners();
  if (rows.length === 0) return <EmptyState message="Every spending runner is mapped. 🎉" />;
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Runner (as in system tables)</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead className="text-right">Rows 30d</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.runner}>
                <TableCell className="font-mono text-xs">{r.runner}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.rows_30d}</TableCell>
                <TableCell>
                  <RowActions>
                    <ActionForm action={upsertUserAction} submitLabel="Add user">
                      {/* user_id pre-filled read-only: it must match the system
                          tables exactly, so stewards never type it */}
                      <Field label="User ID" name="user_id" defaultValue={r.runner} readOnly />
                      <Field label="Display name" name="user_name" />
                      <DeskField deskOptions={deskOptions} />
                    </ActionForm>
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function UnknownWorkspacesTab() {
  const rows = await getUnknownWorkspaces();
  if (rows.length === 0) return <EmptyState message="All billing workspaces are mapped. 🎉" />;
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace ID</TableHead>
              <TableHead className="text-right">DBUs 30d</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.workspace_id}>
                <TableCell className="font-mono text-xs">{r.workspace_id}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtDbu(r.dbus_30d)}</TableCell>
                <TableCell>
                  <RowActions>
                    <ActionForm action={upsertWorkspaceAction} submitLabel="Add workspace">
                      <Field
                        label="Workspace ID"
                        name="workspace_id"
                        defaultValue={r.workspace_id}
                        readOnly
                      />
                      <Field label="Friendly name" name="workspace_name" />
                    </ActionForm>
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function RogueTagsTab({ deskOptions }: { deskOptions: string[] }) {
  const rows = await getRogueTags();
  if (rows.length === 0)
    return <EmptyState message="Every tag in use matches the product catalogue. 🎉" />;
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
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.raw_tag_data_product}>
                <TableCell className="font-mono text-xs">{r.raw_tag_data_product}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.rows_30d}</TableCell>
                <TableCell>
                  <RowActions>
                    <ActionForm
                      action={createProductAction}
                      submitLabel="Register as product"
                      note="If the tag is a typo, don't register it — get it fixed at source instead."
                    >
                      <Field
                        label="Product key (must equal the tag)"
                        name="data_product"
                        defaultValue={r.raw_tag_data_product}
                        readOnly
                      />
                      <Field label="Data domain" name="data_domain" placeholder="e.g. market-data" />
                      <DeskField deskOptions={deskOptions} />
                      <Field label="Product owner" name="product_owner" required={false} />
                      <Field
                        label="Valid from"
                        name="valid_from"
                        type="date"
                        defaultValue={firstOfNextMonth()}
                      />
                    </ActionForm>
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function UnassignedWarehousesTab({
  productOptions,
}: {
  productOptions: { value: string; label: string }[];
}) {
  const rows = await getUnassignedWarehouses();
  if (rows.length === 0) return <EmptyState message="No dedicated-warehouse candidates. 🎉" />;
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
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.warehouse_id}>
                <TableCell className="font-medium">{r.warehouse_id}</TableCell>
                <TableCell>{r.workspace_id}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtPct(r.idle_share)}</TableCell>
                <TableCell>
                  <RowActions>
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
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DeskField({ deskOptions }: { deskOptions: string[] }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground" htmlFor="desk">
        Desk
      </Label>
      <Input id="desk" name="desk" required list="desk-options" />
      <datalist id="desk-options">
        {deskOptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}

function firstOfNextMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
}
