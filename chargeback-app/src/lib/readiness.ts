/**
 * Process-local readiness flag: true once the boot warm pass has filled the
 * in-memory cache (immediately in mock mode). Surfaced by /api/ready so a load
 * balancer / orchestrator readiness probe can hold traffic — and with it the
 * runtime instant-nav prefetch that prerenders each tab — until the warehouse
 * is online and the cache is warm, instead of racing a cold warehouse into
 * Next's 50-second prerender cache-fill timeout (UseCacheTimeoutError).
 *
 * Liveness (/api/healthz) is deliberately separate and always green, so a slow
 * warehouse cold start never trips a restart loop. Kept on globalThis so every
 * bundle in the single server process sees the same value.
 */
const g = globalThis as unknown as { __chargebackReady?: boolean };

/** Called by the boot warm once the cache is filled. */
export function markReady(): void {
  g.__chargebackReady = true;
}

/** True once the boot warm pass has completed. */
export function isReady(): boolean {
  return g.__chargebackReady === true;
}
