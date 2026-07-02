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
export const fmtDbu = (v: number) => `${num.format(v)} DBU`;
export const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

export const fmtDelta = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${usd.format(v)}`;

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

/** Current month key 'YYYY-MM' minus n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
