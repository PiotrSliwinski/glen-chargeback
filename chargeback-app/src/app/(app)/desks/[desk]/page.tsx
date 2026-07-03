import { Fragment } from "react";
import Link from "next/link";
import { getDeskDetail, getDeskScorecard, getDeskTrend } from "@/dal/desks";
import { getDeskInvoice, getMonthlyRows, getPublishedMonths } from "@/dal/reports";
import { fmtDbu, fmtMoney, fmtMoneyExact, fmtMonth, fmtPct, momKpi } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { ComputeChip, EmptyState, KpiTile, MethodBadge, PageTitle } from "@/components/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarList } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ReportFooter } from "@/components/report-footer";
import { ReportSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";

export const metadata = { title: "Desk detail" };

export default function DeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ desk: string }>;
  searchParams: SearchParams;
}) {
  return (
    <SearchParamsSuspense
      searchParams={searchParams}
      fallback={<ReportSkeleton label="Loading desk from Databricks…" />}
    >
      <Desk params={params} searchParams={searchParams} />
    </SearchParamsSuspense>
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

  const [trend, monthRows, scorecard, published, deskDetail] = await Promise.all([
    getDeskTrend(desk),
    getMonthlyRows(month, "live"),
    getDeskScorecard(month),
    getPublishedMonths(),
    getDeskDetail(month, desk),
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

  // How the number was constructed: usage category × compute type, from cost_fact
  const detailTotal = deskDetail.reduce((s, r) => s + r.cost, 0);
  const computeLabel = (v: boolean | null) =>
    v == null ? "per-query warehouse" : v ? "Serverless" : "Classic";
  const rollup = new Map<string, { usage_category: string; is_serverless: boolean | null; dbus: number; cost: number }>();
  for (const r of deskDetail) {
    const key = `${r.usage_category}|${r.is_serverless}`;
    const e = rollup.get(key) ?? {
      usage_category: r.usage_category,
      is_serverless: r.is_serverless,
      dbus: 0,
      cost: 0,
    };
    e.dbus += r.dbus;
    e.cost += r.cost;
    rollup.set(key, e);
  }
  const rollupRows = [...rollup.values()].sort((a, b) => b.cost - a.cost);
  const serverlessCost = deskDetail.filter((r) => r.is_serverless === true).reduce((s, r) => s + r.cost, 0);
  const classicCost = deskDetail.filter((r) => r.is_serverless === false).reduce((s, r) => s + r.cost, 0);
  const warehouseCost = deskDetail.filter((r) => r.is_serverless == null).reduce((s, r) => s + r.cost, 0);

  const byCategory = new Map<string, typeof deskDetail>();
  for (const r of deskDetail) {
    byCategory.set(r.usage_category, [...(byCategory.get(r.usage_category) ?? []), r]);
  }
  const categories = [...byCategory.entries()]
    .map(([cat, rows]) => ({
      cat,
      rows: rows.slice().sort((a, b) => b.cost - a.cost),
      cost: rows.reduce((s, r) => s + r.cost, 0),
      dbus: rows.reduce((s, r) => s + r.dbus, 0),
    }))
    .sort((a, b) => b.cost - a.cost);

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
      <PageTitle
        title={`Desk: ${desk}`}
        subtitle={`${fmtMonth(month)} — live figures`}
        info={PAGE_HELP.deskDetail}
      >
        <MonthModePicker
          months={months}
          publishedMonths={publishedMonths}
          month={month}
          mode="live"
          showModeToggle={false}
        />
      </PageTitle>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Cost this month"
          value={fmtMoney(monthTotal)}
          info={KPI_HELP.deskMonthCost}
        />
        <KpiTile
          label="MoM change"
          {...momKpi(
            monthTotal,
            prevPoint?.total_cost ?? null,
            prevPoint ? fmtMonth(prevPoint.billing_month) : "prior month",
          )}
          info={KPI_HELP.deskMomChange}
        />
        <KpiTile
          label="TAG coverage"
          value={score ? fmtPct(score.tag_pct) : "—"}
          tone={score && score.tag_pct >= 0.7 ? "good" : "warn"}
          hint="this desk's tagging discipline"
          info={KPI_HELP.deskTagCoverage}
        />
        <KpiTile
          label="Unattributed (NONE)"
          value={score ? fmtMoney(score.none_cost) : "—"}
          tone={score && score.none_cost > 0 ? "warn" : "good"}
          info={KPI_HELP.deskNoneCost}
          infoAlign="end"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cost trend (12 months)</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Published invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {invoiceHistory.length === 0 ? (
              <EmptyState message="No published invoices for this desk yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>
                      <span className="sr-only">Statement</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoiceHistory.map((h) => (
                    <TableRow key={h.month}>
                      <TableCell>{fmtMonth(h.month)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMoneyExact(h.total!)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/invoices/${encodeURIComponent(desk)}?month=${h.month}`}
                          className="text-indigo-600 hover:underline"
                        >
                          Statement →
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Products billed to this desk — {fmtMonth(month)}</CardTitle>
          </CardHeader>
          <CardContent>
            {productRows.length === 0 ? (
              <EmptyState message="No cost for this desk in the selected month." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead className="text-right">DBUs</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Share of desk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productRows.map((p) => (
                    <TableRow key={p.data_product}>
                      <TableCell>
                        <Link
                          className="text-indigo-600 hover:underline"
                          href={`/drill?month=${month}&mode=live&domain=${encodeURIComponent(p.data_domain)}&product=${encodeURIComponent(p.data_product)}`}
                        >
                          {p.data_product}
                        </Link>
                      </TableCell>
                      <TableCell>{p.data_domain}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtDbu(p.dbus)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(p.cost)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {monthTotal > 0 ? fmtPct(p.cost / monthTotal) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>How this number was built — usage category × compute</CardTitle>
            <CardDescription>
              {detailTotal > 0 ? (
                <>
                  Serverless {fmtMoney(serverlessCost)} ({fmtPct(serverlessCost / detailTotal)}) ·
                  classic {fmtMoney(classicCost)} ({fmtPct(classicCost / detailTotal)}) · SQL
                  warehouse (allocated per query) {fmtMoney(warehouseCost)} (
                  {fmtPct(warehouseCost / detailTotal)})
                </>
              ) : (
                "No cost_fact rows for this desk in the selected month."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rollupRows.length === 0 ? (
              <EmptyState message="Nothing to break down for the selected month." />
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <BarList
                  items={rollupRows.map((r) => ({
                    label: `${r.usage_category} · ${computeLabel(r.is_serverless)}`,
                    value: r.cost,
                    color:
                      r.is_serverless == null ? "#0284c7" : r.is_serverless ? "#7c3aed" : "#64748b",
                  }))}
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Compute</TableHead>
                      <TableHead className="text-right">DBUs</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rollupRows.map((r) => (
                      <TableRow key={`${r.usage_category}|${r.is_serverless}`}>
                        <TableCell>{r.usage_category}</TableCell>
                        <TableCell>
                          <ComputeChip isServerless={r.is_serverless} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtDbu(r.dbus)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(r.cost)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {detailTotal > 0 ? fmtPct(r.cost / detailTotal) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              Line-item construction (live cost_fact
              {deskDetail.length === 500 ? ", top 500 slices" : ""})
            </CardTitle>
            <CardDescription>
              Every billing slice that landed on this desk — category → product → job or warehouse
              → runner — with the attribution rule that routed it here. Lines sum to{" "}
              {fmtMoney(detailTotal)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {deskDetail.length === 0 ? (
              <EmptyState message="No cost_fact rows for this desk in the selected month." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Job / warehouse</TableHead>
                    <TableHead>Runner</TableHead>
                    <TableHead>Compute</TableHead>
                    <TableHead>Attribution</TableHead>
                    <TableHead className="text-right">DBUs</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Share of desk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((c) => (
                    <Fragment key={c.cat}>
                      <TableRow className="bg-muted/50">
                        <TableCell colSpan={5} className="font-medium">
                          {c.cat}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {fmtDbu(c.dbus)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {fmtMoney(c.cost)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {detailTotal > 0 ? fmtPct(c.cost / detailTotal) : "—"}
                        </TableCell>
                      </TableRow>
                      {c.rows.map((r, i) => {
                        const domain = products.get(r.data_product)?.data_domain;
                        return (
                          <TableRow key={`${c.cat}-${i}`}>
                            <TableCell>
                              {domain ? (
                                <Link
                                  className="text-indigo-600 hover:underline"
                                  href={`/drill?month=${month}&mode=live&domain=${encodeURIComponent(domain)}&product=${encodeURIComponent(r.data_product)}`}
                                >
                                  {r.data_product}
                                </Link>
                              ) : (
                                r.data_product
                              )}
                            </TableCell>
                            <TableCell>{r.job_name ?? r.warehouse_id ?? "—"}</TableCell>
                            <TableCell>{r.runner_name ?? "—"}</TableCell>
                            <TableCell>
                              <ComputeChip isServerless={r.is_serverless} />
                            </TableCell>
                            <TableCell>
                              <MethodBadge method={r.attribution_method} />
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtDbu(r.dbus)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtMoney(r.cost)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {detailTotal > 0 ? fmtPct(r.cost / detailTotal) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ReportFooter />
    </div>
  );
}
