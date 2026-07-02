import { Suspense } from "react";
import Link from "next/link";
import { getDeskScorecard, getDeskTrend } from "@/dal/desks";
import { getDeskInvoice, getMonthlyRows, getPublishedMonths } from "@/dal/reports";
import { fmtDbu, fmtMoney, fmtMoneyExact, fmtMonth, fmtPct } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { Card, EmptyState, KpiTile, PageTitle } from "@/components/ui";
import { BarList } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ReportFooter } from "@/components/report-footer";

export const metadata = { title: "Desk detail" };

export default function DeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string }>;
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading desk…</p>}>
      <Desk params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Desk({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string }>;
  searchParams: SearchParams;
}) {
  const { desk: rawDesk } = await params;
  const desk = decodeURIComponent(rawDesk);
  const { month, months, publishedMonths } = await resolveReportParams(searchParams);

  const [trend, monthRows, scorecard, published] = await Promise.all([
    getDeskTrend(desk),
    getMonthlyRows(month, "live"),
    getDeskScorecard(month),
    getPublishedMonths(),
  ]);

  const products = new Map<string, { data_domain: string; cost: number; dbus: number }>();
  for (const r of monthRows.filter((r) => r.desk === desk)) {
    const e = products.get(r.data_product) ?? { data_domain: r.data_domain, cost: 0, dbus: 0 };
    e.cost += r.total_cost;
    e.dbus += r.total_dbus;
    products.set(r.data_product, e);
  }
  const productRows = [...products.entries()]
    .map(([data_product, e]) => ({ data_product, ...e }))
    .sort((a, b) => b.cost - a.cost);
  const monthTotal = productRows.reduce((s, r) => s + r.cost, 0);
  const prevPoint = trend.filter((t) => t.billing_month < month).at(-1);
  const score = scorecard.find((s) => s.desk === desk);

  const invoiceHistory = (
    await Promise.all(
      published
        .slice()
        .sort()
        .reverse()
        .slice(0, 6)
        .map(async (m) => {
          const rows = await getDeskInvoice(m, desk);
          return { month: m, total: rows[0]?.desk_month_total ?? null };
        }),
    )
  ).filter((h) => h.total != null);

  return (
    <div>
      <div className="no-print mb-2">
        <Link href={`/desks?month=${month}`} className="text-sm text-indigo-600 hover:underline">
          ← All desks
        </Link>
      </div>
      <PageTitle title={`Desk: ${desk}`} subtitle={`${fmtMonth(month)} — live figures`}>
        <MonthModePicker
          months={months}
          publishedMonths={publishedMonths}
          month={month}
          mode="live"
          showModeToggle={false}
        />
      </PageTitle>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Cost this month" value={fmtMoney(monthTotal)} />
        <KpiTile
          label="MoM change"
          value={
            prevPoint == null
              ? "—"
              : `${monthTotal - prevPoint.total_cost >= 0 ? "+" : ""}${fmtMoney(monthTotal - prevPoint.total_cost)}`
          }
          hint={prevPoint ? `vs ${fmtMonth(prevPoint.billing_month)}` : undefined}
        />
        <KpiTile
          label="TAG coverage"
          value={score ? fmtPct(score.tag_pct) : "—"}
          tone={score && score.tag_pct >= 0.7 ? "good" : "warn"}
          hint="this desk's tagging discipline"
        />
        <KpiTile
          label="Unattributed (NONE)"
          value={score ? fmtMoney(score.none_cost) : "—"}
          tone={score && score.none_cost > 0 ? "warn" : "good"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Cost trend (12 months)</h2>
          {trend.length === 0 ? (
            <EmptyState message="No history for this desk." />
          ) : (
            <BarList
              items={trend.map((t) => ({
                label: fmtMonth(t.billing_month),
                value: t.total_cost,
                color: t.billing_month === month ? "#4f46e5" : "#94a3b8",
              }))}
            />
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Published invoices</h2>
          {invoiceHistory.length === 0 ? (
            <EmptyState message="No published invoices for this desk yet." />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Month</th>
                  <th className="th text-right">Total</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {invoiceHistory.map((h) => (
                  <tr key={h.month}>
                    <td className="td">{fmtMonth(h.month)}</td>
                    <td className="td text-right tabular-nums">{fmtMoneyExact(h.total!)}</td>
                    <td className="td text-right">
                      <Link
                        href={`/invoices/${encodeURIComponent(desk)}?month=${h.month}`}
                        className="text-indigo-600 hover:underline"
                      >
                        Statement →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Products billed to this desk — {fmtMonth(month)}
          </h2>
          {productRows.length === 0 ? (
            <EmptyState message="No cost for this desk in the selected month." />
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Product</th>
                  <th className="th">Domain</th>
                  <th className="th text-right">DBUs</th>
                  <th className="th text-right">Cost</th>
                  <th className="th text-right">Share of desk</th>
                </tr>
              </thead>
              <tbody>
                {productRows.map((p) => (
                  <tr key={p.data_product}>
                    <td className="td">
                      <Link
                        className="text-indigo-600 hover:underline"
                        href={`/drill?month=${month}&mode=live&domain=${encodeURIComponent(p.data_domain)}&product=${encodeURIComponent(p.data_product)}`}
                      >
                        {p.data_product}
                      </Link>
                    </td>
                    <td className="td">{p.data_domain}</td>
                    <td className="td text-right tabular-nums">{fmtDbu(p.dbus)}</td>
                    <td className="td text-right tabular-nums">{fmtMoney(p.cost)}</td>
                    <td className="td text-right tabular-nums">
                      {monthTotal > 0 ? fmtPct(p.cost / monthTotal) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <ReportFooter />
    </div>
  );
}
