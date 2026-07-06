"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RouteLoadingOverlay } from "@/components/route-loading";
import { fmtMonth } from "@/lib/format";
import type { ReportMode } from "@/dal/types";

/**
 * Month selector + live/published toggle. State lives in the URL so every
 * view is linkable (?month=2026-06&mode=published).
 *
 * Databricks re-queries can take seconds, so the navigation runs in a
 * transition: while pending, RouteLoadingOverlay dims the stale page and
 * shows a top-center status pill naming what's being loaded.
 */
export function MonthModePicker({
  months,
  publishedMonths,
  month,
  mode,
  showModeToggle = true,
}: {
  months: string[];
  publishedMonths: string[];
  month: string;
  mode: ReportMode;
  showModeToggle?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState("Loading data from Databricks…");

  function navigate(next: { month?: string; mode?: ReportMode }) {
    const q = new URLSearchParams(params.toString());
    q.set("month", next.month ?? month);
    q.set("mode", next.mode ?? mode);
    setPendingLabel(
      next.month
        ? `Loading ${fmtMonth(next.month)}…`
        : `Switching to ${next.mode} data…`,
    );
    startTransition(() => router.push(`${pathname}?${q.toString()}`));
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {isPending && <RouteLoadingOverlay label={pendingLabel} />}
      <Select value={month} onValueChange={(m) => navigate({ month: m })}>
        <SelectTrigger aria-label="Billing month">
          {/* explicit children: the trigger shows just the month — the
              "✓ published" marker stays in the dropdown list only */}
          <SelectValue>{fmtMonth(month)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m} value={m}>
              {fmtMonth(m)}
              {publishedMonths.includes(m) && (
                <span className="text-xs text-muted-foreground">✓ published</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showModeToggle && (
        <Tabs value={mode} onValueChange={(m) => navigate({ mode: m as ReportMode })}>
          <TabsList>
            <TabsTrigger value="live">Live</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
    </div>
  );
}
