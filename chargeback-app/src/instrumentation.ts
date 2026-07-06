/**
 * Server boot hook (Next.js instrumentation file convention): warm the
 * Databricks connection so the first request after a deploy doesn't pay
 * driver import + OAuth + connect + warehouse wake-up on the request path.
 * Fire-and-forget — server startup is never blocked on the warehouse.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmup } = await import("@/dal/client");
  warmup();
}
