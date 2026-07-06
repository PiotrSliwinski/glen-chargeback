import Link from "next/link";
import {
  getAzureMethodMix,
  getAzureMonthResources,
  getAzureMonthlyRows,
  getAzureMonths,
  getAzureTrend,
} from "@/dal/azure";
import { fmtDelta, fmtInt, fmtMoney, fmtMonth, fmtPct, momKpi, shiftMonth } from "@/lib/format";
import { param, type SearchParams } from "@/lib/report-params";
import { AZURE_SECTION_HELP, KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { paginate } from "@/lib/paginate";
import { cn } from "@/lib/utils";
import {
  AZURE_METHOD_STYLE,
  AzureMethodBadge,
  EmptyState,
  FilteredCount,
  InfoTip,
  KpiTile,
  PageTitle,
} from "@/components/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShareBar, StackedTrend } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ReportFooter } from "@/components/report-footer";
import { ReportSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";
import { TableFilter } from "@/components/table-filter";
import { TablePagination } from "@/components/table-pagination";
import type { AzureAttributionMethod, AzureMonthlyRow } from "@/dal/types";

export const metadata = { title: "Azure costs" };

/** Waterfall order — the attribution-mix bar and its legend read top-down. */
const METHOD_ORDER: AzureAttributionMethod[] = [
  "TAG",
  "RESOURCE_MAPPING",
  "TAG_RULE",
  "RESOURCE_GROUP",
  "SUBSCRIPTION",
  "NONE",
];

export default function AzurePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense
      searchParams={searchParams}
      fallback={<ReportSkeleton label="Computing Azure costs from Databricks…" />}
    >
      <AzureCosts searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

async function AzureCosts({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const months = await getAzureMonths();

  if (months.length === 0) {
    return (
      <div>
        <PageTitle title="Azure costs" subtitle="No Azure cost data yet" info={PAGE_HELP.azureCosts} />
        <EmptyState message="azure_monthly_chargeback has no rows — check that the Azure cost export lands in azure_cleaned.amortized_costs." />
        <ReportFooter scope="azure" />
      </div>
    );
  }

  // month state lives in ?month= like every report; default = last closed month.
  // Azure never enters the published snapshot, so there is no mode toggle.
  const current = new Date().toISOString().slice(0, 7);
  const requested = param(sp.month);
  const month =
    requested && months.includes(requested)
      ? requested
      : (months.find((m) => m < current) ?? months[0]);
  const prevMonth = shiftMonth(month, -1);
  const q = (param(sp.q) ?? "").toLowerCase();

  const [curRows, prevRows, trend, methodMix, resources] = await Promise.all([
    getAzureMonthlyRows(month),
    getAzureMonthlyRows(prevMonth),
    getAzureTrend(month),
    getAzureMethodMix(month),
    getAzureMonthResources(month),
  ]);

  const total = curRows.reduce((s, r) => s + r.total_cost, 0);
  const prevTotal = prevRows.length > 0 ? prevRows.reduce((s, r) => s + r.total_cost, 0) : null;
  const mom = momKpi(total, prevTotal, fmtMonth(prevMonth));
  const unallocated = curRows
    .filter((r) => r.desk === "UNALLOCATED")
    .reduce((s, r) => s + r.total_cost, 0);
  const attributed = total - unallocated;

  // ---- rollups off the same monthly rows, so every card sums to the KPI tile
  const sumBy = (rows: AzureMonthlyRow[], key: (r: AzureMonthlyRow) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.total_cost);
    return m;
  };
  const byCategory = sumBy(curRows, (r) => r.usage_category);
  const prevByCategory = sumBy(prevRows, (r) => r.usage_category);
  const resourcesByCategory = new Map<string, number>();
  for (const r of curRows) {
    resourcesByCategory.set(
      r.usage_category,
      (resourcesByCategory.get(r.usage_category) ?? 0) + r.distinct_resources,
    );
  }
  const categoryRows = [...byCategory.entries()]
    .map(([category, cost]) => ({
      category,
      cost,
      resources: resourcesByCategory.get(category) ?? 0,
      delta: prevTotal == null ? null : cost - (prevByCategory.get(category) ?? 0),
      share: total > 0 ? cost / total : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  const byDesk = sumBy(curRows, (r) => r.desk);
  const prevByDesk = sumBy(prevRows, (r) => r.desk);
  const deskRows = [...byDesk.entries()]
    .map(([desk, cost]) => ({
      desk,
      cost,
      delta: prevTotal == null ? null : cost - (prevByDesk.get(desk) ?? 0),
      share: total > 0 ? cost / total : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  const byDomain = sumBy(curRows, (r) => r.data_domain);
  const prevByDomain = sumBy(prevRows, (r) => r.data_domain);
  const domainRows = [...byDomain.entries()]
    .map(([domain, cost]) => ({
      domain,
      cost,
      delta: prevTotal == null ? null : cost - (prevByDomain.get(domain) ?? 0),
      share: total > 0 ? cost / total : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  const mixItems = METHOD_ORDER.map((m) => ({
    label: m,
    value: methodMix.find((r) => r.attribution_method === m)?.cost ?? 0,
    color: AZURE_METHOD_STYLE[m].color,
  })).filter((i) => i.value > 0);

  const shownResources = resources.filter(
    (r) =>
      !q ||
      [
        r.resource_name ?? "",
        r.resource_id,
        r.subscription_id,
        r.resource_group ?? "",
        r.meter_category ?? "",
        r.attribution_method,
        r.data_product,
        r.desk,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  const { rows: pageResources, ...paged } = paginate(shownResources, param(sp.page));

  return (
    <div>
      <PageTitle
        title="Azure costs"
        subtitle={`${fmtMonth(month)} — the whole Azure bill (amortized cost), attributed to desks via the shared product catalogue where the waterfall matches`}
        info={PAGE_HELP.azureCosts}
      >
        <MonthModePicker
          months={months}
          publishedMonths={[]}
          month={month}
          mode="live"
          showModeToggle={false}
        />
      </PageTitle>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiTile
          label="Azure cost"
          value={fmtMoney(total)}
          hint="the whole bill — attributed or not"
          info={KPI_HELP.azureMonthCost}
        />
        <KpiTile label="MoM Δ" value={mom.value} hint={mom.hint} tone={mom.tone} info={KPI_HELP.azureMomChange} />
        <KpiTile
          label="Attributed to desks"
          value={total > 0 ? fmtPct(attributed / total) : "—"}
          hint={`${fmtMoney(attributed)} reached a desk`}
          info={KPI_HELP.azureAttributedShare}
        />
        <KpiTile
          label="Unallocated"
          value={fmtMoney(unallocated)}
          hint="unmatched remainder — never billed"
          info={KPI_HELP.azureMonthUnallocated}
          infoAlign="end"
        />
      </div>

      <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Freshness: Azure cost exports land in{" "}
        <code>azure_cleaned.amortized_costs</code> on a daily cadence, typically a day behind
        real usage — the current month is always partial. Azure Databricks meters lag a little
        further: the Databricks billing pipeline emits hourly aggregates roughly 1–2 hours
        behind usage (no official SLA) before Microsoft even picks them up, so the most recent
        day&apos;s Databricks charges settle last. This screen is monitoring only: Azure cost
        never enters the Databricks chargeback report or its published snapshots — desk
        statements show attributed Azure cost as a separate informational section, outside
        the invoiced total.
      </p>

      {total === 0 ? (
        <EmptyState message={`No Azure cost recorded for ${fmtMonth(month)}.`} />
      ) : (
        <>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Azure cost by meter category
                  <InfoTip>{AZURE_SECTION_HELP.categories}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Resources</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">MoM Δ</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryRows.map((c) => (
                      <TableRow key={c.category}>
                        <TableCell className="font-medium">{c.category}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtInt(c.resources)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(c.cost)}</TableCell>
                        <TableCell className="text-right">
                          <DeltaText delta={c.delta} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(c.share)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Azure spend — trailing 12 months
                  <InfoTip>{AZURE_SECTION_HELP.trend}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trend.length === 0 ? (
                  <EmptyState message="No Azure cost history yet." />
                ) : (
                  <StackedTrend
                    points={trend.map((t) => ({
                      billing_month: t.billing_month,
                      series: t.desk,
                      total_cost: t.total_cost,
                    }))}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Azure cost by data domain
                  <InfoTip>{AZURE_SECTION_HELP.domains}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data domain</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">MoM Δ</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {domainRows.map((d) => (
                      <TableRow key={d.domain}>
                        <TableCell
                          className={cn(
                            "font-medium",
                            d.domain === "UNALLOCATED" && "text-muted-foreground",
                          )}
                        >
                          {d.domain}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(d.cost)}</TableCell>
                        <TableCell className="text-right">
                          <DeltaText delta={d.delta} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(d.share)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Azure cost by desk
                  <InfoTip>{AZURE_SECTION_HELP.desks}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Desk</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">MoM Δ</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deskRows.map((d) => (
                      <TableRow key={d.desk}>
                        <TableCell
                          className={cn(
                            "font-medium",
                            d.desk === "UNALLOCATED" && "text-muted-foreground",
                          )}
                        >
                          {d.desk}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(d.cost)}</TableCell>
                        <TableCell className="text-right">
                          <DeltaText delta={d.delta} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtPct(d.share)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Attribution mix
                  <InfoTip>{AZURE_SECTION_HELP.methods}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ShareBar items={mixItems} />
                <p className="mt-3 text-xs text-muted-foreground">
                  Azure attribution is an allowlist: only cost matched by a tag at source or one
                  of the four rules reaches a desk. NONE is the unmatched remainder — expected
                  for shared platform infrastructure, never billed.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Resources behind the month&apos;s bill
                <InfoTip>{AZURE_SECTION_HELP.resources}</InfoTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="no-print mb-3 flex justify-end">
                <TableFilter placeholder="Filter by resource, RG, subscription, product, desk…" />
              </div>
              {shownResources.length === 0 ? (
                <EmptyState message="No resources match the current filter." />
              ) : (
                <>
                  {q && (
                    <FilteredCount shown={shownResources.length} total={resources.length} noun="row" />
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Resource</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead>Attribution</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Desk</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageResources.map((r) => (
                        <TableRow key={`${r.resource_id}|${r.attribution_method}|${r.data_product}|${r.desk}`}>
                          <TableCell title={r.resource_id}>
                            <p className="max-w-[220px] truncate text-sm font-medium">
                              {r.resource_name ?? "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">{r.meter_category ?? "—"}</p>
                          </TableCell>
                          <TableCell className="text-xs">
                            <p
                              className="max-w-32 truncate font-mono"
                              title={r.resource_group ?? undefined}
                            >
                              {r.resource_group ?? "—"}
                            </p>
                            <p
                              className="max-w-32 truncate font-mono text-muted-foreground"
                              title={r.subscription_id}
                            >
                              {r.subscription_id}
                            </p>
                          </TableCell>
                          <TableCell>
                            <AzureMethodBadge method={r.attribution_method} />
                          </TableCell>
                          <TableCell
                            className={cn(
                              "font-mono text-xs",
                              r.data_product === "UNALLOCATED" && "text-muted-foreground",
                            )}
                          >
                            {r.data_product}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-sm",
                              r.desk === "UNALLOCATED" && "text-muted-foreground",
                            )}
                          >
                            {r.desk}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(r.cost)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {total > 0 ? fmtPct(r.cost / total) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <TablePagination {...paged} noun="row" />
                </>
              )}
              <p className="no-print mt-3 text-xs text-muted-foreground">
                Unmatched cost that should reach a desk? Tag the resource at source with{" "}
                <code>data_product</code>, or add a rule under{" "}
                <Link href="/admin/azure" className="font-medium text-indigo-600 hover:underline">
                  Reference data → Azure attribution
                </Link>
                .{" "}
                <a
                  href={`/api/export/azure-resources?month=${month}&mode=live`}
                  className="font-medium text-indigo-600 hover:underline"
                >
                  Download CSV
                </a>
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <ReportFooter scope="azure" />
    </div>
  );
}

/** MoM movement: signed dollars colored by direction — same reading as the AI page. */
function DeltaText({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "text-sm tabular-nums",
        delta > 0 && "text-amber-700",
        delta < 0 && "text-emerald-700",
      )}
    >
      {fmtDelta(delta)}
    </span>
  );
}
