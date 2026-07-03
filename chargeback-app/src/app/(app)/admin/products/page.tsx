import { Suspense } from "react";
import { requirePageRole } from "@/lib/guards";
import { listCatalogue, listJobMappings, listWarehouseMappings } from "@/dal/mappings";
import {
  createProductAction,
  moveProductAction,
  retireProductAction,
  updateOwnerAction,
} from "@/actions/products";
import { param, type SearchParams } from "@/lib/report-params";
import { Plus } from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { PAGE_HELP } from "@/lib/kpi-help";
import { EmptyState, KpiTile, PageTitle, StatusChip } from "@/components/ui";
import { TableFilter } from "@/components/table-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DataProductRow } from "@/dal/types";
import { TablePageSkeleton } from "@/components/loading-skeletons";

export const metadata = { title: "Product catalogue" };

export default function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading catalogue from Databricks…" kpis withPicker={false} />}>
      <Products searchParams={searchParams} />
    </Suspense>
  );
}

async function Products({ searchParams }: { searchParams: SearchParams }) {
  await requirePageRole("steward");
  const sp = await searchParams;
  const q = (param(sp.q) ?? "").toLowerCase();

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

  const activeRows = catalogue.filter((r) => r.valid_to == null);
  const retiredCount = [...byProduct.values()].filter(
    (versions) => !versions.some((v) => v.valid_to == null),
  ).length;
  const domains = new Set(activeRows.map((r) => r.data_domain)).size;
  const desks = new Set(activeRows.map((r) => r.desk)).size;

  const entries = [...byProduct.entries()].filter(
    ([product, versions]) =>
      !q ||
      `${product} ${versions.map((v) => `${v.data_domain} ${v.desk} ${v.product_owner ?? ""}`).join(" ")}`
        .toLowerCase()
        .includes(q),
  );

  return (
    <div>
      <PageTitle
        title="Product catalogue"
        subtitle="data_product_mapping — one row per product per validity period. Never edited in place; desk/domain changes create a new version."
        info={PAGE_HELP.products}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Active products" value={String(activeRows.length)} hint={`${catalogue.length} rows incl. history`} />
        <KpiTile label="Retired" value={String(retiredCount)} hint="rows are never deleted" />
        <KpiTile label="Domains" value={String(domains)} hint="level 1 of the hierarchy" />
        <KpiTile label="Desks paying" value={String(desks)} hint="level 3 — who gets invoiced" />
      </div>

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <details>
          <Button asChild>
            <summary className="cursor-pointer">
              <Plus aria-hidden /> Register new product
            </summary>
          </Button>
          <Card className="mt-3 max-w-md">
            <CardContent>
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
            </CardContent>
          </Card>
        </details>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by key, domain, desk, owner…" />
        </div>
      </div>

      {q && (
        <p className="mb-2 text-xs text-muted-foreground">
          {entries.length} of {byProduct.size} products shown
        </p>
      )}
      {entries.length === 0 && (
        <EmptyState
          message={byProduct.size === 0 ? "No products registered yet." : "No products match the filter."}
        />
      )}
      <div className="space-y-4">
        {entries.map(([product, versions]) => {
          const active = versions.find((v) => v.valid_to == null);
          const history = versions.filter((v) => v.valid_to != null);
          const refs = refCount(product);
          return (
            <Card key={product}>
              <CardContent>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <h2 className="font-mono text-sm font-semibold">{product}</h2>
                    <StatusChip ok={!!active} label={active ? "active" : "retired"} />
                    {refs > 0 && (
                      <Badge variant="secondary" className="bg-muted text-muted-foreground">
                        referenced by {refs} bridge mapping{refs > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  {active && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">{active.data_domain}</span> · desk{" "}
                      <span className="font-medium">{active.desk}</span>
                      {active.product_owner && <> · owner {active.product_owner}</>}
                      <span className="text-muted-foreground/70"> · since {active.valid_from}</span>
                    </p>
                  )}
                </div>

                {history.length > 0 && (
                  <div className="mt-2 border-l-2 pl-3">
                    {history.map((h) => (
                      <p key={h.valid_from} className="text-xs text-muted-foreground">
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
                      <div className="mt-2 max-w-md rounded-lg border bg-muted/50 p-3">
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
                      <div className="mt-2 max-w-md rounded-lg border bg-muted/50 p-3">
                        <ActionForm action={updateOwnerAction} submitLabel="Update owner">
                          <input type="hidden" name="data_product" value={product} />
                          <Field label="Product owner" name="product_owner" defaultValue={active.product_owner ?? ""} required={false} />
                        </ActionForm>
                      </div>
                    </details>

                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-destructive hover:underline">
                        Retire
                      </summary>
                      <div className="mt-2 max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-3">
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
              </CardContent>
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
