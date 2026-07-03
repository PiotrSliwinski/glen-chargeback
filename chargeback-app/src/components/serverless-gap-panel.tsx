"use client";

import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Serverless attribution gap, fully on demand: neither the panel's code
 * chunk nor the cost_fact scan loads with the page. Opening it lazy-imports
 * the body (code split at this boundary) which then fetches its data through
 * a server action — page render and main thread stay untouched until asked.
 */
const ServerlessGapBody = lazy(() => import("@/components/serverless-gap-body"));

export function ServerlessGapPanel({ deskOptions }: { deskOptions: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="no-print mb-6">
      <CardHeader>
        <CardTitle>Serverless attribution gap</CardTitle>
        <CardDescription className="text-xs">
          Runners with serverless spend in the last 30 days who are not in user_mapping.
          Serverless compute has no warehouse to classify, so if these runners stay unmapped
          their untagged spend can never attribute via the USER rule — it lands on NONE.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {open ? (
          <Suspense fallback={<GapSkeleton />}>
            <ServerlessGapBody deskOptions={deskOptions} />
          </Suspense>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => setOpen(true)}>
              Scan for unmapped serverless runners
            </Button>
            <p className="text-xs text-muted-foreground">
              Runs a 30-day cost_fact scan — loaded on demand, nothing is queried until you ask.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GapSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Scanning for unmapped serverless runners…" className="space-y-3">
      <span className="sr-only">Scanning for unmapped serverless runners…</span>
      {[0, 1, 2].map((r) => (
        <div key={r} className="flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-4 w-24 max-sm:hidden" />
          <Skeleton className="h-4 w-20 max-sm:hidden" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
