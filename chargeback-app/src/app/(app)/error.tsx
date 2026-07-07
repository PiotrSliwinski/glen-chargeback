"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary for every app page. Cache misses run real
 * Databricks queries during render (token expiry, cold warehouse, driver
 * errors), so a failed fill must land on a retry screen instead of the
 * framework's default crash page. reset() re-renders the segment; failed
 * cache fills are never stored, so the retry re-queries the warehouse.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[page error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <TriangleAlert className="size-8 text-amber-500" aria-hidden />
      <div>
        <h2 className="text-lg font-semibold">Something went wrong loading this page</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          The warehouse query behind this view failed — this is usually a cold warehouse or an
          expired connection. Retrying re-runs the query.
          {error.digest && (
            <span className="mt-1 block font-mono text-xs">Error digest: {error.digest}</span>
          )}
        </p>
      </div>
      <Button onClick={reset} variant="outline" size="sm" className="gap-2">
        <RefreshCw className="size-4" aria-hidden />
        Try again
      </Button>
    </div>
  );
}
