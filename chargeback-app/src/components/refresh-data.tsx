"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { refreshDataAction } from "@/actions/refresh";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Power BI-style manual refresh: expires every warehouse cache tag (except
 * 'health', whose minutes-long reconciliation has its own button on the
 * Health page) and re-warms every tab's default-view queries before the
 * action returns. The pending state therefore covers the full warehouse
 * refresh — when the spinner stops, every tab serves from cache.
 */
export function RefreshDataButton({
  refreshedAt,
  compact = false,
}: {
  refreshedAt: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // Shown in place of the as-of stamp: an error, or the action's summary
  // ("N queries re-cached" / "N warm-up queries failed").
  const [note, setNote] = useState<string | null>(null);

  const onClick = () => {
    setNote(null);
    startTransition(async () => {
      const result = await refreshDataAction();
      setNote(result.ok ? (result.message ?? null) : result.message);
    });
  };

  // Server and client may disagree on locale/timezone for the first paint;
  // the suppressed mismatch resolves to the viewer's locale on hydration.
  const asOf = new Date(refreshedAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (compact) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClick}
        disabled={pending}
        aria-label="Refresh data"
        title={`Refresh data (as of ${asOf})`}
        suppressHydrationWarning
      >
        <RefreshCw className={cn("size-4", pending && "animate-spin")} aria-hidden />
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={pending}
        className="w-full justify-start gap-2"
      >
        <RefreshCw className={cn("size-4", pending && "animate-spin")} aria-hidden />
        {pending ? "Refreshing…" : "Refresh data"}
      </Button>
      <span className="px-0.5 text-xs text-muted-foreground" suppressHydrationWarning>
        {note ?? `Data as of ${asOf}`}
      </span>
    </div>
  );
}
