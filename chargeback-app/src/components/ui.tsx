import clsx from "clsx";
import type { AttributionMethod } from "@/dal/types";

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={clsx("card", className)}>{children}</div>;
}

export function PageTitle({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={clsx("mt-1 text-2xl font-semibold", {
          "text-slate-900": tone === "default",
          "text-emerald-600": tone === "good",
          "text-red-600": tone === "bad",
          "text-amber-600": tone === "warn",
        })}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export const METHOD_STYLE: Record<AttributionMethod, { color: string; chip: string }> = {
  TAG: { color: "#059669", chip: "bg-emerald-100 text-emerald-800" },
  JOB_MAPPING: { color: "#d97706", chip: "bg-amber-100 text-amber-800" },
  WAREHOUSE_MAPPING: { color: "#0284c7", chip: "bg-sky-100 text-sky-800" },
  USER: { color: "#4f46e5", chip: "bg-indigo-100 text-indigo-800" },
  NONE: { color: "#dc2626", chip: "bg-red-100 text-red-800" },
};

export function MethodBadge({ method }: { method: string }) {
  const style = METHOD_STYLE[method as AttributionMethod] ?? {
    chip: "bg-slate-100 text-slate-700",
  };
  return (
    <span className={clsx("rounded px-1.5 py-0.5 text-xs font-medium", style.chip)}>
      {method}
    </span>
  );
}

export function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800",
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-red-500")} />
      {label}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </p>
  );
}

/** Deterministic color per dimension value (domains, desks). */
const PALETTE = [
  "#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626",
  "#7c3aed", "#db2777", "#65a30d", "#475569",
];
export function colorFor(value: string, specials: Record<string, string> = {}): string {
  if (specials[value]) return specials[value];
  let h = 0;
  for (const c of value) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export const DOMAIN_SPECIALS = { UNALLOCATED: "#94a3b8" };
