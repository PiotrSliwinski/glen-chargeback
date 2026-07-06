import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { listActiveProducts, listEndpointMappings, listWorkspaces } from "@/dal/mappings";
import { getUnmappedEndpoints } from "@/dal/ai";
import { deleteEndpointMappingAction, mapEndpointAction } from "@/actions/mappings";
import { param, type SearchParams } from "@/lib/report-params";
import { paginate } from "@/lib/paginate";
import { toProductOptions } from "@/lib/product-options";
import { Plus } from "lucide-react";
import { ActionForm, Field, SelectField } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import { PAGE_HELP, KPI_HELP } from "@/lib/kpi-help";
import { fmtMoney } from "@/lib/format";
import { EmptyState, FilteredCount, KpiTile, PageTitle } from "@/components/ui";
import { TableFilter } from "@/components/table-filter";
import { Badge } from "@/components/ui/badge";
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
import { TablePagination } from "@/components/table-pagination";
import { TablePageSkeleton } from "@/components/loading-skeletons";

export const metadata = { title: "AI endpoints" };

export default function EndpointsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading endpoints from Databricks…" kpis withPicker={false} />}>
      <Endpoints searchParams={searchParams} />
    </Suspense>
  );
}

async function Endpoints({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const q = (param(sp.q) ?? "").toLowerCase();

  const [rows, products, workspaces, unmapped] = await Promise.all([
    listEndpointMappings(),
    listActiveProducts(),
    listWorkspaces(),
    getUnmappedEndpoints(),
  ]);
  const productOptions = toProductOptions(products);
  const wsName = new Map(workspaces.map((w) => [w.workspace_id, w.workspace_name]));
  const workspaceOptions = workspaces.map((w) => ({
    value: w.workspace_id,
    label: `${w.workspace_name} (${w.workspace_id})`,
  }));
  const unmappedCost = unmapped.reduce((s, r) => s + r.cost_30d, 0);

  const shown = rows.filter(
    (r) =>
      !q ||
      `${wsName.get(r.workspace_id) ?? ""} ${r.workspace_id} ${r.endpoint_name} ${r.data_product} ${r.note ?? ""} ${r.mapped_by ?? ""}`
        .toLowerCase()
        .includes(q),
  );
  const { rows: pageRows, ...paged } = paginate(shown, param(sp.page));

  return (
    <div>
      <PageTitle
        title="AI endpoints"
        subtitle="endpoint_product_mapping — waterfall rule 4b: a dedicated serving endpoint bills ALL its spend (realtime + ai_query batch inference) to one product."
        info={PAGE_HELP.endpoints}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile
          label="Mapped endpoints"
          value={String(rows.length)}
          hint="goal state: 0 — tag at source"
          tone={rows.length === 0 ? "good" : "default"}
          info={KPI_HELP.endpointsMapped}
        />
        <KpiTile
          label="Unmapped endpoints 30d"
          value={String(unmapped.length)}
          hint="spend fell to UNALLOCATED"
          tone={unmapped.length > 0 ? "warn" : "good"}
          info={KPI_HELP.endpointsUnmapped30d}
        />
        <KpiTile
          label="Unattributed endpoint cost 30d"
          value={fmtMoney(unmappedCost)}
          hint="what a mapping would route to a desk"
          tone={unmappedCost > 0 ? "warn" : "good"}
          info={KPI_HELP.endpointsUnmappedCost30d}
        />
        <KpiTile
          label="Products referenced"
          value={String(new Set(rows.map((r) => r.data_product)).size)}
          hint="by endpoint bridge rows"
          infoAlign="end"
        />
      </div>

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <EditDialog
          trigger={
            <Button>
              <Plus aria-hidden /> Map an endpoint
            </Button>
          }
          title="Map an endpoint"
          description="endpoint_name must match usage_metadata.endpoint_name exactly — names are only unique per workspace, so both are required."
        >
          <EndpointForm productOptions={productOptions} workspaceOptions={workspaceOptions} />
        </EditDialog>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by workspace, endpoint, product, note…" />
        </div>
      </div>

      {unmapped.length > 0 && (
        <Card className="mb-4 ring-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="text-amber-900">
              Unmapped endpoints — spend landing in UNALLOCATED
            </CardTitle>
            <CardDescription className="text-xs text-amber-800">
              These endpoints emitted cost in the last 30 days that no waterfall rule could
              attribute. The durable fix is a <code>data_product</code> tag on the endpoint
              itself; the bridge below routes it today.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="max-w-3xl">
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Unallocated cost 30d</TableHead>
                  <TableHead>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmapped.map((u) => (
                  <TableRow key={`${u.workspace_id}|${u.endpoint_name}`}>
                    <TableCell>{wsName.get(u.workspace_id) ?? u.workspace_id}</TableCell>
                    <TableCell className="font-mono text-xs">{u.endpoint_name}</TableCell>
                    <TableCell>
                      {u.serving_type ? (
                        <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                          {u.serving_type}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(u.cost_30d)}</TableCell>
                    <TableCell>
                      <EditDialog
                        trigger={<RowAction>Map to product</RowAction>}
                        title={`Map endpoint ${u.endpoint_name}`}
                        description="Routes all of this endpoint's spend — past and future, batch inference included — to the selected product."
                      >
                        <EndpointForm
                          productOptions={productOptions}
                          workspaceOptions={workspaceOptions}
                          workspaceId={u.workspace_id}
                          endpointName={u.endpoint_name}
                        />
                      </EditDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Endpoint bridge — endpoint_product_mapping</CardTitle>
          <CardDescription className="text-xs">
            Waterfall rule 4b: pins one (workspace, endpoint) to a product — the serving analogue
            of a dedicated warehouse. A <code>data_product</code> tag on the endpoint (rule 1)
            always wins; tag at source and prune the row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              message={
                rows.length === 0
                  ? "No endpoint mappings — every endpoint attributes via tags. That's the goal state."
                  : "No mappings match the filter."
              }
            />
          ) : (
            <>
              {q && <FilteredCount shown={shown.length} total={rows.length} noun="mapping" />}
              <Table className="align-top">
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Mapped by / at</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={`${r.workspace_id}|${r.endpoint_name}`}>
                      <TableCell>{wsName.get(r.workspace_id) ?? r.workspace_id}</TableCell>
                      <TableCell className="font-mono text-xs">{r.endpoint_name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.data_product}</TableCell>
                      <TableCell className="max-w-56 whitespace-normal text-xs text-muted-foreground">
                        {r.note ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.mapped_by ?? "—"}
                        {r.mapped_at ? ` · ${r.mapped_at.slice(0, 10)}` : ""}
                      </TableCell>
                      <TableCell>
                        <EditDialog
                          trigger={<RowAction danger>Remove</RowAction>}
                          title={`Remove mapping for endpoint ${r.endpoint_name}?`}
                          description="Its future spend attributes via tags — or falls back to UNALLOCATED and resurfaces above."
                        >
                          <ActionForm action={deleteEndpointMappingAction} submitLabel="Remove mapping" danger>
                            <input type="hidden" name="workspace_id" value={r.workspace_id} />
                            <input type="hidden" name="endpoint_name" value={r.endpoint_name} />
                          </ActionForm>
                        </EditDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination {...paged} noun="mapping" />
            </>
          )}
          <p className="no-print mt-3 text-xs text-muted-foreground">
            Endpoint-level spend, batch vs realtime split and per-desk AI figures live on the{" "}
            <Link href="/ai" className="font-medium text-indigo-600 hover:underline">
              AI costs
            </Link>{" "}
            page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function EndpointForm({
  productOptions,
  workspaceOptions,
  workspaceId,
  endpointName,
}: {
  productOptions: { value: string; label: string }[];
  workspaceOptions: { value: string; label: string }[];
  workspaceId?: string;
  endpointName?: string;
}) {
  return (
    <ActionForm action={mapEndpointAction} submitLabel="Map endpoint" resetOnSuccess={!endpointName}>
      {workspaceId ? (
        <Field label="Workspace ID" name="workspace_id" defaultValue={workspaceId} readOnly />
      ) : (
        <SelectField label="Workspace" name="workspace_id" options={workspaceOptions} />
      )}
      {endpointName ? (
        <Field label="Endpoint name" name="endpoint_name" defaultValue={endpointName} readOnly />
      ) : (
        <Field
          label="Endpoint name"
          name="endpoint_name"
          placeholder="as in usage_metadata.endpoint_name"
        />
      )}
      <SelectField label="Data product" name="data_product" options={productOptions} />
      <Field label="Note (why mapped manually)" name="note" required={false} />
      <p className="text-xs text-muted-foreground">
        Reminder: the durable fix is a <code>data_product</code> tag on the endpoint at source —
        this bridge is technical debt to be pruned once the tag lands.
      </p>
    </ActionForm>
  );
}
