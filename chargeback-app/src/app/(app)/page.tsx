import Link from "next/link";
import { getDashboard } from "@/dal/reports";
import { fmtMoney, fmtMonth, fmtPct, momKpi, shiftMonth } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { getSession } from "@/lib/auth";
import { atLeast } from "@/lib/rbac";
import { EmptyState, KpiTile, PageTitle } from "@/components/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList, CoverageBar, StackedTrend, TrendHint } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ReportFooter } from "@/components/report-footer";
import { ModeBanner } from "@/components/mode-banner";
import { DashboardSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";

export default function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense searchParams={searchParams} fallback={<DashboardSkeleton />}>
      <Dashboard searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const { month, mode, months, publishedMonths } = await resolveReportParams(searchParams);
  const [data, session] = await Promise.all([getDashboard(month, mode), getSession()]);
  const isSteward = atLeast(session?.user.role ?? null, "steward");
  const notPublished = mode === "published" && !publishedMonths.includes(month);
  const mom = momKpi(data.totalCost, data.prevMonthCost, fmtMonth(shiftMonth(month, -1)));

  return (
    <div>
      <PageTitle
        title="Chargeback Dashboard"
        subtitle={`${fmtMonth(month)} — cost by domain, product and desk`}
        info={PAGE_HELP.dashboard}
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
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiTile label="Total cost" value={fmtMoney(data.totalCost)} info={KPI_HELP.totalCost} />
            <KpiTile
              label="MoM change"
              value={mom.value}
              hint={mom.hint}
              tone={mom.tone}
              info={KPI_HELP.momChange}
            />
            <KpiTile
              label="TAG coverage"
              value={fmtPct(data.tagCoveragePct)}
              hint="share of cost attributed by tags at source"
              tone={data.tagCoveragePct >= 0.7 ? "good" : "warn"}
              info={KPI_HELP.tagCoverage}
            />
            {isSteward ? (
              <Link href="/queue" className="block">
                <KpiTile
                  label="Unallocated cost"
                  value={fmtMoney(data.unallocatedCost)}
                  hint="unclaimed spend — click to open the work queue"
                  tone={data.unallocatedCost > 0 ? "bad" : "good"}
                  info={KPI_HELP.unallocatedCost}
                  infoAlign="end"
                />
              </Link>
            ) : (
              <KpiTile
                label="Unallocated cost"
                value={fmtMoney(data.unallocatedCost)}
                hint="spend nobody has claimed yet"
                tone={data.unallocatedCost > 0 ? "bad" : "good"}
                info={KPI_HELP.unallocatedCost}
                infoAlign="end"
              />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Cost by data domain (level 1)</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  items={data.byDomain.map((d) => ({
                    label: d.data_domain,
                    value: d.total_cost,
                  }))}
                  hrefFor={(domain) =>
                    `/drill?month=${month}&mode=${mode}&domain=${encodeURIComponent(domain)}`
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Monthly trend by domain</CardTitle>
              </CardHeader>
              <CardContent>
                <StackedTrend
                  points={data.trend.map((t) => ({
                    billing_month: t.billing_month,
                    series: t.data_domain,
                    total_cost: t.total_cost,
                  }))}
                />
                <TrendHint month={month} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Attribution coverage — how cost got attributed this month</CardTitle>
              </CardHeader>
              <CardContent>
                <CoverageBar coverage={data.coverage} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Goal state: TAG rising; JOB_MAPPING and NONE shrinking. Mappings are a bridge — tags
                  at source are the destination.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <ReportFooter />
    </div>
  );
}
