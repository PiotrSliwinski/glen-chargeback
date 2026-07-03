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
import { paginate } from "@/lib/paginate";
import { Plus } from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { SplitEditor } from "@/components/split-editor";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import { PAGE_HELP } from "@/lib/kpi-help";
import { firstOfNextMonth, plural } from "@/lib/format";
import { EmptyState, FilteredCount, KpiTile, PageTitle, StatusChip } from "@/components/ui";
import { TableFilter } from "@/components/table-filter";
import { TablePagination } from "@/components/table-pagination";
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
  const activeProductCount = new Set(activeRows.map((r) => r.data_product)).size;
  // datalist suggestions for split editors — every desk the catalogue knows
  const deskOptions = [...new Set(catalogue.map((r) => r.desk))].sort();
  const fmtShare = (pct: number) => `${Number((pct * 100).toFixed(2))}%`;

  const entries = [...byProduct.entries()].filter(
    ([product, versions]) =>
      !q ||
      `${product} ${versions.map((v) => `${v.data_domain} ${v.desk} ${v.product_owner ?? ""}`).join(" ")}`
        .toLowerCase()
        .includes(q),
  );
  const { rows: pageEntries, ...paged } = paginate(entries, param(sp.page));

  return (
    <div>
      <PageTitle
        title="Product catalogue"
        subtitle="data_product_mapping — one row per product per desk per validity period; shared products carry a % split across desks. Never edited in place; desk/domain/split changes create a new version."
        info={PAGE_HELP.products}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Active products" value={String(activeProductCount)} hint={`${catalogue.length} rows incl. history`} />
        <KpiTile label="Retired" value={String(retiredCount)} hint="rows are never deleted" />
        <KpiTile label="Domains" value={String(domains)} hint="level 1 of the hierarchy" />
        <KpiTile label="Desks paying" value={String(desks)} hint="level 3 — who gets invoiced" />
      </div>

      <div className="no-print mb-6 flex flex-wrap items-start gap-3">
        <EditDialog
          trigger={
            <Button>
              <Plus aria-hidden /> Register new product
            </Button>
          }
          title="Register new product"
          description="The key becomes the tag vocabulary — lowercase, hyphen/underscore, no spaces (e.g. pricing-curves). Valid-from defaults to the first of next month."
        >
          <ActionForm action={createProductAction} submitLabel="Create product" resetOnSuccess>
            <Field label="Product key" name="data_product" placeholder="pricing-curves" />
            <Field label="Data domain" name="data_domain" placeholder="market-data" />
            <SplitEditor deskOptions={deskOptions} />
            <Field label="Product owner" name="product_owner" required={false} />
            <Field label="Valid from" name="valid_from" type="date" defaultValue={firstOfNextMonth()} />
          </ActionForm>
        </EditDialog>
        <div className="ml-auto">
          <TableFilter placeholder="Filter by key, domain, desk, owner…" />
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          message={byProduct.size === 0 ? "No products registered yet." : "No products match the filter."}
        />
      ) : (
        q && <FilteredCount shown={entries.length} total={byProduct.size} noun="product" />
      )}
      <div className="space-y-4">
        {pageEntries.map(([product, versions]) => {
          // one active row per desk of the current split, largest share first
          const active = versions
            .filter((v) => v.valid_to == null)
            .sort((a, b) => b.cost_split_pct - a.cost_split_pct || a.desk.localeCompare(b.desk));
          const primary = active[0];
          // history rows of one validity window (a past split) render as one line
          const historyWindows = new Map<string, DataProductRow[]>();
          for (const v of versions.filter((v) => v.valid_to != null)) {
            const key = `${v.valid_from}|${v.valid_to}`;
            historyWindows.set(key, [...(historyWindows.get(key) ?? []), v]);
          }
          const refs = refCount(product);
          return (
            <Card key={product}>
              <CardContent>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <h2 className="font-mono text-sm font-semibold">{product}</h2>
                    <StatusChip ok={!!primary} label={primary ? "active" : "retired"} />
                    {active.length > 1 && (
                      <Badge variant="secondary" className="bg-muted text-muted-foreground">
                        split across {active.length} desks
                      </Badge>
                    )}
                    {refs > 0 && (
                      <Badge variant="secondary" className="bg-muted text-muted-foreground">
                        referenced by {refs} job/warehouse {plural(refs, "mapping")}
                      </Badge>
                    )}
                  </div>
                  {primary && (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">{primary.data_domain}</span> ·{" "}
                      {active.length === 1 ? (
                        <>
                          desk <span className="font-medium">{primary.desk}</span>
                        </>
                      ) : (
                        <>
                          desks{" "}
                          <span className="font-medium">
                            {active.map((a) => `${a.desk} ${fmtShare(a.cost_split_pct)}`).join(" + ")}
                          </span>
                        </>
                      )}
                      {primary.product_owner && <> · owner {primary.product_owner}</>}
                      <span className="text-muted-foreground/70"> · since {primary.valid_from}</span>
                    </p>
                  )}
                </div>

                {historyWindows.size > 0 && (
                  <div className="mt-2 border-l-2 pl-3">
                    {[...historyWindows.entries()].map(([key, rows]) => (
                      <p key={key} className="text-xs text-muted-foreground">
                        {rows[0].valid_from} → {rows[0].valid_to}: {rows[0].data_domain} / desk{" "}
                        {rows.length === 1
                          ? rows[0].desk
                          : rows
                              .sort((a, b) => b.cost_split_pct - a.cost_split_pct)
                              .map((r) => `${r.desk} ${fmtShare(r.cost_split_pct)}`)
                              .join(" + ")}
                      </p>
                    ))}
                  </div>
                )}

                {primary && (
                  <div className="no-print mt-3 flex flex-wrap gap-4">
                    <EditDialog
                      trigger={<RowAction>Move / change desk split</RowAction>}
                      title={`Move ${product}`}
                      description={`Closes the current version at the cutover and starts a new one — change the domain, the paying desk(s) or their shares. History before the cutover keeps the current split; published months never restate.`}
                    >
                      <ActionForm action={moveProductAction} submitLabel="Move product">
                        <input type="hidden" name="data_product" value={product} />
                        <Field label="Cutover date" name="cutover" type="date" defaultValue={firstOfNextMonth()} />
                        <Field label="New domain" name="new_domain" defaultValue={primary.data_domain} />
                        <SplitEditor
                          deskOptions={deskOptions}
                          initial={active.map((a) => ({
                            desk: a.desk,
                            pct: Number((a.cost_split_pct * 100).toFixed(2)),
                          }))}
                        />
                        <Field label="Owner" name="new_owner" defaultValue={primary.product_owner ?? ""} required={false} />
                      </ActionForm>
                    </EditDialog>

                    <EditDialog
                      trigger={<RowAction>Edit owner</RowAction>}
                      title={`Edit owner of ${product}`}
                      description="Owner is metadata on the current version — no new version is created."
                    >
                      <ActionForm action={updateOwnerAction} submitLabel="Update owner">
                        <input type="hidden" name="data_product" value={product} />
                        <Field label="Product owner" name="product_owner" defaultValue={primary.product_owner ?? ""} required={false} />
                      </ActionForm>
                    </EditDialog>

                    <EditDialog
                      trigger={<RowAction danger>Retire</RowAction>}
                      title={`Retire ${product}?`}
                      description="Blocked while bridge mappings still reference this product. Usage after retirement falls to the work queue. Rows are never deleted."
                    >
                      <ActionForm action={retireProductAction} submitLabel="Retire product" danger>
                        <input type="hidden" name="data_product" value={product} />
                        <Field label="Retire as of" name="valid_to" type="date" defaultValue={firstOfNextMonth()} />
                      </ActionForm>
                    </EditDialog>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <TablePagination {...paged} noun="product" />
    </div>
  );
}
