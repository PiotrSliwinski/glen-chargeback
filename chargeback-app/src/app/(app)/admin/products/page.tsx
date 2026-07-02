import { Suspense } from "react";
import { requirePageRole } from "@/lib/guards";
import { listCatalogue, listJobMappings, listWarehouseMappings } from "@/dal/mappings";
import {
  createProductAction,
  moveProductAction,
  retireProductAction,
  updateOwnerAction,
} from "@/actions/products";
import { ActionForm, Field } from "@/components/action-form";
import { Card, PageTitle, StatusChip } from "@/components/ui";
import type { DataProductRow } from "@/dal/types";

export const metadata = { title: "Product catalogue" };

export default function ProductsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading catalogue…</p>}>
      <Products />
    </Suspense>
  );
}

async function Products() {
  await requirePageRole("steward");
  const [catalogue, jobs, warehouses] = await Promise.all([
    listCatalogue(),
    listJobMappings(),
    listWarehouseMappings(),
  ]);

  const byProduct = new Map<string, DataProductRow[]>();
  for (const row of catalogue) {
    byProduct.set(row.data_product, [...(byProduct.get(row.data_product) ?? []), row]);
  }
  const refCount = (p: string) =>
    jobs.filter((j) => j.data_product === p).length +
    warehouses.filter((w) => w.data_product === p).length;

  return (
    <div>
      <PageTitle
        title="Product catalogue"
        subtitle="data_product_mapping — one row per product per validity period. Never edited in place; desk/domain changes create a new version."
      />

      <details className="no-print mb-6">
        <summary className="btn cursor-pointer">＋ Register new product</summary>
        <Card className="mt-3 max-w-md">
          <ActionForm
            action={createProductAction}
            submitLabel="Create product"
            note="The key becomes the tag vocabulary — lowercase, hyphen/underscore, no spaces (e.g. pricing-curves). Valid-from defaults to the first of next month."
          >
            <Field label="Product key" name="data_product" placeholder="pricing-curves" />
            <Field label="Data domain" name="data_domain" placeholder="market-data" />
            <Field label="Desk (who pays)" name="desk" placeholder="rates" />
            <Field label="Product owner" name="product_owner" required={false} />
            <Field label="Valid from" name="valid_from" type="date" defaultValue={firstOfNextMonth()} />
          </ActionForm>
        </Card>
      </details>

      <div className="space-y-4">
        {[...byProduct.entries()].map(([product, versions]) => {
          const active = versions.find((v) => v.valid_to == null);
          const history = versions.filter((v) => v.valid_to != null);
          const refs = refCount(product);
          return (
            <Card key={product}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="font-mono text-sm font-semibold text-slate-900">{product}</h2>
                  <StatusChip ok={!!active} label={active ? "active" : "retired"} />
                  {refs > 0 && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      referenced by {refs} bridge mapping{refs > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {active && (
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">{active.data_domain}</span> · desk{" "}
                    <span className="font-medium">{active.desk}</span>
                    {active.product_owner && <> · owner {active.product_owner}</>}
                    <span className="text-slate-400"> · since {active.valid_from}</span>
                  </p>
                )}
              </div>

              {history.length > 0 && (
                <div className="mt-2 border-l-2 border-slate-200 pl-3">
                  {history.map((h) => (
                    <p key={h.valid_from} className="text-xs text-slate-500">
                      {h.valid_from} → {h.valid_to}: {h.data_domain} / desk {h.desk}
                    </p>
                  ))}
                </div>
              )}

              {active && (
                <div className="no-print mt-3 flex flex-wrap gap-4">
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-indigo-600 hover:underline">
                      Move to another desk/domain
                    </summary>
                    <div className="mt-2 max-w-md rounded-md border border-slate-200 bg-slate-50 p-3">
                      <ActionForm
                        action={moveProductAction}
                        submitLabel="Move product"
                        note={`Closes the current version at the cutover and starts a new one. History before the cutover keeps desk '${active.desk}'; published months never restate.`}
                      >
                        <input type="hidden" name="data_product" value={product} />
                        <Field label="Cutover date" name="cutover" type="date" defaultValue={firstOfNextMonth()} />
                        <Field label="New domain" name="new_domain" defaultValue={active.data_domain} />
                        <Field label="New desk" name="new_desk" defaultValue={active.desk} />
                        <Field label="Owner" name="new_owner" defaultValue={active.product_owner ?? ""} required={false} />
                      </ActionForm>
                    </div>
                  </details>

                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-indigo-600 hover:underline">
                      Edit owner
                    </summary>
                    <div className="mt-2 max-w-md rounded-md border border-slate-200 bg-slate-50 p-3">
                      <ActionForm action={updateOwnerAction} submitLabel="Update owner">
                        <input type="hidden" name="data_product" value={product} />
                        <Field label="Product owner" name="product_owner" defaultValue={active.product_owner ?? ""} required={false} />
                      </ActionForm>
                    </div>
                  </details>

                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-red-600 hover:underline">
                      Retire
                    </summary>
                    <div className="mt-2 max-w-md rounded-md border border-red-200 bg-red-50 p-3">
                      <ActionForm
                        action={retireProductAction}
                        submitLabel="Retire product"
                        danger
                        note="Blocked while bridge mappings still reference this product. Usage after retirement falls to the work queue. Rows are never deleted."
                      >
                        <input type="hidden" name="data_product" value={product} />
                        <Field label="Retire as of" name="valid_to" type="date" defaultValue={firstOfNextMonth()} />
                      </ActionForm>
                    </div>
                  </details>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function firstOfNextMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
}
