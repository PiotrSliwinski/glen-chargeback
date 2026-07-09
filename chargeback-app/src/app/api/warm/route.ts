import { bootToken } from "@/lib/boot-token";
import { warmWarehouseCache } from "@/dal/warm";
import { waitForWarehouse } from "@/dal/client";

/**
 * Internal boot-warm endpoint, called by instrumentation.ts after the server
 * starts (the boot hook has no request scope, so "use cache" reads must run
 * here). Guarded by the process-local token — not reachable by users; the
 * user-facing equivalent is the "Refresh data" action, which also expires the
 * tags first.
 *
 * All warehouse work lives here, in a Node route handler, so instrumentation.ts
 * never imports the Databricks driver — importing it there drags a native,
 * Node-only package into the Edge-runtime instrumentation build and fails it.
 */
export async function POST(request: Request) {
  if (request.headers.get("x-boot-token") !== bootToken) {
    return new Response("forbidden", { status: 403 });
  }
  // Pay the warehouse cold start here (a route handler is exempt from the 50s
  // prerender cache-fill timeout) so the concurrent warm pass below runs
  // against an already-online warehouse and comes back clean.
  await waitForWarehouse();
  const result = await warmWarehouseCache();
  return Response.json(result);
}
