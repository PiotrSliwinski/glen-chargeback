"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { fmtMonth } from "@/lib/format";
import type { ReportMode } from "@/dal/types";

/**
 * Month selector + live/published toggle. State lives in the URL so every
 * view is linkable (?month=2026-06&mode=published).
 *
 * Databricks re-queries can take seconds, so the navigation runs in a
 * transition: while pending we show a spinner next to the picker and an
 * indeterminate progress bar pinned to the top of the viewport.
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

  function navigate(next: { month?: string; mode?: ReportMode }) {
    const q = new URLSearchParams(params.toString());
    q.set("month", next.month ?? month);
    q.set("mode", next.mode ?? mode);
    startTransition(() => router.push(`${pathname}?${q.toString()}`));
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {isPending && (
        <div
          role="progressbar"
          aria-label="Loading data from Databricks"
          className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/15"
        >
          <div className="h-full w-1/3 bg-primary [animation:route-progress_1.2s_ease-in-out_infinite]" />
        </div>
      )}
      <Loader2
        aria-hidden
        className={cn(
          "size-4 animate-spin text-muted-foreground transition-opacity",
          isPending ? "opacity-100" : "opacity-0",
        )}
      />
      <Select value={month} onValueChange={(m) => navigate({ month: m })}>
        <SelectTrigger aria-label="Billing month">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m} value={m}>
              {fmtMonth(m)}
              {publishedMonths.includes(m) ? " ✓ published" : ""}
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
