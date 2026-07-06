import Link from "next/link";
import { getAiEndpointUsage, getAiTrend, isAiCategory } from "@/dal/ai";
import { categoryEconomics } from "@/dal/analytics";
import { getMonthlyRows } from "@/dal/reports";
import { fmtDbu, fmtDelta, fmtMoney, fmtMoneyExact, fmtMonth, fmtPct, momKpi, shiftMonth } from "@/lib/format";
import { param, resolveReportParams, type SearchParams } from "@/lib/report-params";
import { AI_SECTION_HELP, KPI_HELP, PAGE_HELP } from "@/lib/kpi-help";
import { paginate } from "@/lib/paginate";
import { cn } from "@/lib/utils";
import { EmptyState, FilteredCount, InfoTip, KpiTile, MethodBadge, PageTitle, UnallocatedLabel } from "@/components/ui";
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
import { TableFilter } from "@/components/table-filter";
import { TablePagination } from "@/components/table-pagination";
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
  const sp = await searchParams;
  const q = (param(sp.q) ?? "").toLowerCase();
  const notPublished = mode === "published" && !publishedMonths.includes(month);
  const prevMonth = shiftMonth(month, -1);

  const [curRows, prevRows, trend, endpoints, prevEndpoints] = await Promise.all([
    getMonthlyRows(month, mode),
    getMonthlyRows(prevMonth, "live"),
    getAiTrend(month),
    getAiEndpointUsage(month),
    getAiEndpointUsage(prevMonth),
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

  // ---- AI cost per desk, with each desk's AI intensity (AI ÷ desk's whole bill)
  const sumBy = (rows: { desk: string; total_cost: number }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.desk, (m.get(r.desk) ?? 0) + r.total_cost);
    return m;
  };
  const deskBill = sumBy(curRows);
  const prevAiByDesk = sumBy(prevAiRows);
  const deskRows = [...sumBy(aiRows).entries()]
    .map(([desk, cost]) => ({
      desk,
      cost,
      delta: prevRows.length > 0 ? cost - (prevAiByDesk.get(desk) ?? 0) : null,
      aiShare: aiCost > 0 ? cost / aiCost : 0,
      billShare: (deskBill.get(desk) ?? 0) > 0 ? cost / deskBill.get(desk)! : null,
    }))
    .sort((a, b) => b.cost - a.cost);

  // ---- endpoint movement vs last month (live both sides, like every MoM figure).
  // Identity = workspace × endpoint × offering type × category; product/desk are
  // deliberately excluded so a re-mapped endpoint compares against itself.
  const idKey = (r: AiEndpointUsageRow) =>
    `${r.workspace_id}|${r.endpoint_name ?? ""}|${r.serving_type ?? ""}|${r.usage_category}`;
  const rollById = (rows: AiEndpointUsageRow[]) => {
    const m = new Map<string, { cost: number; rows: number; sample: AiEndpointUsageRow }>();
    for (const r of rows) {
      const e = m.get(idKey(r)) ?? { cost: 0, rows: 0, sample: r };
      e.cost += r.cost;
      e.rows += 1;
      m.set(idKey(r), e);
    }
    return m;
  };
  const curById = rollById(endpoints);
  const prevById = rollById(prevEndpoints);
  const endpointRows = endpoints.map((e) => {
    const prev = prevById.get(idKey(e));
    // a desk-split endpoint fans into several rows — a per-row Δ would double-count
    const ambiguous = (curById.get(idKey(e))?.rows ?? 1) > 1;
    return {
      ...e,
      delta: ambiguous ? null : e.cost - (prev?.cost ?? 0),
      isNew: !ambiguous && prev == null,
    };
  });
  // ---- who created the cost: AI spend per run-as identity, from the same
  // endpoint slices. Keyed by the raw runner id (stable across mapping edits);
  // labeled with the mapped name when there is one. MoM vs last month's live
  // rollup, same convention as every other Δ on the page.
  const byRunner = (rows: AiEndpointUsageRow[]) => {
    const m = new Map<
      string,
      { label: string; cost: number; dbus: number; endpoints: Set<string> }
    >();
    for (const r of rows) {
      const key = r.runner ?? "(no identity)";
      const e = m.get(key) ?? {
        label: r.runner_name ?? r.runner ?? "(no identity)",
        cost: 0,
        dbus: 0,
        endpoints: new Set<string>(),
      };
      e.cost += r.cost;
      e.dbus += r.dbus;
      e.endpoints.add(r.endpoint_name ?? `(no endpoint — ${r.usage_category})`);
      m.set(key, e);
    }
    return m;
  };
  const curByRunner = byRunner(endpoints);
  const prevByRunner = byRunner(prevEndpoints);
  const runnerRows = [...curByRunner.entries()]
    .map(([key, r]) => ({
      key,
      label: r.label,
      cost: r.cost,
      dbus: r.dbus,
      endpointCount: r.endpoints.size,
      delta: prevEndpoints.length > 0 ? r.cost - (prevByRunner.get(key)?.cost ?? 0) : null,
      share: endpointCost > 0 ? r.cost / endpointCost : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  // Every endpoint slice of the month, filterable — "used this month" means it
  // emitted billing usage. Filter first, then paginate what remains.
  const shownEndpoints = endpointRows.filter(
    (e) =>
      !q ||
      [
        e.endpoint_name ?? "(no endpoint)",
        e.serving_type ?? "",
        e.usage_category,
        e.runner ?? "",
        e.runner_name ?? "",
        e.workspace_name,
        e.data_product,
        e.desk,
        e.attribution_method,
        e.workspace_id,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  const { rows: pageEndpoints, ...endpointsPaged } = paginate(shownEndpoints, param(sp.page));

  const movers = [...new Set([...curById.keys(), ...prevById.keys()])]
    .map((k) => {
      const cur = curById.get(k);
      const prev = prevById.get(k);
      const sample = (cur ?? prev)!.sample;
      return {
        key: k,
        label: sample.endpoint_name ?? `(no endpoint — ${sample.usage_category})`,
        endpoint_name: sample.endpoint_name,
        serving_type: sample.serving_type,
        delta: (cur?.cost ?? 0) - (prev?.cost ?? 0),
        note: prev == null ? "new" : cur == null ? "gone" : null,
      };
    })
    .filter((m) => Math.abs(m.delta) >= 0.005)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

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
              tone={unallocatedAiCost > 0 ? "bad" : "good"}
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
                      series: t.usage_category,
                      total_cost: t.total_cost,
                    }))}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  AI cost by desk
                  <InfoTip>{AI_SECTION_HELP.desks}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {deskRows.length === 0 ? (
                  <EmptyState message="No AI cost this month." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Desk</TableHead>
                        <TableHead className="text-right">AI cost</TableHead>
                        <TableHead className="text-right">MoM Δ</TableHead>
                        <TableHead className="text-right">of AI spend</TableHead>
                        <TableHead className="text-right">of desk&apos;s bill</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deskRows.map((d) => (
                        <TableRow key={d.desk}>
                          <TableCell className="font-medium">
                            {d.desk === "UNALLOCATED" ? (
                              <UnallocatedLabel />
                            ) : (
                              <Link
                                href={`/desks/${encodeURIComponent(d.desk)}?month=${month}&mode=${mode}`}
                                className="hover:underline"
                              >
                                {d.desk}
                              </Link>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(d.cost)}</TableCell>
                          <TableCell className="text-right">
                            <DeltaText delta={d.delta} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtPct(d.aiShare)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {d.billShare == null ? "—" : fmtPct(d.billShare)}
                          </TableCell>
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
                  AI cost by run-as identity
                  <InfoTip>{AI_SECTION_HELP.runners}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {runnerRows.length === 0 ? (
                  <EmptyState message="No AI cost this month." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Run as</TableHead>
                        <TableHead className="text-right">Endpoints</TableHead>
                        <TableHead className="text-right">AI cost</TableHead>
                        <TableHead className="text-right">MoM Δ</TableHead>
                        <TableHead className="text-right">Share</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runnerRows.map((r) => (
                        <TableRow key={r.key}>
                          <TableCell
                            title={r.key}
                            className={cn(
                              "max-w-[180px] truncate text-sm font-medium",
                              // raw identity shown = unmapped runner — the one to chase
                              r.label === r.key && r.key !== "(no identity)" && "text-amber-700",
                            )}
                          >
                            {r.key === "(no identity)" ? (
                              r.label
                            ) : (
                              /* pivot: the endpoint table below, filtered to this identity */
                              <Link
                                href={`/ai?month=${month}&mode=${mode}&q=${encodeURIComponent(r.key)}`}
                                className="hover:underline"
                              >
                                {r.label}
                              </Link>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.endpointCount}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(r.cost)}</TableCell>
                          <TableCell className="text-right">
                            <DeltaText delta={r.delta} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fmtPct(r.share)}</TableCell>
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
                  Biggest endpoint moves
                  <InfoTip>{AI_SECTION_HELP.movers}</InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {movers.length === 0 ? (
                  <EmptyState message={`No endpoint movement vs ${fmtMonth(prevMonth)}.`} />
                ) : (
                  <ul className="space-y-2">
                    {movers.map((m) => (
                      <li key={m.key} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          {m.endpoint_name ? (
                            /* pivot: the endpoint table below, filtered to this endpoint */
                            <Link
                              href={`/ai?month=${month}&mode=${mode}&q=${encodeURIComponent(m.endpoint_name)}`}
                              className="truncate font-mono text-xs hover:underline"
                            >
                              {m.label}
                            </Link>
                          ) : (
                            <span className="truncate font-mono text-xs">{m.label}</span>
                          )}
                          {m.serving_type === "BATCH_INFERENCE" && (
                            <Badge variant="secondary" className="bg-violet-100 text-violet-800">
                              BATCH
                            </Badge>
                          )}
                        </span>
                        <DeltaText delta={m.delta} note={m.note} />
                      </li>
                    ))}
                  </ul>
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
              {endpointRows.length === 0 ? (
                <EmptyState message="No AI usage recorded for this month." />
              ) : (
                <>
                  <div className="no-print mb-3 flex justify-end">
                    <TableFilter placeholder="Filter by endpoint, run-as, type, category, product, desk…" />
                  </div>
                  {shownEndpoints.length === 0 ? (
                    <EmptyState message="No endpoints match the current filter." />
                  ) : (
                    <>
                      {q && (
                        <FilteredCount
                          shown={shownEndpoints.length}
                          total={endpointRows.length}
                          noun="row"
                        />
                      )}
                      <EndpointTable
                        endpoints={pageEndpoints}
                        month={month}
                        mode={mode}
                        aiCost={endpointCost}
                      />
                      <TablePagination {...endpointsPaged} noun="row" />
                    </>
                  )}
                  {endpointRows.length >= 500 && (
                    <p className="mt-2 text-xs text-amber-700">
                      Showing the month&apos;s top 500 cost slices — smaller endpoints may be
                      missing. The CSV export below carries the same cap.
                    </p>
                  )}
                </>
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

/** MoM movement: signed dollars colored by direction, optional "(new)"/"(gone)" note. */
function DeltaText({ delta, note }: { delta: number | null; note?: string | null }) {
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
      {note && <span className="ml-1 text-xs text-muted-foreground">({note})</span>}
    </span>
  );
}

/**
 * Day-of-month span the slice was active: "2–28" (single-day slices show one
 * number). Full dates on hover via the cell's title. Day precision is all
 * cost_fact has — billing usage is pre-aggregated, so there are no per-call
 * timestamps.
 */
function ActiveDays({ first, last }: { first: string; last: string }) {
  const f = Number(first.slice(8));
  const l = Number(last.slice(8));
  return <>{f === l ? f : `${f}–${l}`}</>;
}

/**
 * Offering-type chip: batch ai_query jobs get their own hue. The two known
 * offering types drop the _INFERENCE suffix to keep the table narrow (full
 * value on hover); anything else renders verbatim.
 */
function ServingTypeChip({ type }: { type: string | null }) {
  if (type == null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge
      variant="secondary"
      title={type}
      className={
        type === "BATCH_INFERENCE" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"
      }
    >
      {type.replace(/_INFERENCE$/, "")}
    </Badge>
  );
}

function EndpointTable({
  endpoints,
  month,
  mode,
  aiCost,
}: {
  endpoints: (AiEndpointUsageRow & { delta: number | null; isNew: boolean })[];
  month: string;
  mode: string;
  aiCost: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Endpoint / run as</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Workspace</TableHead>
          <TableHead>Product</TableHead>
          <TableHead>Desk</TableHead>
          <TableHead>Attribution</TableHead>
          <TableHead className="text-right">Active</TableHead>
          <TableHead className="text-right">DBUs</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">MoM Δ</TableHead>
          <TableHead className="text-right">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {endpoints.map((e, i) => (
          <TableRow key={i}>
            <TableCell className="max-w-[200px]">
              <p
                title={e.endpoint_name ?? undefined}
                className={cn(
                  "truncate font-mono text-xs",
                  e.endpoint_name == null && "text-muted-foreground",
                )}
              >
                {e.endpoint_name ?? "(no endpoint)"}
              </p>
              {/* run_as: mapped name, else the raw identity — unmapped runners
                  are exactly the ones worth chasing (map them and their
                  job-less serving spend bills to their desk via the USER rule) */}
              <p
                title={e.runner ?? undefined}
                className="truncate text-xs text-muted-foreground"
              >
                {e.runner_name ?? e.runner ?? "—"}
              </p>
            </TableCell>
            <TableCell>
              <ServingTypeChip type={e.serving_type} />
            </TableCell>
            <TableCell className="text-muted-foreground">{e.usage_category}</TableCell>
            <TableCell
              title={e.workspace_id}
              className={cn(
                "max-w-32 truncate text-sm",
                e.workspace_name.startsWith("UNMAPPED:")
                  ? "text-amber-700"
                  : "text-muted-foreground",
              )}
            >
              {e.workspace_name}
            </TableCell>
            <TableCell>
              {e.data_product === "UNALLOCATED" ? (
                <UnallocatedLabel />
              ) : (
                <Link
                  href={`/drill?month=${month}&mode=${mode}&product=${encodeURIComponent(e.data_product)}`}
                  className="hover:underline"
                >
                  {e.data_product}
                </Link>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {e.desk === "UNALLOCATED" ? (
                e.desk
              ) : (
                <Link
                  href={`/desks/${encodeURIComponent(e.desk)}?month=${month}&mode=${mode}`}
                  className="hover:underline"
                >
                  {e.desk}
                </Link>
              )}
            </TableCell>
            <TableCell>
              <MethodBadge method={e.attribution_method} />
            </TableCell>
            <TableCell
              className="text-right tabular-nums text-xs text-muted-foreground"
              title={`first ${e.first_seen}, last ${e.last_seen}`}
            >
              <ActiveDays first={e.first_seen} last={e.last_seen} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{fmtDbu(e.dbus)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(e.cost)}</TableCell>
            <TableCell className="text-right">
              <DeltaText delta={e.delta} note={e.isNew ? "new" : null} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {aiCost > 0 ? fmtPct(e.cost / aiCost) : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
