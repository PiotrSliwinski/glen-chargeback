import { bootToken } from "@/lib/boot-token";
import { warmWarehouseCache } from "@/dal/warm";

/**
 * Internal boot-warm endpoint, called once by instrumentation.ts after the
 * server starts (the boot hook has no request scope, so "use cache" reads
 * must run here). Guarded by the process-local token — not reachable by
 * users; the user-facing equivalent is the "Refresh data" action, which
 * also expires the tags first.
 */
export async function POST(request: Request) {
  if (request.headers.get("x-boot-token") !== bootToken) {
    return new Response("forbidden", { status: 403 });
  }
  const result = await warmWarehouseCache();
  return Response.json(result);
}
