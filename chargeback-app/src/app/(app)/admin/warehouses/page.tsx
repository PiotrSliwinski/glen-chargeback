import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { listActiveProducts, listWarehouseMappings } from "@/dal/mappings";
import { getUnassignedWarehouses } from "@/dal/workQueue";
import { assignWarehouseAction } from "@/actions/mappings";
import { param, type SearchParams } from "@/lib/report-params";
import { ActionForm, Field, SelectField } from "@/components/action-form";
import { PAGE_HELP } from "@/lib/kpi-help";
import { EmptyState, KpiTile, PageTitle, StatusChip } from "@/components/ui";
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

export const metadata = { title: "Warehouses" };

export default function WarehousesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading warehouses from Databricks…" kpis withPicker={false} />}>
      <Warehouses searchParams={searchParams} />
    </Suspense>
  );
}

async function Warehouses({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const q = (param(sp.q) ?? "").toLowerCase();

  const [rows, products, candidates] = await Promise.all([
    listWarehouseMappings(),
    listActiveProducts(),
    getUnassignedWarehouses(),
  ]);
  const productOptions = [
    { value: "", label: "—" },
    ...products.map((p) => ({ value: p.data_product, label: `${p.data_product} (${p.desk})` })),
  ];
  const sharedCount = rows.filter((r) => r.is_shared).length;

  const shown = rows.filter(
    (r) =>
      !q ||
      `${r.warehouse_id} ${r.data_product ?? ""} ${r.is_shared ? "shared" : "dedicated"}`
        .toLowerCase()
        .includes(q),
  );

  return (
    <div>
      <PageTitle
        title="Warehouse classification"
        subtitle="warehouse_product_mapping — dedicated warehouses charge the whole warehouse (idle included) to one product; shared warehouses allocate per query."
        info={PAGE_HELP.warehouses}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Classified" value={String(rows.length)} />
        <KpiTile label="Shared" value={String(sharedCount)} hint="allocated per query" />
        <KpiTile
          label="Dedicated"
          value={String(rows.length - sharedCount)}
          hint="whole warehouse incl. idle → one product"
        />
        <KpiTile
          label="Unassigned candidates 30d"
          value={String(candidates.length)}
          hint="idle-heavy, USER/NONE-attributed"
          tone={candidates.length > 0 ? "warn" : "good"}
        />
      </div>

      {candidates.length > 0 && (
        <p className="no-print mb-4 text-sm text-muted-foreground">
          {candidates.length} warehouse{candidates.length > 1 ? "s" : ""} with meaningful idle cost
          await classification in the{" "}
          <Link href="/queue" className="font-medium text-indigo-600 hover:underline">
            work queue
          </Link>
          , where cost and idle share are pre-computed.
        </p>
      )}

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <details>
          <Button asChild>
            <summary className="cursor-pointer">＋ Classify a warehouse</summary>
          </Button>
          <Card className="mt-3 max-w-md">
            <CardContent>
              <WarehouseForm productOptions={productOptions} />
            </CardContent>
          </Card>
        </details>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by warehouse, product, class…" />
        </div>
      </div>

      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              message={
                rows.length === 0
                  ? "No warehouses classified yet."
                  : "No warehouses match the filter."
              }
            />
          ) : (
            <>
              {q && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {shown.length} of {rows.length} warehouses shown
                </p>
              )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.warehouse_id}>
                    <TableCell className="font-mono text-xs">{r.warehouse_id}</TableCell>
                    <TableCell>
                      <StatusChip ok={r.is_shared} label={r.is_shared ? "shared" : "dedicated"} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.data_product ?? "—"}</TableCell>
                    <TableCell>
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                          Reclassify
                        </summary>
                        <div className="mt-2 max-w-md rounded-lg border bg-muted/50 p-3">
                          <WarehouseForm
                            productOptions={productOptions}
                            warehouseId={r.warehouse_id}
                            defaultMode={r.is_shared ? "shared" : "dedicated"}
                          />
                        </div>
                      </details>
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

function WarehouseForm({
  productOptions,
  warehouseId,
  defaultMode = "shared",
}: {
  productOptions: { value: string; label: string }[];
  warehouseId?: string;
  defaultMode?: "shared" | "dedicated";
}) {
  return (
    <ActionForm
      action={assignWarehouseAction}
      submitLabel="Save"
      note="A dedicated warehouse requires a product; a shared one must not have one — invalid combinations are rejected."
    >
      {warehouseId ? (
        <Field label="Warehouse ID" name="warehouse_id" defaultValue={warehouseId} readOnly />
      ) : (
        <Field label="Warehouse ID" name="warehouse_id" placeholder="as in usage_metadata.warehouse_id" />
      )}
      <SelectField
        label="Classification"
        name="mode"
        defaultValue={defaultMode}
        options={[
          { value: "shared", label: "Shared — allocate per query" },
          { value: "dedicated", label: "Dedicated — whole warehouse to one product" },
        ]}
      />
      <SelectField
        label="Data product (dedicated only)"
        name="data_product"
        required={false}
        options={productOptions}
      />
    </ActionForm>
  );
}
