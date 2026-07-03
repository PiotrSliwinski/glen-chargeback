import { Suspense } from "react";
import Link from "next/link";
import { getDashboard, getDomainProducts, getProductDetail } from "@/dal/reports";
import { fmtDbu, fmtMoney, fmtMonth } from "@/lib/format";
import { param, resolveReportParams, type SearchParams } from "@/lib/report-params";
import { PAGE_HELP } from "@/lib/kpi-help";
import { ComputeChip, EmptyState, MethodBadge, PageTitle } from "@/components/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/table-pagination";
import { paginate } from "@/lib/paginate";
import { MonthModePicker } from "@/components/month-picker";
import { ModeBanner } from "@/components/mode-banner";
import { ReportFooter } from "@/components/report-footer";
import { TableCardSkeleton, TablePageSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";

export const metadata = { title: "Drill-down" };

export default function DrillPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense
      searchParams={searchParams}
      fallback={<TablePageSkeleton label="Loading drill-down from Databricks…" />}
    >
      <Drill searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

async function Drill({ searchParams }: { searchParams: SearchParams }) {
  const { month, mode, months, publishedMonths, sp } = await resolveReportParams(searchParams);
  const domain = param(sp.domain);
  const product = param(sp.product);
  const base = `/drill?month=${month}&mode=${mode}`;

  const dashboard = await getDashboard(month, mode);

  return (
    <div>
      <PageTitle
        title="Drill-down"
        subtitle={`${fmtMonth(month)} — domain → product → detail`}
        info={PAGE_HELP.drill}
      >
        <MonthModePicker
          months={months}
          publishedMonths={publishedMonths}
          month={month}
          mode={mode}
        />
      </PageTitle>

      <ModeBanner mode={mode} publishedMonth={publishedMonths.includes(month)} />

      {/* breadcrumb */}
      <p className="mb-4 text-sm text-muted-foreground">
        <Link className="text-indigo-600 hover:underline" href={base}>
          All domains
        </Link>
        {domain && (
          <>
            {" / "}
            <Link
              className="text-indigo-600 hover:underline"
              href={`${base}&domain=${encodeURIComponent(domain)}`}
            >
              {domain}
            </Link>
          </>
        )}
        {product && <> / {product}</>}
      </p>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Domains (level 1)</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.byDomain.length === 0 ? (
              <EmptyState
                message={
                  mode === "published" && !publishedMonths.includes(month)
                    ? "This month has not been published yet — switch to live or pick a published month."
                    : "No cost recorded for the selected month."
                }
              />
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">DBUs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.byDomain.map((d) => (
                  <TableRow key={d.data_domain} className={d.data_domain === domain ? "bg-indigo-50" : ""}>
                    <TableCell>
                      <Link
                        className="text-indigo-600 hover:underline"
                        href={`${base}&domain=${encodeURIComponent(d.data_domain)}`}
                      >
                        {d.data_domain}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(d.total_cost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtDbu(d.total_dbus)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>

        {domain && (
          <Suspense fallback={<TableCardSkeleton rows={4} />}>
            <ProductsPanel month={month} mode={mode} domain={domain} product={product} base={base} />
          </Suspense>
        )}

        {product && (
          <Suspense fallback={<TableCardSkeleton rows={8} />}>
            <DetailPanel month={month} product={product} page={param(sp.page)} />
          </Suspense>
        )}
      </div>

      <ReportFooter />
    </div>
  );
}

async function ProductsPanel({
  month,
  mode,
  domain,
  product,
  base,
}: {
  month: string;
  mode: "live" | "published";
  domain: string;
  product?: string;
  base: string;
}) {
  const products = await getDomainProducts(month, domain, mode);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Products in {domain} (level 2)</CardTitle>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <EmptyState message="No products with cost in this domain for the selected month." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Desk (level 3)</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">DBUs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={`${p.data_product} ${p.desk}`} className={p.data_product === product ? "bg-indigo-50" : ""}>
                  <TableCell>
                    <Link
                      className="text-indigo-600 hover:underline"
                      href={`${base}&domain=${encodeURIComponent(domain)}&product=${encodeURIComponent(p.data_product)}`}
                    >
                      {p.data_product}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {/* the desk view is mode-aware; an invoice link could silently
                        fall back to a different (published) month in live mode */}
                    <Link
                      className="text-indigo-600 hover:underline"
                      href={`/desks/${encodeURIComponent(p.desk)}?month=${month}&mode=${mode}`}
                    >
                      {p.desk}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(p.cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDbu(p.dbus)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

async function DetailPanel({
  month,
  product,
  page,
}: {
  month: string;
  product: string;
  page?: string;
}) {
  const detail = await getProductDetail(month, product);
  const { rows: pageRows, ...paged } = paginate(detail, page);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          What makes up {product}&apos;s cost (live cost_fact, top 200)
        </CardTitle>
        <CardDescription>
          The attribution badge shows <em>why</em> each line landed on this product.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {detail.length === 0 ? (
          <EmptyState message="No detail rows for this product in the selected month." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Job / warehouse</TableHead>
                <TableHead>Runner</TableHead>
                <TableHead>Compute</TableHead>
                <TableHead>Attribution</TableHead>
                <TableHead className="text-right">DBUs</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((d, i) => (
                <TableRow key={i}>
                  <TableCell>{d.usage_category}</TableCell>
                  <TableCell>{d.job_name ?? d.warehouse_id ?? "—"}</TableCell>
                  <TableCell>{d.runner_name ?? "—"}</TableCell>
                  <TableCell>
                    <ComputeChip isServerless={d.is_serverless} />
                  </TableCell>
                  <TableCell>
                    <MethodBadge method={d.attribution_method} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtDbu(d.dbus)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(d.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <TablePagination {...paged} noun="detail row" />
      </CardContent>
    </Card>
  );
}
