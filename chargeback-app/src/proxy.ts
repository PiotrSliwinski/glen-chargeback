import { NextResponse, type NextRequest } from "next/server";
import { logTrace } from "@/lib/log";

/**
 * Request boundary marker (Next 16 "proxy", formerly middleware). The app does
 * no user sign-in (single fixed identity), so there is no auth gate here —
 * restrict access at the network/platform layer. This still runs so that, with
 * APP_LOG=all, every request is logged here and the timed [dal]/[action] lines
 * that follow can be attributed to it.
 */
export function proxy(request: NextRequest) {
  logTrace("req", `${request.method} ${request.nextUrl.pathname}`);
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except the boot-warm endpoint (guarded by its own
    // process-local token), the liveness probe, and static assets.
    "/((?!api/warm|api/healthz|_next/static|_next/image|favicon.ico).*)",
  ],
};
