import Link from "next/link";
import {
  buildInsights,
  categoryEconomics,
  countToShare,
  deskKpis,
  getCostHistory,
  getCoverageTrend,
  getMonthlyTotals,
  getTaggingScorecard,
  productKpis,
} from "@/dal/analytics";
import { getDeskScorecard } from "@/dal/desks";
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
import { BarTrend, CoverageTrend, ShareBar, Sparkline } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ModeBanner } from "@/components/mode-banner";
import { ReportFooter } from "@/components/report-footer";
import { ReportSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";
import type { DeskKpiRow, Insight, ProductKpiRow } from "@/dal/analytics";
import type { ReportMode, SourceTaggingScore } from "@/dal/types";

export const metadata = { title: "Analytics" };

// Prototype: runtime prefetching — the router prefetches this page's dynamic
// content (default view) when its link is on screen, so navigation shows
// content with no server round trip.
export const unstable_instant = {
  prefetch: "runtime",
  samples: [{ searchParams: { month: null, mode: null } }],
};

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

/** Slices shown individually in the share bars; the tail is folded into "others". */
const SHARE_BAR_SLICES = 8;
const OTHERS_COLOR = "#cbd5e1";

async function Analytics({ searchParams }: { searchParams: SearchParams }) {
  const { month, mode, months, publishedMonths } = await resolveReportParams(searchParams);
  const notPublished = mode === "published" && !publishedMonths.includes(month);
  const prevMonth = shiftMonth(month, -1);

  const [
    curRows,
    prevRows,
    totals,
    coverageTrend,
    movers,
    productHistory,
    deskHistory,
    scorecard,
    sourceScorecard,
  ] = await Promise.all([
    getMonthlyRows(month, mode),
    getMonthlyRows(prevMonth, "live"),
    getMonthlyTotals(month),
    getCoverageTrend(month),
    getProductMovement(month, mode),
    getCostHistory(month, "data_product"),
    getCostHistory(month, "desk"),
    getDeskScorecard(month),
    getTaggingScorecard(month),
  ]);

  const products = productKpis(curRows, prevRows, productHistory);
  const desks = deskKpis(curRows, prevRows, deskHistory, scorecard);
  const categories = categoryEconomics(curRows, prevRows);
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
  const n80 = countToShare(products, 0.8);
  const topDesk = desks.find((d) => d.cost > 0) ?? null;
  const ratePoints = totals
    .filter((t) => t.total_dbus > 0)
    .map((t) => ({ month: t.billing_month, value: t.total_cost / t.total_dbus }));

  return (
    <div>
      <PageTitle
        title="Advanced analytics"
        subtitle={`${fmtMonth(month)} — cost drivers by product and desk, unit economics and movers`}
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
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              infoAlign="end"
            />
            <KpiTile
              label="Top-3 concentration"
              value={top3Share == null ? "—" : fmtPct(top3Share)}
              hint={products.length > 0 ? `led by ${products[0].data_product}` : "no cost this month"}
              tone={top3Share != null && top3Share > 0.75 ? "warn" : "default"}
              info={KPI_HELP.topConcentration}
            />
            <KpiTile
              label="Products to 80%"
              value={n80 == null ? "—" : `${n80} of ${products.length}`}
              hint="fewest products covering 80% of spend"
              tone={n80 != null && n80 <= 3 ? "warn" : "default"}
              info={KPI_HELP.productsTo80}
            />
            <KpiTile
              label="Top desk share"
              value={topDesk == null ? "—" : fmtPct(topDesk.share)}
              hint={topDesk == null ? "no cost this month" : `${topDesk.desk} — ${fmtMoney(topDesk.cost)}`}
              tone={topDesk != null && topDesk.share > 0.5 ? "warn" : "default"}
              info={KPI_HELP.topDeskShare}
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

          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Data products — cost drivers
                <InfoTip>{ANALYTICS_SECTION_HELP.productDrivers}</InfoTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {products.length === 0 ? (
                <EmptyState message="No cost this month." />
              ) : (
                <>
                  <ShareBar
                    items={shareBarItems(products.map((p) => ({ label: p.data_product, value: p.cost })))}
                    hrefFor={(label) =>
                      products.some((p) => p.data_product === label)
                        ? `/drill?month=${month}&mode=${mode}&product=${encodeURIComponent(label)}`
                        : undefined
                    }
                  />
                  <div className="mt-4">
                    <ProductDriversTable products={products} month={month} mode={mode} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Desks — cost drivers
                <InfoTip>{ANALYTICS_SECTION_HELP.deskDrivers}</InfoTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {desks.length === 0 ? (
                <EmptyState message="No cost this month." />
              ) : (
                <>
                  <ShareBar
                    items={shareBarItems(desks.map((d) => ({ label: d.desk, value: d.cost })))}
                    hrefFor={(label) =>
                      desks.some((d) => d.desk === label)
                        ? `/desks/${encodeURIComponent(label)}?month=${month}&mode=${mode}`
                        : undefined
                    }
                  />
                  <div className="mt-4">
                    <DeskDriversTable desks={desks} month={month} mode={mode} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
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
                  <BarTrend
                    points={ratePoints}
                    fmt={(v) => `${fmtMoneyExact(v)}/DBU`}
                    labelFmt={fmtMoneyExact}
                  />
                )}
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
                  Tagging scorecard — all sources
                  <InfoTip>{ANALYTICS_SECTION_HELP.sourceScorecard}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sourceScorecard.length === 0 ? (
                  <EmptyState message="No cost in this month on any source." />
                ) : (
                  <SourceScorecardTable rows={sourceScorecard} />
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  One standard, three sources — with per-source policy: jobs and Azure are
                  tag-first (tagged share should rise), AI serving and serverless warehouse
                  queries are user-first (a mapped runner&apos;s spend deliberately lands under
                  &quot;via rules&quot;; tags catch the userless remainder). AI is the
                  model-serving slice of Databricks — compared, never summed. Goal: unallocated
                  shrinking everywhere.
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
                      month={month}
                      mode={mode}
                    />
                    <MoversTable
                      title="Decreases"
                      movers={movers.filter((p) => p.delta_abs < 0).slice(0, 5)}
                      empty="No product shrank month-over-month."
                      month={month}
                      mode={mode}
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

const SOURCE_LABELS: Record<SourceTaggingScore["source"], string> = {
  DATABRICKS: "Databricks",
  AI: "AI (slice of Databricks)",
  AZURE: "Azure",
};

/** One row per spend source, the same tagged/rules/unallocated split for each. */
function SourceScorecardTable({ rows }: { rows: SourceTaggingScore[] }) {
  const pct = (part: number, total: number) => (total > 0 ? fmtPct(part / total) : "—");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Tagged at source</TableHead>
          <TableHead className="text-right">Via rules</TableHead>
          <TableHead className="text-right">Unallocated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.source}>
            <TableCell className="font-medium">{SOURCE_LABELS[r.source]}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(r.total_cost)}</TableCell>
            <TableCell className="text-right tabular-nums text-emerald-700">
              {pct(r.tag_cost, r.total_cost)}
              <span className="ml-1 text-xs text-muted-foreground">
                ({fmtMoney(r.tag_cost)})
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {pct(r.rule_cost, r.total_cost)}
            </TableCell>
            <TableCell
              className={cn("text-right tabular-nums", {
                "text-amber-700": r.unallocated_cost > 0,
              })}
            >
              {pct(r.unallocated_cost, r.total_cost)}
              <span className="ml-1 text-xs text-muted-foreground">
                ({fmtMoney(r.unallocated_cost)})
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Top slices individually, the tail folded into a single muted "others" slice. */
function shareBarItems(items: { label: string; value: number }[]) {
  const shown = items.slice(0, SHARE_BAR_SLICES);
  const rest = items.slice(SHARE_BAR_SLICES);
  const restTotal = rest.reduce((s, i) => s + i.value, 0);
  return restTotal > 0
    ? [...shown, { label: `${rest.length} others`, value: restTotal, color: OTHERS_COLOR }]
    : shown;
}

/** MoM movement cell: signed dollars plus %, colored by direction. */
function DeltaCell({ delta_abs, delta_pct }: { delta_abs: number | null; delta_pct: number | null }) {
  if (delta_abs == null) return <TableCell className="text-right tabular-nums">—</TableCell>;
  const pct = delta_pct == null ? (delta_abs > 0 ? "new" : null) : signedPct(delta_pct);
  return (
    <TableCell
      className={cn("text-right tabular-nums", {
        "text-amber-700": delta_abs > 0,
        "text-emerald-700": delta_abs < 0,
      })}
    >
      {fmtDelta(delta_abs)}
      {pct != null && <span className="ml-1 text-xs text-muted-foreground">({pct})</span>}
    </TableCell>
  );
}

const DRIVER_ROWS = 10;

function ProductDriversTable({
  products,
  month,
  mode,
}: {
  products: ProductKpiRow[];
  month: string;
  mode: ReportMode;
}) {
  const shown = products.slice(0, DRIVER_ROWS);
  const rest = products.slice(DRIVER_ROWS);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead>Domain</TableHead>
          <TableHead className="text-right">Desks</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">MoM Δ</TableHead>
          <TableHead className="text-right">Share</TableHead>
          <TableHead className="text-right">Cumulative</TableHead>
          <TableHead className="text-right">$/DBU</TableHead>
          <TableHead className="text-right">12-mo trend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.map((p) => (
          <TableRow key={p.data_product}>
            <TableCell className="font-medium">
              <Link
                href={`/drill?month=${month}&mode=${mode}&domain=${encodeURIComponent(p.data_domain)}&product=${encodeURIComponent(p.data_product)}`}
                className="hover:underline"
              >
                {p.data_product}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              <Link
                href={`/drill?month=${month}&mode=${mode}&domain=${encodeURIComponent(p.data_domain)}`}
                className="hover:underline"
              >
                {p.data_domain}
              </Link>
            </TableCell>
            <TableCell className="text-right tabular-nums">{p.desk_count}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(p.cost)}</TableCell>
            <DeltaCell delta_abs={p.delta_abs} delta_pct={p.delta_pct} />
            <TableCell className="text-right tabular-nums">{fmtPct(p.share)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtPct(p.cum_share)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {p.rate == null ? "—" : fmtMoneyExact(p.rate)}
            </TableCell>
            <TableCell className="text-right">
              <div className="inline-flex justify-end">
                <Sparkline points={p.trend} />
              </div>
            </TableCell>
          </TableRow>
        ))}
        {rest.length > 0 && (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={3}>
              {rest.length} more product{rest.length === 1 ? "" : "s"}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {fmtMoney(rest.reduce((s, p) => s + p.cost, 0))}
            </TableCell>
            <TableCell />
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {fmtPct(rest.reduce((s, p) => s + p.share, 0))}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">100.0%</TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function DeskDriversTable({
  desks,
  month,
  mode,
}: {
  desks: DeskKpiRow[];
  month: string;
  mode: ReportMode;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Desk</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">MoM Δ</TableHead>
          <TableHead className="text-right">Share</TableHead>
          <TableHead className="text-right">Δpp</TableHead>
          <TableHead>Top product</TableHead>
          <TableHead className="text-right">Products</TableHead>
          <TableHead className="text-right">TAG %</TableHead>
          <TableHead className="text-right">12-mo trend</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {desks.map((d) => (
          <TableRow key={d.desk}>
            <TableCell className="font-medium">
              <Link
                href={`/desks/${encodeURIComponent(d.desk)}?month=${month}&mode=${mode}`}
                className="hover:underline"
              >
                {d.desk}
              </Link>
            </TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(d.cost)}</TableCell>
            <DeltaCell delta_abs={d.delta_abs} delta_pct={d.delta_pct} />
            <TableCell className="text-right tabular-nums">{fmtPct(d.share)}</TableCell>
            <TableCell
              className={cn("text-right tabular-nums", {
                "text-amber-700": (d.delta_pp ?? 0) > 0.05,
                "text-emerald-700": (d.delta_pp ?? 0) < -0.05,
              })}
            >
              {d.delta_pp == null ? "—" : `${d.delta_pp >= 0 ? "+" : ""}${d.delta_pp.toFixed(1)}pp`}
            </TableCell>
            <TableCell>
              {d.top_product == null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  <Link
                    href={`/drill?month=${month}&mode=${mode}&product=${encodeURIComponent(d.top_product)}`}
                    className="hover:underline"
                  >
                    {d.top_product}
                  </Link>
                  {d.top_product_share != null && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({fmtPct(d.top_product_share)} of desk)
                    </span>
                  )}
                </>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{d.product_count}</TableCell>
            <TableCell
              className={cn("text-right tabular-nums", {
                "text-emerald-700": d.tag_pct != null && d.tag_pct >= 0.7,
                "text-amber-700": d.tag_pct != null && d.tag_pct < 0.7,
              })}
            >
              {d.tag_pct == null ? "—" : fmtPct(d.tag_pct)}
            </TableCell>
            <TableCell className="text-right">
              <div className="inline-flex justify-end">
                <Sparkline points={d.trend} />
              </div>
            </TableCell>
          </TableRow>
        ))}
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

function MoversTable({
  title,
  movers,
  empty,
  month,
  mode,
}: {
  title: string;
  movers: ProductMovementRow[];
  empty: string;
  month: string;
  mode: ReportMode;
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
                <TableCell className="font-medium">
                  <Link
                    href={`/drill?month=${month}&mode=${mode}&product=${encodeURIComponent(p.data_product)}`}
                    className="hover:underline"
                  >
                    {p.data_product}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <Link
                    href={`/desks/${encodeURIComponent(p.desk)}?month=${month}&mode=${mode}`}
                    className="hover:underline"
                  >
                    {p.desk}
                  </Link>
                </TableCell>
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
