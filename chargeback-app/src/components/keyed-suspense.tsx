import { Suspense } from "react";
import type { SearchParams } from "@/lib/report-params";

/**
 * Suspense boundary keyed on the resolved search params, so the loading
 * fallback re-appears when the user switches month/mode and the slow
 * Databricks re-query streams in (an unkeyed boundary would keep showing
 * the stale content with no feedback).
 *
 * Cache Components forbids awaiting request data outside <Suspense>, so the
 * await happens in an inner component wrapped by an outer boundary.
 */
export function SearchParamsSuspense({
  searchParams,
  fallback,
  children,
}: {
  searchParams: SearchParams;
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <Keyed searchParams={searchParams} fallback={fallback}>
        {children}
      </Keyed>
    </Suspense>
  );
}

async function Keyed({
  searchParams,
  fallback,
  children,
}: {
  searchParams: SearchParams;
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  const sp = await searchParams;
  return (
    <Suspense key={JSON.stringify(sp)} fallback={fallback}>
      {children}
    </Suspense>
  );
}
