import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth gate (Next 16 "proxy", formerly middleware): redirect to
 * /login when no session cookie is present. This is a fast-path check only —
 * real session validation and role enforcement happen in getSession() /
 * requireRole() inside pages and server actions (defense in depth).
 */
export function proxy(request: NextRequest) {
  if (process.env.AUTH_DEV_BYPASS === "true") return NextResponse.next();

  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except auth endpoints, the boot-warm endpoint (guarded by
    // its own process-local token), the login page, and static assets.
    "/((?!api/auth|api/warm|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
