import { Suspense } from "react";
import { requirePageRole } from "@/lib/guards";
import { listActiveProducts, listWarehouseMappings } from "@/dal/mappings";
import { assignWarehouseAction } from "@/actions/mappings";
import { ActionForm, Field, SelectField } from "@/components/action-form";
import { Card, EmptyState, PageTitle, StatusChip } from "@/components/ui";

export const metadata = { title: "Warehouses" };

export default function WarehousesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading warehouses…</p>}>
      <Warehouses />
    </Suspense>
  );
}

async function Warehouses() {
  await requirePageRole("steward");
  const [rows, products] = await Promise.all([listWarehouseMappings(), listActiveProducts()]);
  const productOptions = [
    { value: "", label: "—" },
    ...products.map((p) => ({ value: p.data_product, label: `${p.data_product} (${p.desk})` })),
  ];

  return (
    <div>
      <PageTitle
        title="Warehouse classification"
        subtitle="warehouse_product_mapping — dedicated warehouses charge the whole warehouse (idle included) to one product; shared warehouses allocate per query."
      />

      <details className="no-print mb-6">
        <summary className="btn cursor-pointer">＋ Classify a warehouse</summary>
        <Card className="mt-3 max-w-md">
          <WarehouseForm productOptions={productOptions} />
        </Card>
      </details>

      <Card>
        {rows.length === 0 ? (
          <EmptyState message="No warehouses classified yet." />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Warehouse</th>
                <th className="th">Classification</th>
                <th className="th">Product</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.warehouse_id}>
                  <td className="td font-mono text-xs">{r.warehouse_id}</td>
                  <td className="td">
                    <StatusChip ok={r.is_shared} label={r.is_shared ? "shared" : "dedicated"} />
                  </td>
                  <td className="td font-mono text-xs">{r.data_product ?? "—"}</td>
                  <td className="td">
                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                        Reclassify
                      </summary>
                      <div className="mt-2 max-w-md rounded-md border border-slate-200 bg-slate-50 p-3">
                        <WarehouseForm
                          productOptions={productOptions}
                          warehouseId={r.warehouse_id}
                          defaultMode={r.is_shared ? "shared" : "dedicated"}
                        />
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
