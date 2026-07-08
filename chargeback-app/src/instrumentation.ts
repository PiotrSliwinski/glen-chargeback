/**
 * Server boot hook (Next.js instrumentation file convention): warm the
 * Databricks connection so the first request after a deploy doesn't pay
 * driver import + OAuth + connect + warehouse wake-up on the request path,
 * then re-fill the whole warehouse cache. The "use cache" store is in-memory,
 * so a restart otherwise starts cold and the first visitors (or the runtime
 * prefetch sweep) pay every query. Fire-and-forget — server startup is never
 * blocked on the warehouse.
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

  const { warmup } = await import("@/dal/client");
  warmup();

  // "use cache" reads need a request scope, so the warm itself runs in the
  // /api/warm route handler; this just kicks it via localhost once the
  // server is listening (hence the delay), authenticated by the
  // process-local boot token.
  const { bootToken } = await import("@/lib/boot-token");
  const port = process.env.PORT ?? "3000";
  setTimeout(async () => {
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
    } catch (e) {
      console.warn("[boot-warm] skipped:", e instanceof Error ? e.message : e);
    }
  }, 3000);
}
