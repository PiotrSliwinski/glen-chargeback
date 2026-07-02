import { Suspense } from "react";
import Link from "next/link";
import { getDashboard, getMonthlyRows } from "@/dal/reports";
import { buildCommentary, getDeskMovement, getProductMovement } from "@/dal/movement";
import { getDeskScorecard } from "@/dal/desks";
import { fmtDbu, fmtMoney, fmtMoneyExact, fmtMonth, fmtPct } from "@/lib/format";
import { resolveReportParams, type SearchParams } from "@/lib/report-params";
import { Card, EmptyState, KpiTile, PageTitle } from "@/components/ui";
import { CoverageBar } from "@/components/charts";
import { MonthModePicker } from "@/components/month-picker";
import { ModeBanner } from "@/components/mode-banner";
import { ReportFooter } from "@/components/report-footer";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Monthly report" };

export default function ReportPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Assembling report…</p>}>
      <Report searchParams={searchParams} />
    </Suspense>
  );
}

async function Report({ searchParams }: { searchParams: SearchParams }) {
  const { month, mode, months, publishedMonths } = await resolveReportParams(searchParams);
  const notPublished = mode === "published" && !publishedMonths.includes(month);

  const [dashboard, rows, deskMovement, productMovement, scorecard] = await Promise.all([
    getDashboard(month, mode),
    getMonthlyRows(month, mode),
    getDeskMovement(month, mode),
    getProductMovement(month, mode),
    getDeskScorecard(month),
  ]);
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
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              1 · Executive summary
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile label="Total cost" value={fmtMoney(dashboard.totalCost)} />
              <KpiTile
                label="MoM change"
                value={
                  dashboard.prevMonthCost == null
                    ? "—"
                    : `${dashboard.totalCost - dashboard.prevMonthCost >= 0 ? "+" : ""}${fmtMoney(dashboard.totalCost - dashboard.prevMonthCost)}`
                }
                hint={
                  dashboard.prevMonthCost
                    ? `${(((dashboard.totalCost - dashboard.prevMonthCost) / dashboard.prevMonthCost) * 100).toFixed(1)}% vs ${fmtMonth(monthBefore(month))}`
                    : undefined
                }
              />
              <KpiTile
                label="TAG coverage"
                value={fmtPct(dashboard.tagCoveragePct)}
                tone={dashboard.tagCoveragePct >= 0.7 ? "good" : "warn"}
              />
              <KpiTile
                label="Unallocated cost"
                value={fmtMoney(dashboard.unallocatedCost)}
                tone={dashboard.unallocatedCost > 0 ? "bad" : "good"}
                hint="unclaimed spend — a real line item"
              />
            </div>
          </section>

          {/* ---- 2. Month-over-month movement ---- */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              2 · Month-over-month movement by desk
            </h2>
            <Card>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Desk</th>
                    <th className="th text-right">{fmtMonth(monthBefore(month))}</th>
                    <th className="th text-right">{fmtMonth(month)}</th>
                    <th className="th text-right">Δ</th>
                    <th className="th text-right">Δ%</th>
                  </tr>
                </thead>
                <tbody>
                  {deskMovement.map((d) => (
                    <tr key={d.desk}>
                      <td className="td font-medium">{d.desk}</td>
                      <td className="td text-right tabular-nums">
                        {d.prev_cost == null ? "—" : fmtMoney(d.prev_cost)}
                      </td>
                      <td className="td text-right tabular-nums">{fmtMoney(d.cost)}</td>
                      <td
                        className={`td text-right tabular-nums ${
                          (d.delta_abs ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"
                        }`}
                      >
                        {d.delta_abs == null
                          ? "—"
                          : `${d.delta_abs >= 0 ? "+" : ""}${fmtMoney(d.delta_abs)}`}
                      </td>
                      <td className="td text-right tabular-nums">
                        {d.delta_pct == null ? "—" : `${(d.delta_pct * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {commentary.length > 0 && (
                <div className="mt-4 rounded-md bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Commentary
                  </p>
                  <ul className="space-y-0.5 text-sm text-slate-700">
                    {commentary.map((c) => (
                      <li key={c.desk}>
                        <span className="font-medium">{c.desk}</span>: {c.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </section>

          {/* ---- 3. Breakdown ---- */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              3 · Cost breakdown — domain → product → desk
            </h2>
            <Card>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Domain / product</th>
                    <th className="th">Desk</th>
                    <th className="th text-right">DBUs</th>
                    <th className="th text-right">Cost</th>
                    <th className="th text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((g) => (
                    <DomainGroup
                      key={g.domain}
                      group={g}
                      grandTotal={dashboard.totalCost}
                      month={month}
                      mode={mode}
                    />
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          {/* ---- 4. Attribution coverage ---- */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              4 · Attribution coverage
            </h2>
            <Card>
              <CoverageBar coverage={dashboard.coverage} />
              <table className="mt-4 w-full max-w-lg">
                <thead>
                  <tr>
                    <th className="th">Method</th>
                    <th className="th text-right">Cost</th>
                    <th className="th text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.coverage
                    .slice()
                    .sort((a, b) => b.cost - a.cost)
                    .map((c) => (
                      <tr key={c.attribution_method}>
                        <td className="td">{c.attribution_method}</td>
                        <td className="td text-right tabular-nums">{fmtMoneyExact(c.cost)}</td>
                        <td className="td text-right tabular-nums">{fmtPct(c.pct_of_month)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">
                Target: TAG rising, JOB_MAPPING and NONE shrinking (Methodology §6.3).
              </p>
            </Card>
          </section>

          {/* ---- 5. Tagging scorecard ---- */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              5 · Tagging scorecard by desk
            </h2>
            <Card>
              <table className="w-full max-w-2xl">
                <thead>
                  <tr>
                    <th className="th">#</th>
                    <th className="th">Desk</th>
                    <th className="th text-right">Total cost</th>
                    <th className="th text-right">TAG %</th>
                    <th className="th text-right">Unattributed (NONE)</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecard.map((s, i) => (
                    <tr key={s.desk}>
                      <td className="td text-slate-400">{i + 1}</td>
                      <td className="td font-medium">{s.desk}</td>
                      <td className="td text-right tabular-nums">{fmtMoney(s.total_cost)}</td>
                      <td
                        className={`td text-right tabular-nums ${
                          s.tag_pct >= 0.7 ? "text-emerald-700" : "text-amber-700"
                        }`}
                      >
                        {fmtPct(s.tag_pct)}
                      </td>
                      <td className="td text-right tabular-nums">{fmtMoney(s.none_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">
                Live cost_fact figures. Tags at source are the destination (Methodology §8) — this
                leaderboard is the adoption lever.
              </p>
            </Card>
          </section>

          {/* ---- Downloads ---- */}
          <section className="no-print mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Downloads (CSV)
            </h2>
            <Card className="flex flex-wrap gap-3">
              <a href={`/api/export/xlsx${csvBase}`} className="btn">
                ⬇ Full report (XLSX workbook)
              </a>
              {[
                ["monthly-chargeback", "Full chargeback"],
                ["movement", "Desk movement"],
                ["movement-products", "Product movement"],
                ["coverage", "Coverage"],
                ["scorecard", "Scorecard"],
              ].map(([report, label]) => (
                <a key={report} href={`/api/export/${report}${csvBase}`} className="btn-secondary">
                  ⬇ {label}
                </a>
              ))}
              <Link href={`/invoices?month=${month}`} className="btn-secondary">
                Desk invoices →
              </Link>
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
      <tr className="bg-slate-50">
        <td className="td font-semibold" colSpan={3}>
          <Link
            className="hover:underline"
            href={`/drill?month=${month}&mode=${mode}&domain=${encodeURIComponent(group.domain)}`}
          >
            {group.domain}
          </Link>
        </td>
        <td className="td text-right font-semibold tabular-nums">{fmtMoney(group.total)}</td>
        <td className="td text-right font-semibold tabular-nums">
          {grandTotal > 0 ? fmtPct(group.total / grandTotal) : "—"}
        </td>
      </tr>
      {group.items.map((e) => (
        <tr key={`${e.data_product}|${e.desk}`}>
          <td className="td pl-8">{e.data_product}</td>
          <td className="td">{e.desk}</td>
          <td className="td text-right tabular-nums">{fmtDbu(e.dbus)}</td>
          <td className="td text-right tabular-nums">{fmtMoney(e.cost)}</td>
          <td className="td text-right tabular-nums">
            {grandTotal > 0 ? fmtPct(e.cost / grandTotal) : "—"}
          </td>
        </tr>
      ))}
    </>
  );
}

function monthBefore(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}
