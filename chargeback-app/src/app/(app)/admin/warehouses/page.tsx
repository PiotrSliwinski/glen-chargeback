import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import { listActiveProducts, listWarehouseMappings } from "@/dal/mappings";
import { getUnassignedWarehouses } from "@/dal/workQueue";
import { assignWarehouseAction, bulkAssignWarehousesAction } from "@/actions/mappings";
import { param, type SearchParams } from "@/lib/report-params";
import { paginate } from "@/lib/paginate";
import { toProductOptions } from "@/lib/product-options";
import { Plus, Tags } from "lucide-react";
import { ActionForm, Field, SelectField } from "@/components/action-form";
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
import { EmptyState, FilteredCount, KpiTile, PageTitle, StatusChip } from "@/components/ui";
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
  const productOptions = [{ value: "", label: "—" }, ...toProductOptions(products)];
  const sharedCount = rows.filter((r) => r.is_shared).length;

  const shown = rows.filter(
    (r) =>
      !q ||
      `${r.warehouse_id} ${r.data_product ?? ""} ${r.is_shared ? "shared" : "dedicated"}`
        .toLowerCase()
        .includes(q),
  );
  const { rows: pageRows, ...paged } = paginate(shown, param(sp.page));

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
          {candidates.length} {plural(candidates.length, "warehouse")} with meaningful idle cost
          await classification in the{" "}
          <Link href="/queue" className="font-medium text-indigo-600 hover:underline">
            work queue
          </Link>
          , where cost and idle share are pre-computed.
        </p>
      )}

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <EditDialog
          trigger={
            <Button>
              <Plus aria-hidden /> Classify a warehouse
            </Button>
          }
          title="Classify a warehouse"
          description="A dedicated warehouse requires a product; a shared one must not have one — invalid combinations are rejected."
        >
          <WarehouseForm productOptions={productOptions} />
        </EditDialog>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by warehouse, product, class…" />
        </div>
      </div>

      <BulkSelect values={pageRows.map((r) => r.warehouse_id)}>
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
              {q && <FilteredCount shown={shown.length} total={rows.length} noun="warehouse" />}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <BulkCheckboxAll label="Select all shown warehouses" />
                  </TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.warehouse_id}>
                    <TableCell>
                      <BulkCheckbox
                        value={r.warehouse_id}
                        label={`Select warehouse ${r.warehouse_id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.warehouse_id}</TableCell>
                    <TableCell>
                      <StatusChip ok={r.is_shared} label={r.is_shared ? "shared" : "dedicated"} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.data_product ?? "—"}</TableCell>
                    <TableCell>
                      <EditDialog
                        trigger={<RowAction>Reclassify</RowAction>}
                        title={`Reclassify warehouse ${r.warehouse_id}`}
                        description="A dedicated warehouse requires a product; a shared one must not have one — invalid combinations are rejected."
                      >
                        <WarehouseForm
                          productOptions={productOptions}
                          warehouseId={r.warehouse_id}
                          defaultMode={r.is_shared ? "shared" : "dedicated"}
                        />
                      </EditDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination {...paged} noun="warehouse" />
            </>
          )}
        </CardContent>
      </Card>

      <BulkActionBar noun="warehouse">
        <EditDialog
          trigger={
            <Button variant="outline" size="sm">
              <Tags aria-hidden /> Reclassify selected
            </Button>
          }
          title="Reclassify selected warehouses"
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
              options={productOptions}
            />
            <BulkAppliesTo noun="warehouse" />
          </ActionForm>
        </EditDialog>
      </BulkActionBar>
      </BulkSelect>
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
    <ActionForm action={assignWarehouseAction} submitLabel="Save">
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
