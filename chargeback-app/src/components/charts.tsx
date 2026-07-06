import { fmtMoney, fmtMonth, fmtPct } from "@/lib/format";
import { colorFor, DOMAIN_SPECIALS, METHOD_STYLE } from "@/components/ui";
import type { AttributionMethod, CoverageRow } from "@/dal/types";

/**
 * Server-rendered, dependency-free charts (plain divs) — enough for the
 * dashboard's bar/trend/coverage needs without a client charting bundle.
 */

export function BarList({
  items,
  hrefFor,
}: {
  items: { label: string; value: number; color?: string }[];
  hrefFor?: (label: string) => string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2">
      {items.map((i) => {
        const row = (
          <div className="grid grid-cols-[10rem_1fr_6rem] items-center gap-3">
            <span className="truncate text-sm text-foreground">{i.label}</span>
            <div className="h-5 rounded bg-muted">
              <div
                className="h-5 rounded"
                style={{
                  width: `${Math.max((i.value / max) * 100, 1)}%`,
                  backgroundColor: i.color ?? colorFor(i.label, DOMAIN_SPECIALS),
                }}
              />
            </div>
            <span className="text-right text-sm font-medium tabular-nums text-foreground">
              {fmtMoney(i.value)}
            </span>
          </div>
        );
        return hrefFor ? (
          <a key={i.label} href={hrefFor(i.label)} className="block rounded hover:bg-muted/50">
            {row}
          </a>
        ) : (
          <div key={i.label}>{row}</div>
        );
      })}
    </div>
  );
}

/**
 * Stacked monthly bars, one segment per `series` value — a domain on the
 * dashboard, a desk on the Azure screen, a usage category on the AI screen.
 */
export function StackedTrend({
  points,
}: {
  points: { billing_month: string; series: string; total_cost: number }[];
}) {
  const months = [...new Set(points.map((p) => p.billing_month))].sort();
  const series = [...new Set(points.map((p) => p.series))].sort();
  const totals = months.map((m) =>
    points.filter((p) => p.billing_month === m).reduce((s, p) => s + p.total_cost, 0),
  );
  const max = Math.max(...totals, 1);

  return (
    <div>
      <div className="flex h-40 items-end gap-2">
        {months.map((m, mi) => (
          <div key={m} className="group relative flex-1">
            <div
              className="flex w-full flex-col-reverse overflow-hidden rounded-t"
              style={{ height: `${(totals[mi] / max) * 160}px` }}
            >
              {series.map((d) => {
                const v =
                  points.find((p) => p.billing_month === m && p.series === d)?.total_cost ?? 0;
                if (v <= 0 || totals[mi] <= 0) return null;
                return (
                  <div
                    key={d}
                    style={{
                      height: `${(v / totals[mi]) * 100}%`,
                      backgroundColor: colorFor(d, DOMAIN_SPECIALS),
                    }}
                    title={`${d}: ${fmtMoney(v)}`}
                  />
                );
              })}
            </div>
            <div className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-xs text-background group-hover:block">
              {fmtMoney(totals[mi])}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {months.map((m) => (
          <span key={m} className="flex-1 text-center text-[10px] text-muted-foreground">
            {m.slice(5)}·{m.slice(2, 4)}
          </span>
        ))}
      </div>
      <Legend items={series.map((d) => ({ label: d, color: colorFor(d, DOMAIN_SPECIALS) }))} />
    </div>
  );
}

export function CoverageBar({ coverage }: { coverage: CoverageRow[] }) {
  const order: AttributionMethod[] = [
    "TAG",
    "JOB_MAPPING",
    "TAG_RULE",
    "WAREHOUSE_MAPPING",
    "ENDPOINT_MAPPING",
    "RUNNER_RULE",
    "USER",
    "NONE",
  ];
  const rows = order
    .map((m) => coverage.find((c) => c.attribution_method === m))
    .filter((c): c is CoverageRow => !!c && c.pct_of_month > 0);
  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded">
        {rows.map((c) => (
          <div
            key={c.attribution_method}
            style={{
              width: `${c.pct_of_month * 100}%`,
              backgroundColor: METHOD_STYLE[c.attribution_method].color,
            }}
            title={`${c.attribution_method}: ${fmtPct(c.pct_of_month)} (${fmtMoney(c.cost)})`}
          />
        ))}
      </div>
      <Legend
        items={rows.map((c) => ({
          label: `${c.attribution_method} ${fmtPct(c.pct_of_month)}`,
          color: METHOD_STYLE[c.attribution_method].color,
        }))}
      />
    </div>
  );
}

/** Single-series vertical bar trend, one bar per month (e.g. blended $/DBU). */
export function BarTrend({
  points,
  fmt,
  labelFmt,
}: {
  points: { month: string; value: number }[];
  fmt: (v: number) => string;
  /** Short always-visible per-bar label; values must be readable without hover. */
  labelFmt?: (v: number) => string;
}) {
  const max = Math.max(...points.map((p) => p.value), Number.EPSILON);
  const label = labelFmt ?? fmt;
  return (
    <div>
      <div className="flex h-36 items-end gap-2">
        {points.map((p) => (
          <div key={p.month} className="group relative flex-1" title={`${p.month}: ${fmt(p.value)}`}>
            <div className="mb-0.5 truncate text-center text-[10px] tabular-nums text-muted-foreground">
              {label(p.value)}
            </div>
            <div
              className="w-full rounded-t bg-indigo-600/80"
              style={{ height: `${Math.max((p.value / max) * 128, 2)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {points.map((p) => (
          <span key={p.month} className="flex-1 text-center text-[10px] text-muted-foreground">
            {p.month.slice(5)}·{p.month.slice(2, 4)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Tiny inline 12-month bar sparkline for table cells. */
export function Sparkline({
  points,
  fmt = fmtMoney,
}: {
  points: { month: string; value: number }[];
  fmt?: (v: number) => string;
}) {
  const max = Math.max(...points.map((p) => p.value), Number.EPSILON);
  return (
    <div className="flex h-6 w-24 items-end gap-px">
      {points.map((p) => (
        <div
          key={p.month}
          className={p.value > 0 ? "flex-1 rounded-[1px] bg-indigo-600/70" : "flex-1 rounded-[1px] bg-muted"}
          style={{ height: p.value > 0 ? `${Math.max((p.value / max) * 100, 8)}%` : "8%" }}
          title={`${p.month}: ${fmt(p.value)}`}
        />
      ))}
    </div>
  );
}

/** Horizontal 100%-stacked share bar — who owns the month's bill at a glance. */
export function ShareBar({
  items,
  specials = DOMAIN_SPECIALS,
}: {
  items: { label: string; value: number; color?: string }[];
  specials?: Record<string, string>;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const shown = items.filter((i) => i.value > 0);
  if (total <= 0 || shown.length === 0) return null;
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded">
        {shown.map((i) => (
          <div
            key={i.label}
            style={{
              width: `${(i.value / total) * 100}%`,
              backgroundColor: i.color ?? colorFor(i.label, specials),
            }}
            title={`${i.label}: ${fmtPct(i.value / total)} (${fmtMoney(i.value)})`}
          />
        ))}
      </div>
      <Legend
        items={shown.map((i) => ({
          label: `${i.label} ${fmtPct(i.value / total)}`,
          color: i.color ?? colorFor(i.label, specials),
        }))}
      />
    </div>
  );
}

/** One 100%-stacked attribution bar per month — is TAG rising, NONE shrinking? */
export function CoverageTrend({ rows }: { rows: CoverageRow[] }) {
  const months = [...new Set(rows.map((r) => r.billing_month))].sort();
  const order: AttributionMethod[] = [
    "TAG",
    "JOB_MAPPING",
    "TAG_RULE",
    "WAREHOUSE_MAPPING",
    "ENDPOINT_MAPPING",
    "RUNNER_RULE",
    "USER",
    "NONE",
  ];
  const present = order.filter((m) =>
    rows.some((r) => r.attribution_method === m && r.pct_of_month > 0),
  );
  return (
    <div>
      <div className="space-y-1.5">
        {months.map((m) => (
          <div key={m} className="grid grid-cols-[3.5rem_1fr] items-center gap-3">
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {m.slice(5)}·{m.slice(2, 4)}
            </span>
            <div className="flex h-4 w-full overflow-hidden rounded">
              {present.map((method) => {
                const c = rows.find(
                  (r) => r.billing_month === m && r.attribution_method === method,
                );
                if (!c || c.pct_of_month <= 0) return null;
                return (
                  <div
                    key={method}
                    style={{
                      width: `${c.pct_of_month * 100}%`,
                      backgroundColor: METHOD_STYLE[method].color,
                    }}
                    title={`${method}: ${fmtPct(c.pct_of_month)} (${fmtMoney(c.cost)})`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Legend
        items={present.map((m) => ({ label: m, color: METHOD_STYLE[m].color }))}
      />
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function TrendHint({ month }: { month: string }) {
  return (
    <p className="mt-2 text-xs text-muted-foreground">12-month trend up to {fmtMonth(month)}.</p>
  );
}
