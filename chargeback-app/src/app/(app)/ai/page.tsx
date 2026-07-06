import Link from "next/link";
import { getAiEndpointUsage, getAiTrend, isAiCategory } from "@/dal/ai";
import { categoryEconomics } from "@/dal/analytics";
import { getMonthlyRows } from "@/dal/reports";
import { fmtDbu, fmtMoney, fmtMoneyExact, fmtMonth, fmtPct, momKpi, shiftMonth } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { AI_SECTION_HELP, KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { cn } from "@/lib/utils";
import { EmptyState, InfoTip, KpiTile, MethodBadge, PageTitle } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StackedTrend } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ModeBanner } from "@/components/mode-banner";
import { ReportFooter } from "@/components/report-footer";
import { ReportSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";
import type { AiEndpointUsageRow } from "@/dal/types";

export const metadata = { title: "AI costs" };

export default function AiPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense
      searchParams={searchParams}
      fallback={<ReportSkeleton label="Computing AI costs from Databricks…" />}
    >
      <AiCosts searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

async function AiCosts({ searchParams }: { searchParams: SearchParams }) {
  const { month, mode, months, publishedMonths } = await resolveReportParams(searchParams);
  const notPublished = mode === "published" && !publishedMonths.includes(month);
  const prevMonth = shiftMonth(month, -1);

  const [curRows, prevRows, trend, endpoints] = await Promise.all([
    getMonthlyRows(month, mode),
    getMonthlyRows(prevMonth, "live"),
    getAiTrend(month),
    getAiEndpointUsage(month),
  ]);

  const aiRows = curRows.filter((r) => isAiCategory(r.usage_category));
  const prevAiRows = prevRows.filter((r) => isAiCategory(r.usage_category));
  const totalCost = curRows.reduce((s, r) => s + r.total_cost, 0);
  const aiCost = aiRows.reduce((s, r) => s + r.total_cost, 0);
  const prevAiCost = prevRows.length > 0 ? prevAiRows.reduce((s, r) => s + r.total_cost, 0) : null;
  const mom = momKpi(aiCost, prevAiCost, fmtMonth(prevMonth));

  const endpointCost = endpoints.reduce((s, r) => s + r.cost, 0);
  const batchCost = endpoints
    .filter((r) => r.serving_type === "BATCH_INFERENCE")
    .reduce((s, r) => s + r.cost, 0);
  const unallocatedAiCost = aiRows
    .filter((r) => r.data_product === "UNALLOCATED")
    .reduce((s, r) => s + r.total_cost, 0);

  // same unit-economics rollup as analytics, filtered to the AI categories
  const categories = categoryEconomics(curRows, prevRows).filter((c) =>
    isAiCategory(c.usage_category),
  );

  return (
    <div>
      <PageTitle
        title="AI costs"
        subtitle={`${fmtMonth(month)} — model serving (realtime + ai_query batch inference), vector search and other AI-native spend`}
        info={PAGE_HELP.ai}
      >
        <MonthModePicker
          months={months}
          publishedMonths={publishedMonths}
          month={month}
          mode={mode}
        />
      </PageTitle>

      <ModeBanner mode={mode} publishedMonth={publishedMonths.includes(month)} />

      {notPublished ? (
        <EmptyState
          message={`${fmtMonth(month)} has not been published yet — switch to Live, or publish it from the Health page.`}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiTile
              label="AI cost"
              value={fmtMoney(aiCost)}
              hint={totalCost > 0 ? `${fmtPct(aiCost / totalCost)} of the month's bill` : "no cost this month"}
              info={KPI_HELP.aiMonthCost}
            />
            <KpiTile label="MoM Δ" value={mom.value} hint={mom.hint} tone={mom.tone} info={KPI_HELP.aiMomChange} />
            <KpiTile
              label="Batch inference share"
              value={endpointCost > 0 ? fmtPct(batchCost / endpointCost) : "—"}
              hint="ai_query batch jobs vs realtime serving (live)"
              info={KPI_HELP.aiBatchShare}
            />
            <KpiTile
              label="Unallocated AI cost"
              value={fmtMoney(unallocatedAiCost)}
              hint={unallocatedAiCost > 0 ? "endpoints nobody has claimed yet" : "every AI dollar reached a desk"}
              tone={unallocatedAiCost > 0 ? "warn" : "good"}
              info={KPI_HELP.aiUnallocatedCost}
              infoAlign="end"
            />
          </div>

          <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Freshness: <code>system.billing.usage</code>{" "}
            lags real usage by roughly 1–2 hours (no official SLA) and the billing pipeline emits
            hourly aggregates before DBUs appear in the system tables — the current day&apos;s AI
            spend, batch <code>ai_query</code> runs included, is always incomplete. Closed months
            are unaffected.
          </p>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  AI cost by category
                  <InfoTip>{AI_SECTION_HELP.categories}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {categories.length === 0 ? (
                  <EmptyState message="No AI cost this month." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">DBUs</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">$/DBU</TableHead>
                        <TableHead className="text-right">Share of bill</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categories.map((c) => (
                        <TableRow key={c.usage_category}>
                          <TableCell className="font-medium">{c.usage_category}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtDbu(c.dbus)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(c.cost)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.rate == null ? "—" : fmtMoneyExact(c.rate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtPct(c.share)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  AI spend — trailing 12 months
                  <InfoTip>{AI_SECTION_HELP.trend}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trend.length === 0 ? (
                  <EmptyState message="No AI cost history yet." />
                ) : (
                  <StackedTrend
                    points={trend.map((t) => ({
                      billing_month: t.billing_month,
                      data_domain: t.usage_category,
                      total_cost: t.total_cost,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Serving endpoints
                <InfoTip>{AI_SECTION_HELP.endpoints}</InfoTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {endpoints.length === 0 ? (
                <EmptyState message="No AI usage recorded for this month." />
              ) : (
                <EndpointTable endpoints={endpoints} month={month} mode={mode} aiCost={endpointCost} />
              )}
              <p className="no-print mt-3 text-xs text-muted-foreground">
                Endpoint spend landing in UNALLOCATED? Tag the endpoint at source with{" "}
                <code>data_product</code>, or route it under{" "}
                <Link href="/admin/endpoints" className="font-medium text-indigo-600 hover:underline">
                  Reference data → Endpoints
                </Link>
                .{" "}
                <a
                  href={`/api/export/ai-endpoints?month=${month}&mode=${mode}`}
                  className="font-medium text-indigo-600 hover:underline"
                >
                  Download CSV
                </a>
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <ReportFooter />
    </div>
  );
}

/** Offering-type chip: batch ai_query jobs get their own hue; anything else renders verbatim. */
function ServingTypeChip({ type }: { type: string | null }) {
  if (type == null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge
      variant="secondary"
      className={
        type === "BATCH_INFERENCE" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"
      }
    >
      {type}
    </Badge>
  );
}

function EndpointTable({
  endpoints,
  month,
  mode,
  aiCost,
}: {
  endpoints: AiEndpointUsageRow[];
  month: string;
  mode: string;
  aiCost: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Endpoint</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Product</TableHead>
          <TableHead>Desk</TableHead>
          <TableHead>Attribution</TableHead>
          <TableHead className="text-right">DBUs</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Share of AI</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {endpoints.map((e, i) => (
          <TableRow key={i}>
            <TableCell className={cn("font-mono text-xs", e.endpoint_name == null && "text-muted-foreground")}>
              {e.endpoint_name ?? "(no endpoint)"}
            </TableCell>
            <TableCell>
              <ServingTypeChip type={e.serving_type} />
            </TableCell>
            <TableCell className="text-muted-foreground">{e.usage_category}</TableCell>
            <TableCell>
              {e.data_product === "UNALLOCATED" ? (
                <span className="text-red-700">UNALLOCATED</span>
              ) : (
                <Link
                  href={`/drill?month=${month}&mode=${mode}&product=${encodeURIComponent(e.data_product)}`}
                  className="hover:underline"
                >
                  {e.data_product}
                </Link>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{e.desk}</TableCell>
            <TableCell>
              <MethodBadge method={e.attribution_method} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{fmtDbu(e.dbus)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(e.cost)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {aiCost > 0 ? fmtPct(e.cost / aiCost) : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
