/**
 * Server boot hook (Next.js instrumentation file convention): wait for the
 * Databricks warehouse to come online, then fill the whole "use cache" store in
 * one pass, so the first visitors — and the runtime instant-nav prefetch that
 * prerenders each tab — read from a warm cache instead of racing a cold
 * warehouse into Next's 50-second prerender cache-fill timeout.
 *
 * The "use cache" store is in-memory, so a restart otherwise starts cold. All
 * of this runs fire-and-forget in the background: server startup is never
 * blocked on the warehouse, and readiness (/api/ready) flips once the warm pass
 * completes.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Announce the trace layer so it's clear at boot whether/at what level it's
  // logging (silent in prod unless APP_LOG is set — see src/lib/log.ts).
  const { logEvent, logLevel, slowThresholdMs } = await import("@/lib/log");
  logEvent("boot", "trace logging active", {
    level: logLevel(),
    slowMs: slowThresholdMs(),
  });

  void bootWarm();
}

/**
 * Wait for the warehouse, then warm the cache. "use cache" reads need a request
 * scope, so the warm itself runs in the /api/warm route handler (a normal
 * request, exempt from the 50s prerender limit); this kicks it over localhost,
 * authenticated by the process-local boot token, and retries until the pass
 * comes back clean or the attempts are exhausted.
 */
async function bootWarm() {
  const { env } = await import("@/lib/env");
  const { markReady } = await import("@/lib/readiness");
  const { logEvent } = await import("@/lib/log");

  if (env.DAL_MOCK) {
    markReady();
    logEvent("warm", "mock mode — ready immediately");
    return;
  }

  // The warehouse cold-start wait + warm pass both run inside /api/warm (a Node
  // route handler). instrumentation.ts must NOT import the DAL/driver itself —
  // that pulls a native, Node-only package into the Edge instrumentation build.
  const { bootToken } = await import("@/lib/boot-token");
  const port = process.env.PORT ?? "3000";
  const MAX_ATTEMPTS = 8;
  const RETRY_MS = 3_000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/warm`, {
        method: "POST",
        headers: { "x-boot-token": bootToken },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { warmed, failed } = (await res.json()) as { warmed: number; failed: string[] };
      console.log(
        `[boot-warm] ${warmed} queries cached${failed.length > 0 ? `, ${failed.length} failed: ${failed.join(", ")}` : ""}`,
      );
      // A clean pass means the cache is fully warm — ready to serve fast.
      if (failed.length === 0) {
        markReady();
        return;
      }
    } catch (e) {
      // Server not listening yet, or the pass errored — retry.
      console.warn(`[boot-warm] attempt ${attempt}/${MAX_ATTEMPTS} skipped:`, e instanceof Error ? e.message : e);
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_MS));
  }

  // Couldn't get a fully clean pass; serve anyway (routes fill lazily). Marking
  // ready avoids holding traffic forever on one persistently-failing query.
  markReady();
  console.warn("[boot-warm] proceeding after retries without a fully clean pass — routes will fill lazily");
}
