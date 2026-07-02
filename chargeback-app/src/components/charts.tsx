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
            <span className="truncate text-sm text-slate-700">{i.label}</span>
            <div className="h-5 rounded bg-slate-100">
              <div
                className="h-5 rounded"
                style={{
                  width: `${Math.max((i.value / max) * 100, 1)}%`,
                  backgroundColor: i.color ?? colorFor(i.label, DOMAIN_SPECIALS),
                }}
              />
            </div>
            <span className="text-right text-sm font-medium tabular-nums text-slate-900">
              {fmtMoney(i.value)}
            </span>
          </div>
        );
        return hrefFor ? (
          <a key={i.label} href={hrefFor(i.label)} className="block rounded hover:bg-slate-50">
            {row}
          </a>
        ) : (
          <div key={i.label}>{row}</div>
        );
      })}
    </div>
  );
}

export function StackedTrend({
  points,
}: {
  points: { billing_month: string; data_domain: string; total_cost: number }[];
}) {
  const months = [...new Set(points.map((p) => p.billing_month))].sort();
  const domains = [...new Set(points.map((p) => p.data_domain))].sort();
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
              {domains.map((d) => {
                const v =
                  points.find((p) => p.billing_month === m && p.data_domain === d)?.total_cost ?? 0;
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
            <div className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-xs text-white group-hover:block">
              {fmtMoney(totals[mi])}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {months.map((m) => (
          <span key={m} className="flex-1 text-center text-[10px] text-slate-500">
            {m.slice(5)}·{m.slice(2, 4)}
          </span>
        ))}
      </div>
      <Legend items={domains.map((d) => ({ label: d, color: colorFor(d, DOMAIN_SPECIALS) }))} />
    </div>
  );
}

export function CoverageBar({ coverage }: { coverage: CoverageRow[] }) {
  const order: AttributionMethod[] = ["TAG", "JOB_MAPPING", "WAREHOUSE_MAPPING", "USER", "NONE"];
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

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function TrendHint({ month }: { month: string }) {
  return (
    <p className="mt-2 text-xs text-slate-500">12-month trend up to {fmtMonth(month)}.</p>
  );
}
