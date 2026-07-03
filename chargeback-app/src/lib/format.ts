const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const fmtMoney = (v: number) => usd.format(v);
export const fmtMoneyExact = (v: number) => usdCents.format(v);
export const fmtInt = (v: number) => num.format(v);
export const fmtDbu = (v: number) => `${num.format(v)} DBU`;
export const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

export const fmtDelta = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${usd.format(v)}`;

export const plural = (n: number, noun: string) => (n === 1 ? noun : `${noun}s`);

/**
 * Month-over-month KPI pieces, computed one way everywhere: signed value,
 * signed percent hint vs the named month, and an amber tone when spend rose.
 */
export function momKpi(current: number, prev: number | null, prevLabel: string) {
  const delta = prev == null ? null : current - prev;
  return {
    value: fmtDelta(delta),
    hint:
      delta == null || prev === 0
        ? "no prior month to compare"
        : `${delta >= 0 ? "+" : ""}${fmtPct(delta / (prev as number))} vs ${prevLabel}`,
    tone: (delta != null && delta > 0 ? "warn" : "default") as "warn" | "default",
  };
}

/** '2026-06-01' | '2026-06' → 'June 2026' */
export function fmtMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Normalize to the first-of-month DATE literal used in SQL params. */
export function monthStart(month: string): string {
  return month.length === 7 ? `${month}-01` : month.slice(0, 8) + "01";
}

/** First of next month, as the YYYY-MM-DD default for date inputs. */
export function firstOfNextMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
}

/** Current month key 'YYYY-MM' minus n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
