"use client";

import { Loader2 } from "lucide-react";

/**
 * Full-viewport pending state for slow route transitions (Databricks
 * re-queries take seconds). Three layers, all fixed so nothing shifts:
 *
 * - a hairline indeterminate bar pinned to the top of the viewport,
 * - a soft scrim marking the still-visible content as stale
 *   (pointer-events-none: the user can keep interacting, e.g. pick a
 *   different month mid-flight),
 * - a top-center status pill with a spinner and a contextual label —
 *   the primary cue, placed where the eye already is after using the
 *   header controls.
 *
 * Scrim and pill animate in after a 150ms delay so fast transitions
 * never flash a loader; reduced-motion gets a plain fade.
 */
export function RouteLoadingOverlay({ label }: { label: string }) {
  return (
    <>
      <div
        role="progressbar"
        aria-label={label}
        className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/15"
      >
        <div className="h-full w-1/3 bg-primary [animation:route-progress_1.2s_ease-in-out_infinite]" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-40 bg-background/50 [animation:route-fade-in_200ms_ease-out_150ms_both]"
      />
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4"
      >
        <div className="flex items-center gap-2.5 rounded-full border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-lg [animation:route-pill-in_250ms_ease-out_150ms_both] motion-reduce:[animation:route-fade-in_200ms_ease-out_150ms_both]">
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="truncate">{label}</span>
        </div>
      </div>
    </>
  );
}
