import Link from "next/link";
import { Download } from "lucide-react";
import { getDashboard, getMonthlyRows } from "@/dal/reports";
import { buildCommentary, getDeskMovement, getProductMovement } from "@/dal/movement";
import { getDeskScorecard } from "@/dal/desks";
import { fmtDbu, fmtMoney, fmtMoneyExact, fmtMonth, fmtPct, momKpi } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { KPI_HELP, PAGE_HELP, REPORT_SECTION_HELP } from "@/lib/kpi-help";
import { getSession } from "@/lib/auth";
import { atLeast } from "@/lib/rbac";
import { EmptyState, InfoTip, KpiTile, PageTitle } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CoverageBar } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ModeBanner } from "@/components/mode-banner";
import { ReportFooter } from "@/components/report-footer";
import { PrintButton } from "@/components/print-button";
import { ReportSkeleton } from "@/components/loading-skeletons";
import { SearchParamsSuspense } from "@/components/keyed-suspense";

export const metadata = { title: "Monthly report" };

export const unstable_instant = {
  prefetch: "runtime",
  samples: [{ searchParams: { month: null, mode: null } }],
};

export default function ReportPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SearchParamsSuspense searchParams={searchParams} fallback={<ReportSkeleton />}>
      <Report searchParams={searchParams} />
    </SearchParamsSuspense>
  );
}

async function Report({ searchParams }: { searchParams: SearchParams }) {
  const { month, mode, months, publishedMonths } = await resolveReportParams(searchParams);
  const notPublished = mode === "published" && !publishedMonths.includes(month);

  const [dashboard, rows, deskMovement, productMovement, scorecard, session] = await Promise.all([
    getDashboard(month, mode),
    getMonthlyRows(month, mode),
    getDeskMovement(month, mode),
    getProductMovement(month, mode),
    getDeskScorecard(month),
    getSession(),
  ]);
  const isSteward = atLeast(session?.user.role ?? null, "steward");
  const commentary = buildCommentary(deskMovement, productMovement, fmtMoney);

  // domain → product → desk aggregation for the breakdown section
  const byKey = new Map<
    string,
    { data_domain: string; data_product: string; desk: string; cost: number; dbus: number }
  >();
  for (const r of rows) {
    const k = `${r.data_domain}|${r.data_product}|${r.desk}`;
    const e = byKey.get(k) ?? {
      data_domain: r.data_domain,
      data_product: r.data_product,
      desk: r.desk,
      cost: 0,
      dbus: 0,
    };
    e.cost += r.total_cost;
    e.dbus += r.total_dbus;
    byKey.set(k, e);
  }
  const domains = [...new Set([...byKey.values()].map((e) => e.data_domain))]
    .map((d) => ({
      domain: d,
      items: [...byKey.values()]
        .filter((e) => e.data_domain === d)
        .sort((a, b) => b.cost - a.cost),
    }))
    .map((g) => ({ ...g, total: g.items.reduce((s, e) => s + e.cost, 0) }))
    .sort((a, b) => b.total - a.total);

  const csvBase = `?month=${month}&mode=${mode}`;

  return (
    <div>
      <PageTitle
        title="Monthly chargeback report"
        subtitle={`${fmtMonth(month)} — full pack: summary, movement, breakdown, coverage`}
        info={PAGE_HELP.report}
      >
        <div className="no-print flex flex-wrap items-center gap-2">
          <MonthModePicker
            months={months}
            publishedMonths={publishedMonths}
            month={month}
            mode={mode}
          />
          <PrintButton />
        </div>
      </PageTitle>

      <ModeBanner mode={mode} publishedMonth={publishedMonths.includes(month)} />

      {notPublished ? (
        <EmptyState
          message={`${fmtMonth(month)} has not been published yet — switch to Live to preview, or publish it from the Health page first.`}
        />
      ) : (
        <>
          {/* ---- 1. Executive summary ---- */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              1 · Executive summary
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <KpiTile
                label="Total cost"
                value={fmtMoney(dashboard.totalCost)}
                info={KPI_HELP.totalCost}
              />
              <KpiTile
                label="MoM change"
                {...momKpi(dashboard.totalCost, dashboard.prevMonthCost, fmtMonth(monthBefore(month)))}
                info={KPI_HELP.momChange}
              />
              <KpiTile
                label="TAG coverage"
                value={fmtPct(dashboard.tagCoveragePct)}
                tone={dashboard.tagCoveragePct >= 0.7 ? "good" : "warn"}
                info={KPI_HELP.tagCoverage}
              />
              {isSteward ? (
                <Link href="/queue" className="block">
                  <KpiTile
                    label="Unallocated cost"
                    value={fmtMoney(dashboard.unallocatedCost)}
                    tone={dashboard.unallocatedCost > 0 ? "bad" : "good"}
                    hint="unclaimed spend — click to open the work queue"
                    info={KPI_HELP.unallocatedCost}
                    infoAlign="end"
                  />
                </Link>
              ) : (
                <KpiTile
                  label="Unallocated cost"
                  value={fmtMoney(dashboard.unallocatedCost)}
                  tone={dashboard.unallocatedCost > 0 ? "bad" : "good"}
                  hint="unclaimed spend — a real line item"
                  info={KPI_HELP.unallocatedCost}
                  infoAlign="end"
                />
              )}
            </div>
          </section>

          {/* ---- 2. Month-over-month movement ---- */}
          <section className="mb-6">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              2 · Month-over-month movement by desk
              <InfoTip>{REPORT_SECTION_HELP.movement}</InfoTip>
            </h2>
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Desk</TableHead>
                      <TableHead className="text-right">{fmtMonth(monthBefore(month))}</TableHead>
                      <TableHead className="text-right">{fmtMonth(month)}</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                      <TableHead className="text-right">Δ%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deskMovement.map((d) => (
                      <TableRow key={d.desk}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/desks/${encodeURIComponent(d.desk)}?month=${month}&mode=${mode}`}
                            className="hover:underline"
                          >
                            {d.desk}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.prev_cost == null ? "—" : fmtMoney(d.prev_cost)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(d.cost)}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            (d.delta_abs ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"
                          }`}
                        >
                          {d.delta_abs == null
                            ? "—"
                            : `${d.delta_abs >= 0 ? "+" : ""}${fmtMoney(d.delta_abs)}`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {d.delta_pct == null ? "—" : `${(d.delta_pct * 100).toFixed(1)}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {commentary.length > 0 && (
                  <div className="mt-4 rounded-lg bg-muted/50 p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Commentary
                    </p>
                    <ul className="space-y-0.5 text-sm text-foreground/80">
                      {commentary.map((c) => (
                        <li key={c.desk}>
                          <span className="font-medium">{c.desk}</span>: {c.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ---- 3. Breakdown ---- */}
          <section className="mb-6">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              3 · Cost breakdown — domain → product → desk
              <InfoTip>{REPORT_SECTION_HELP.breakdown}</InfoTip>
            </h2>
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain / product</TableHead>
                      <TableHead>Desk</TableHead>
                      <TableHead className="text-right">DBUs</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {domains.map((g) => (
                      <DomainGroup
                        key={g.domain}
                        group={g}
                        grandTotal={dashboard.totalCost}
                        month={month}
                        mode={mode}
                      />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* ---- 4. Attribution coverage ---- */}
          <section className="mb-6">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              4 · Attribution coverage
              <InfoTip>{REPORT_SECTION_HELP.coverage}</InfoTip>
            </h2>
            <Card>
              <CardContent>
                <CoverageBar coverage={dashboard.coverage} />
                <Table className="mt-4 max-w-lg">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.coverage
                      .slice()
                      .sort((a, b) => b.cost - a.cost)
                      .map((c) => (
                        <TableRow key={c.attribution_method}>
                          <TableCell>{c.attribution_method}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoneyExact(c.cost)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtPct(c.pct_of_month)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-xs text-muted-foreground">
                  Target: TAG rising, JOB_MAPPING and NONE shrinking (Methodology §6.3).
                </p>
              </CardContent>
            </Card>
          </section>

          {/* ---- 5. Tagging scorecard ---- */}
          <section className="mb-6">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              5 · Tagging scorecard by desk
              <InfoTip>{REPORT_SECTION_HELP.scorecard}</InfoTip>
            </h2>
            <Card>
              <CardContent>
                <Table className="max-w-2xl">
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Desk</TableHead>
                      <TableHead className="text-right">Total cost</TableHead>
                      <TableHead className="text-right">TAG %</TableHead>
                      <TableHead className="text-right">Unallocated (NONE)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scorecard.map((s, i) => (
                      <TableRow key={s.desk}>
                        <TableCell className="text-muted-foreground/70">{i + 1}</TableCell>
                        <TableCell className="font-medium">
                          <Link
                            href={`/desks/${encodeURIComponent(s.desk)}?month=${month}&mode=${mode}`}
                            className="hover:underline"
                          >
                            {s.desk}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(s.total_cost)}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            s.tag_pct >= 0.7 ? "text-emerald-700" : "text-amber-700"
                          }`}
                        >
                          {fmtPct(s.tag_pct)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{fmtMoney(s.none_cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-xs text-muted-foreground">
                  Live cost_fact figures. Tags at source are the destination (Methodology §8) — this
                  leaderboard is the adoption lever.
                </p>
              </CardContent>
            </Card>
          </section>

          {/* ---- Downloads ---- */}
          <section className="no-print mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Downloads (CSV)
            </h2>
            <Card>
              <CardContent className="flex flex-wrap gap-3">
                <Button asChild>
                  <a href={`/api/export/xlsx${csvBase}`}>
                    <Download aria-hidden /> Full report (XLSX workbook)
                  </a>
                </Button>
                {[
                  ["monthly-chargeback", "Full chargeback"],
                  ["movement", "Desk movement"],
                  ["movement-products", "Product movement"],
                  ["coverage", "Coverage"],
                  ["scorecard", "Scorecard"],
                ].map(([report, label]) => (
                  <Button key={report} asChild variant="outline">
                    <a href={`/api/export/${report}${csvBase}`}>
                      <Download aria-hidden /> {label}
                    </a>
                  </Button>
                ))}
                <Button asChild variant="outline">
                  <Link href={`/invoices?month=${month}`}>Desk invoices →</Link>
                </Button>
              </CardContent>
            </Card>
          </section>

          <ReportFooter />
        </>
      )}
    </div>
  );
}

function DomainGroup({
  group,
  grandTotal,
  month,
  mode,
}: {
  group: {
    domain: string;
    total: number;
    items: { data_product: string; desk: string; cost: number; dbus: number }[];
  };
  grandTotal: number;
  month: string;
  mode: string;
}) {
  return (
    <>
      <TableRow className="bg-muted/50">
        <TableCell className="font-semibold" colSpan={3}>
          <Link
            className="hover:underline"
            href={`/drill?month=${month}&mode=${mode}&domain=${encodeURIComponent(group.domain)}`}
          >
            {group.domain}
          </Link>
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{fmtMoney(group.total)}</TableCell>
        <TableCell className="text-right font-semibold tabular-nums">
          {grandTotal > 0 ? fmtPct(group.total / grandTotal) : "—"}
        </TableCell>
      </TableRow>
      {group.items.map((e) => (
        <TableRow key={`${e.data_product}|${e.desk}`}>
          <TableCell className="pl-8">
            <Link
              className="hover:underline"
              href={`/drill?month=${month}&mode=${mode}&domain=${encodeURIComponent(group.domain)}&product=${encodeURIComponent(e.data_product)}`}
            >
              {e.data_product}
            </Link>
          </TableCell>
          <TableCell>
            <Link
              className="hover:underline"
              href={`/desks/${encodeURIComponent(e.desk)}?month=${month}&mode=${mode}`}
            >
              {e.desk}
            </Link>
          </TableCell>
          <TableCell className="text-right tabular-nums">{fmtDbu(e.dbus)}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtMoney(e.cost)}</TableCell>
          <TableCell className="text-right tabular-nums">
            {grandTotal > 0 ? fmtPct(e.cost / grandTotal) : "—"}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function monthBefore(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}
