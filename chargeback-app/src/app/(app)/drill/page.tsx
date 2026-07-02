import { Suspense } from "react";
import Link from "next/link";
import { getDashboard, getDomainProducts, getProductDetail } from "@/dal/reports";
import { fmtDbu, fmtMoney, fmtMonth } from "@/lib/format";
import { param, resolveReportParams, type SearchParams } from "@/lib/report-params";
import { Card, EmptyState, MethodBadge, PageTitle } from "@/components/ui";
import { MonthModePicker } from "@/components/month-picker";
import { ModeBanner } from "@/components/mode-banner";
import { ReportFooter } from "@/components/report-footer";

export const metadata = { title: "Drill-down" };

export default function DrillPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading drill-down…</p>}>
      <Drill searchParams={searchParams} />
    </Suspense>
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
      <p className="mb-4 text-sm text-slate-500">
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
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Domains (level 1)</h2>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Domain</th>
                <th className="th text-right">Cost</th>
                <th className="th text-right">DBUs</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.byDomain.map((d) => (
                <tr key={d.data_domain} className={d.data_domain === domain ? "bg-indigo-50" : ""}>
                  <td className="td">
                    <Link
                      className="text-indigo-600 hover:underline"
                      href={`${base}&domain=${encodeURIComponent(d.data_domain)}`}
                    >
                      {d.data_domain}
                    </Link>
                  </td>
                  <td className="td text-right tabular-nums">{fmtMoney(d.total_cost)}</td>
                  <td className="td text-right tabular-nums">{fmtDbu(d.total_dbus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {domain && (
          <Suspense fallback={<Card>Loading products…</Card>}>
            <ProductsPanel month={month} mode={mode} domain={domain} product={product} base={base} />
          </Suspense>
        )}

        {product && (
          <Suspense fallback={<Card>Loading detail…</Card>}>
            <DetailPanel month={month} product={product} />
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
      <h2 className="mb-3 text-sm font-semibold text-slate-700">
        Products in {domain} (level 2)
      </h2>
      {products.length === 0 ? (
        <EmptyState message="No products with cost in this domain for the selected month." />
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Product</th>
              <th className="th">Desk (level 3)</th>
              <th className="th text-right">Cost</th>
              <th className="th text-right">DBUs</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.data_product} className={p.data_product === product ? "bg-indigo-50" : ""}>
                <td className="td">
                  <Link
                    className="text-indigo-600 hover:underline"
                    href={`${base}&domain=${encodeURIComponent(domain)}&product=${encodeURIComponent(p.data_product)}`}
                  >
                    {p.data_product}
                  </Link>
                </td>
                <td className="td">
                  <Link
                    className="text-indigo-600 hover:underline"
                    href={`/invoices/${encodeURIComponent(p.desk)}?month=${month}`}
                  >
                    {p.desk}
                  </Link>
                </td>
                <td className="td text-right tabular-nums">{fmtMoney(p.cost)}</td>
                <td className="td text-right tabular-nums">{fmtDbu(p.dbus)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

async function DetailPanel({ month, product }: { month: string; product: string }) {
  const detail = await getProductDetail(month, product);
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-700">
        What makes up {product}&apos;s cost (live cost_fact, top 200)
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        The attribution badge shows <em>why</em> each line landed on this product.
      </p>
      {detail.length === 0 ? (
        <EmptyState message="No detail rows for this product in the selected month." />
      ) : (
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Category</th>
              <th className="th">Job / warehouse</th>
              <th className="th">Runner</th>
              <th className="th">Attribution</th>
              <th className="th text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {detail.map((d, i) => (
              <tr key={i}>
                <td className="td">{d.usage_category}</td>
                <td className="td">{d.job_name ?? d.warehouse_id ?? "—"}</td>
                <td className="td">{d.runner_name ?? "—"}</td>
                <td className="td">
                  <MethodBadge method={d.attribution_method} />
                </td>
                <td className="td text-right tabular-nums">{fmtMoney(d.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
