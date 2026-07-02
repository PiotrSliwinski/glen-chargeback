"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fmtMonth } from "@/lib/format";
import type { ReportMode } from "@/dal/types";

/**
 * Month selector + live/published toggle. State lives in the URL so every
 * view is linkable (?month=2026-06&mode=published).
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

  function navigate(next: { month?: string; mode?: ReportMode }) {
    const q = new URLSearchParams(params.toString());
    q.set("month", next.month ?? month);
    q.set("mode", next.mode ?? mode);
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <select
        value={month}
        onChange={(e) => navigate({ month: e.target.value })}
        className="input w-auto"
        aria-label="Billing month"
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {fmtMonth(m)}
            {publishedMonths.includes(m) ? " ✓ published" : ""}
          </option>
        ))}
      </select>
      {showModeToggle && (
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5">
          {(["live", "published"] as const).map((m) => (
            <button
              key={m}
              onClick={() => navigate({ mode: m })}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                mode === m ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {m === "live" ? "Live" : "Published"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
