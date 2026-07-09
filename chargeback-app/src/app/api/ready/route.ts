import { isReady } from "@/lib/readiness";

/**
 * Readiness probe: 200 once the boot warm pass has filled the cache, 503 while
 * still warming (warehouse spinning up). Point a load balancer / k8s
 * readinessProbe here so prefetch traffic waits for a warm cache and never
 * races a cold warehouse into Next's 50s prerender cache-fill timeout.
 *
 * This is NOT the liveness probe: /api/healthz stays green throughout, so a slow
 * warehouse cold start never triggers a restart loop. Excluded from the request
 * proxy (see src/proxy.ts matcher).
 */
export function GET() {
  const ready = isReady();
  return new Response(ready ? "ready" : "warming", {
    status: ready ? 200 : 503,
    headers: { "content-type": "text/plain" },
  });
}
