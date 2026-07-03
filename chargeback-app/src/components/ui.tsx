import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AttributionMethod } from "@/dal/types";

/**
 * CSS-only info tooltip (hover / keyboard focus) — server-renderable, no
 * client JS, hidden in print. The trigger is a focusable span rather than a
 * button so a tooltip can sit inside a Link (e.g. the dashboard's clickable
 * KPI tile) without nesting interactive elements.
 * `align` picks the edge the panel grows from so it stays on screen.
 */
export function InfoTip({
  children,
  align = "start",
}: {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
}) {
  return (
    <span className="no-print group/tip relative inline-flex align-middle">
      <span
        tabIndex={0}
        aria-label="What is this and how is it calculated?"
        className="inline-flex size-4 cursor-help items-center justify-center rounded-full text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Info className="size-3.5" aria-hidden />
      </span>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none invisible absolute top-full z-50 mt-1.5 w-64 rounded-lg border bg-popover p-3 text-left font-sans text-xs font-normal normal-case leading-relaxed tracking-normal text-pretty text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150",
          "group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100",
          {
            "left-0": align === "start",
            "left-1/2 -translate-x-1/2": align === "center",
            "right-0": align === "end",
          },
        )}
      >
        {children}
      </span>
    </span>
  );
}

export function PageTitle({
  title,
  subtitle,
  info,
  children,
}: {
  title: string;
  subtitle?: string;
  info?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex flex-wrap items-center gap-1.5 font-heading text-xl font-semibold">
          {title}
          {info && <InfoTip>{info}</InfoTip>}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  info,
  infoAlign,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  info?: React.ReactNode;
  /** Edge the tooltip grows from — use "end" for tiles in the last grid column. */
  infoAlign?: "start" | "center" | "end";
  tone?: "default" | "good" | "bad" | "warn";
}) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
          {info && <InfoTip align={infoAlign}>{info}</InfoTip>}
        </p>
        <p
          className={cn("mt-1 text-2xl font-semibold tabular-nums", {
            "text-foreground": tone === "default",
            "text-emerald-600": tone === "good",
            "text-destructive": tone === "bad",
            "text-amber-600": tone === "warn",
          })}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export const METHOD_STYLE: Record<AttributionMethod, { color: string; chip: string }> = {
  TAG: { color: "#059669", chip: "bg-emerald-100 text-emerald-800" },
  JOB_MAPPING: { color: "#d97706", chip: "bg-amber-100 text-amber-800" },
  TAG_RULE: { color: "#0d9488", chip: "bg-teal-100 text-teal-800" },
  WAREHOUSE_MAPPING: { color: "#0284c7", chip: "bg-sky-100 text-sky-800" },
  RUNNER_RULE: { color: "#9333ea", chip: "bg-purple-100 text-purple-800" },
  USER: { color: "#4f46e5", chip: "bg-indigo-100 text-indigo-800" },
  NONE: { color: "#dc2626", chip: "bg-red-100 text-red-800" },
};

export function MethodBadge({ method }: { method: string }) {
  const style = METHOD_STYLE[method as AttributionMethod] ?? {
    chip: "bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="secondary" className={style.chip}>
      {method}
    </Badge>
  );
}

/** Serverless vs classic compute, from cost_fact.is_serverless (null = per-query warehouse rows). */
export function ComputeChip({ isServerless }: { isServerless: boolean | null }) {
  if (isServerless == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <Badge
      variant="secondary"
      className={isServerless ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"}
    >
      {isServerless ? "SERVERLESS" : "CLASSIC"}
    </Badge>
  );
}

export function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge
      variant="secondary"
      className={ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}
    >
      <span className={cn("size-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-red-500")} />
      {label}
    </Badge>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
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
