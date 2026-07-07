"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { refreshDataAction } from "@/actions/refresh";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Power BI-style manual refresh: expires every warehouse cache tag and
 * re-renders the current route against fresh queries. The pending state
 * covers the whole round trip, including the blocking re-query of the page
 * the user is looking at.
 */
export function RefreshDataButton({
  refreshedAt,
  compact = false,
}: {
  refreshedAt: string;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await refreshDataAction();
      if (!result.ok) setError(result.message);
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
        {error ?? `Data as of ${asOf}`}
      </span>
    </div>
  );
}
