import {
  buildInsights,
  categoryEconomics,
  deskShareShift,
  getCoverageTrend,
  getMonthlyTotals,
  paretoProducts,
} from "@/dal/analytics";
import { getProductMovement, type ProductMovementRow } from "@/dal/movement";
import { getMonthlyRows } from "@/dal/reports";
import { fmtDbu, fmtDelta, fmtMoney, fmtMoneyExact, fmtMonth, fmtPct, shiftMonth } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { ANALYTICS_SECTION_HELP, KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { cn } from "@/lib/utils";
import { EmptyState, InfoTip, KpiTile, PageTitle } from "@/components/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarTrend, CoverageTrend } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ModeBanner } from "@/components/mode-banner";
import { ReportFooter } from "@/components/report-footer";
import { ReportSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";
import type { Insight } from "@/dal/analytics";

export const metadata = { title: "Analytics" };

export default function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense
      searchParams={searchParams}
      fallback={<ReportSkeleton label="Computing analytics from Databricks…" />}
    >
      <Analytics searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

const signedPct = (v: number) => `${v >= 0 ? "+" : ""}${fmtPct(v)}`;

async function Analytics({ searchParams }: { searchParams: SearchParams }) {
  const { month, mode, months, publishedMonths } = await resolveReportParams(searchParams);
  const notPublished = mode === "published" && !publishedMonths.includes(month);
  const prevMonth = shiftMonth(month, -1);

  const [curRows, prevRows, totals, coverageTrend, movers] = await Promise.all([
    getMonthlyRows(month, mode),
    getMonthlyRows(prevMonth, "live"),
    getMonthlyTotals(month),
    getCoverageTrend(month),
    getProductMovement(month, mode),
  ]);

  const products = paretoProducts(curRows);
  const categories = categoryEconomics(curRows, prevRows);
  const deskShares = deskShareShift(curRows, prevRows);
  const insights = buildInsights({
    month,
    totals,
    products,
    movers,
    coverage: coverageTrend,
    curRows,
    prevRows,
  });

  const cur = totals.find((t) => t.billing_month === month);
  const prev = totals.find((t) => t.billing_month === prevMonth);
  const threeAgo = totals.find((t) => t.billing_month === shiftMonth(month, -3));
  const rate = cur && cur.total_dbus > 0 ? cur.total_cost / cur.total_dbus : null;
  const prevRate = prev && prev.total_dbus > 0 ? prev.total_cost / prev.total_dbus : null;
  const rateChg = rate != null && prevRate != null ? rate / prevRate - 1 : null;
  const growth3 =
    cur && threeAgo && threeAgo.total_cost > 0 ? cur.total_cost / threeAgo.total_cost - 1 : null;
  const top3Share =
    products.length === 0 ? null : products[Math.min(2, products.length - 1)].cum_share;
  const ratePoints = totals
    .filter((t) => t.total_dbus > 0)
    .map((t) => ({ month: t.billing_month, value: t.total_cost / t.total_dbus }));

  return (
    <div>
      <PageTitle
        title="Advanced analytics"
        subtitle={`${fmtMonth(month)} — trajectory, unit economics, concentration and movers`}
        info={PAGE_HELP.analytics}
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
            <KpiTile
              label="Blended rate"
              value={rate == null ? "—" : `${fmtMoneyExact(rate)}/DBU`}
              hint={rateChg == null ? "no prior month to compare" : `${signedPct(rateChg)} vs ${fmtMonth(prevMonth)}`}
              tone={rateChg != null && rateChg > 0.02 ? "warn" : "default"}
              info={KPI_HELP.effectiveRate}
            />
            <KpiTile
              label="Annualized run rate"
              value={cur ? fmtMoney(cur.total_cost * 12) : "—"}
              hint={`if every month looked like ${fmtMonth(month)}`}
              info={KPI_HELP.runRate}
            />
            <KpiTile
              label="3-month growth"
              value={growth3 == null ? "—" : signedPct(growth3)}
              hint={growth3 == null ? "no data three months back" : `vs ${fmtMonth(shiftMonth(month, -3))}`}
              tone={growth3 != null && growth3 > 0 ? "warn" : "default"}
              info={KPI_HELP.threeMonthGrowth}
            />
            <KpiTile
              label="Top-3 concentration"
              value={top3Share == null ? "—" : fmtPct(top3Share)}
              hint={products.length > 0 ? `led by ${products[0].data_product}` : "no cost this month"}
              tone={top3Share != null && top3Share > 0.75 ? "warn" : "default"}
              info={KPI_HELP.topConcentration}
              infoAlign="end"
            />
          </div>

          {insights.length > 0 && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Key findings
                  <InfoTip>{ANALYTICS_SECTION_HELP.insights}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <InsightList insights={insights} />
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Cost concentration (Pareto)
                  <InfoTip>{ANALYTICS_SECTION_HELP.pareto}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ParetoTable products={products} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Unit economics by usage category
                  <InfoTip>{ANALYTICS_SECTION_HELP.categories}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CategoryTable categories={categories} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Blended $/DBU trend
                  <InfoTip>{ANALYTICS_SECTION_HELP.rateTrend}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ratePoints.length === 0 ? (
                  <EmptyState message="No DBU history to compute rates from." />
                ) : (
                  <BarTrend points={ratePoints} fmt={(v) => `${fmtMoneyExact(v)}/DBU`} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Desk share shift
                  <InfoTip>{ANALYTICS_SECTION_HELP.deskShares}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DeskShareTable
                  shares={deskShares}
                  month={month}
                  prevMonth={prevMonth}
                />
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Attribution mix — trailing 12 months
                  <InfoTip>{ANALYTICS_SECTION_HELP.coverageTrend}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CoverageTrend rows={coverageTrend} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Goal state: TAG widening; JOB_MAPPING and NONE shrinking.
                </p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  Biggest movers month-over-month
                  <InfoTip>{ANALYTICS_SECTION_HELP.movers}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {prevRows.length === 0 ? (
                  <EmptyState
                    message={`No data for ${fmtMonth(prevMonth)} — nothing to compare against.`}
                  />
                ) : (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <MoversTable
                      title="Increases"
                      movers={movers.filter((p) => p.delta_abs > 0).slice(0, 5)}
                      empty="No product grew month-over-month."
                    />
                    <MoversTable
                      title="Decreases"
                      movers={movers.filter((p) => p.delta_abs < 0).slice(0, 5)}
                      empty="No product shrank month-over-month."
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <ReportFooter />
    </div>
  );
}

function InsightList({ insights }: { insights: Insight[] }) {
  const dot: Record<Insight["tone"], string> = {
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    default: "bg-slate-400",
  };
  return (
    <ul className="space-y-2">
      {insights.map((i) => (
        <li key={i.text} className="flex gap-2.5 text-sm text-foreground/90">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot[i.tone])} aria-hidden />
          <span>{i.text}</span>
        </li>
      ))}
    </ul>
  );
}

const PARETO_ROWS = 8;

function ParetoTable({
  products,
}: {
  products: { data_product: string; data_domain: string; cost: number; share: number; cum_share: number }[];
}) {
  if (products.length === 0) return <EmptyState message="No cost this month." />;
  const shown = products.slice(0, PARETO_ROWS);
  const rest = products.slice(PARETO_ROWS);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead>Domain</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Share</TableHead>
          <TableHead className="text-right">Cumulative</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.map((p) => (
          <TableRow key={p.data_product}>
            <TableCell className="font-medium">{p.data_product}</TableCell>
            <TableCell className="text-muted-foreground">{p.data_domain}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(p.cost)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtPct(p.share)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtPct(p.cum_share)}</TableCell>
          </TableRow>
        ))}
        {rest.length > 0 && (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={2}>
              {rest.length} more product{rest.length === 1 ? "" : "s"}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {fmtMoney(rest.reduce((s, p) => s + p.cost, 0))}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {fmtPct(rest.reduce((s, p) => s + p.share, 0))}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">100.0%</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function CategoryTable({
  categories,
}: {
  categories: {
    usage_category: string;
    cost: number;
    dbus: number;
    share: number;
    rate: number | null;
    prev_rate: number | null;
  }[];
}) {
  if (categories.length === 0) return <EmptyState message="No cost this month." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">DBUs</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">$/DBU</TableHead>
          <TableHead className="text-right">Rate Δ%</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((c) => {
          const chg =
            c.rate != null && c.prev_rate != null && c.prev_rate > 0
              ? c.rate / c.prev_rate - 1
              : null;
          return (
            <TableRow key={c.usage_category}>
              <TableCell className="font-medium">{c.usage_category}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtDbu(c.dbus)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtMoney(c.cost)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {c.rate == null ? "—" : fmtMoneyExact(c.rate)}
              </TableCell>
              <TableCell
                className={cn("text-right tabular-nums", {
                  "text-amber-700": chg != null && chg > 0.005,
                  "text-emerald-700": chg != null && chg < -0.005,
                })}
              >
                {chg == null ? "—" : signedPct(chg)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function DeskShareTable({
  shares,
  month,
  prevMonth,
}: {
  shares: { desk: string; cost: number; share: number; prev_share: number | null; delta_pp: number | null }[];
  month: string;
  prevMonth: string;
}) {
  if (shares.length === 0) return <EmptyState message="No cost this month." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Desk</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">{fmtMonth(month)}</TableHead>
          <TableHead className="text-right">{fmtMonth(prevMonth)}</TableHead>
          <TableHead className="text-right">Δpp</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shares.map((s) => (
          <TableRow key={s.desk}>
            <TableCell className="font-medium">{s.desk}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(s.cost)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtPct(s.share)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {s.prev_share == null ? "—" : fmtPct(s.prev_share)}
            </TableCell>
            <TableCell
              className={cn("text-right tabular-nums", {
                "text-amber-700": (s.delta_pp ?? 0) > 0.05,
                "text-emerald-700": (s.delta_pp ?? 0) < -0.05,
              })}
            >
              {s.delta_pp == null ? "—" : `${s.delta_pp >= 0 ? "+" : ""}${s.delta_pp.toFixed(1)}pp`}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MoversTable({
  title,
  movers,
  empty,
}: {
  title: string;
  movers: ProductMovementRow[];
  empty: string;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {movers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Desk</TableHead>
              <TableHead className="text-right">Δ</TableHead>
              <TableHead className="text-right">Δ%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movers.map((p) => (
              <TableRow key={`${p.data_product}|${p.desk}`}>
                <TableCell className="font-medium">{p.data_product}</TableCell>
                <TableCell className="text-muted-foreground">{p.desk}</TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    p.delta_abs > 0 ? "text-amber-700" : "text-emerald-700",
                  )}
                >
                  {fmtDelta(p.delta_abs)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.prev_cost > 0 ? signedPct(p.cost / p.prev_cost - 1) : "new"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
