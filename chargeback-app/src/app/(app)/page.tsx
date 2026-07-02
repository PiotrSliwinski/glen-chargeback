import { Suspense } from "react";
import Link from "next/link";
import { getDashboard } from "@/dal/reports";
import { fmtMoney, fmtMonth, fmtPct } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { getSession } from "@/lib/auth";
import { atLeast } from "@/lib/rbac";
import { Card, EmptyState, KpiTile, PageTitle } from "@/components/ui";
import { BarList, CoverageBar, StackedTrend, TrendHint } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ReportFooter } from "@/components/report-footer";
import { ModeBanner } from "@/components/mode-banner";

export default function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading dashboard…</p>}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const { month, mode, months, publishedMonths } = await resolveReportParams(searchParams);
  const [data, session] = await Promise.all([getDashboard(month, mode), getSession()]);
  const isSteward = atLeast(session?.user.role ?? null, "steward");
  const notPublished = mode === "published" && !publishedMonths.includes(month);
  const delta =
    data.prevMonthCost == null ? null : data.totalCost - data.prevMonthCost;
  const deltaPct =
    data.prevMonthCost == null || data.prevMonthCost === 0
      ? null
      : data.totalCost / data.prevMonthCost - 1;

  return (
    <div>
      <PageTitle
        title="Chargeback Dashboard"
        subtitle={`${fmtMonth(month)} — cost by domain, product and desk`}
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
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile label="Total cost" value={fmtMoney(data.totalCost)} />
            <KpiTile
              label="MoM change"
              value={delta == null ? "—" : `${delta >= 0 ? "+" : ""}${fmtMoney(delta)}`}
              hint={deltaPct == null ? undefined : `${(deltaPct * 100).toFixed(1)}% vs prior month (live)`}
              tone={delta != null && delta > 0 ? "warn" : "default"}
            />
            <KpiTile
              label="TAG coverage"
              value={fmtPct(data.tagCoveragePct)}
              hint="share of cost attributed by tags at source"
              tone={data.tagCoveragePct >= 0.7 ? "good" : "warn"}
            />
            {isSteward ? (
              <Link href="/queue" className="block">
                <KpiTile
                  label="Unallocated cost"
                  value={fmtMoney(data.unallocatedCost)}
                  hint="unclaimed spend — click to open the work queue"
                  tone={data.unallocatedCost > 0 ? "bad" : "good"}
                />
              </Link>
            ) : (
              <KpiTile
                label="Unallocated cost"
                value={fmtMoney(data.unallocatedCost)}
                hint="spend nobody has claimed yet"
                tone={data.unallocatedCost > 0 ? "bad" : "good"}
              />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">
                Cost by data domain (level 1)
              </h2>
              <BarList
                items={data.byDomain.map((d) => ({
                  label: d.data_domain,
                  value: d.total_cost,
                }))}
                hrefFor={(domain) =>
                  `/drill?month=${month}&mode=${mode}&domain=${encodeURIComponent(domain)}`
                }
              />
            </Card>
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Monthly trend by domain</h2>
              <StackedTrend points={data.trend} />
              <TrendHint month={month} />
            </Card>
            <Card className="lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">
                Attribution coverage — how cost got attributed this month
              </h2>
              <CoverageBar coverage={data.coverage} />
              <p className="mt-2 text-xs text-slate-500">
                Goal state: TAG rising; JOB_MAPPING and NONE shrinking. Mappings are a bridge — tags
                at source are the destination.
              </p>
            </Card>
          </div>
        </>
      )}

      <ReportFooter />
    </div>
  );
}
