import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { atLeast, type Role } from "@/lib/rbac";

/**
 * This app does no user sign-in. It runs as a single fixed identity and
 * connects to Databricks with a service principal (or `az login`); every
 * request is that same identity. APP_USER / APP_USER_EMAIL / APP_ROLE control
 * how it appears in the UI and in mapping audit columns (mapped_by). Restrict
 * *who can reach the app* at the network/platform layer (VPN, Entra App Proxy,
 * App Service authentication) rather than in-app.
 */
export interface AppSession {
  user: { name: string; email: string; role: Role };
}

const SESSION: AppSession = {
  user: { name: env.APP_USER, email: env.APP_USER_EMAIL, role: env.APP_ROLE },
};

/** Session accessor used everywhere; always the fixed app identity. */
export async function getSession(): Promise<AppSession> {
  // Touch request data so pages stay request-time (never prerendered), matching
  // how the app read auth state before.
  await cookies();
  return SESSION;
}

export class AuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code);
  }
}

/**
 * Guard for server actions and data mutations. With a single identity this only
 * enforces the configured APP_ROLE ceiling — e.g. run the app as `viewer` for a
 * read-only deployment; it never fails UNAUTHENTICATED.
 */
export async function requireRole(required: Role): Promise<AppSession> {
  const session = await getSession();
  if (!atLeast(session.user.role, required)) throw new AuthError("FORBIDDEN");
  return session;
}
