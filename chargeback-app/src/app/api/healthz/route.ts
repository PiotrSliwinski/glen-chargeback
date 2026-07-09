/**
 * Container liveness probe: process-up check only — no auth, no warehouse, no
 * DAL. Excluded from the request proxy (see src/proxy.ts matcher).
 */
export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}
