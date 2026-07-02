import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { atLeast, roleFromGroups, type Role } from "@/lib/rbac";

const groupToRole: Partial<Record<string, Role>> = {};
if (env.ENTRA_GROUP_VIEWER) groupToRole[env.ENTRA_GROUP_VIEWER] = "viewer";
if (env.ENTRA_GROUP_STEWARD) groupToRole[env.ENTRA_GROUP_STEWARD] = "steward";
if (env.ENTRA_GROUP_PUBLISHER) groupToRole[env.ENTRA_GROUP_PUBLISHER] = "publisher";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: env.ENTRA_CLIENT_ID
    ? [
        MicrosoftEntraID({
          clientId: env.ENTRA_CLIENT_ID,
          clientSecret: env.ENTRA_CLIENT_SECRET,
          issuer: `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`,
        }),
      ]
    : [],
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, profile }) {
      if (profile) {
        // 'groups' claim must be enabled on the app registration (Token
        // configuration → add groups claim). Overflowed claims (users in
        // many groups) would need a Graph API fallback — not implemented.
        const groups = Array.isArray((profile as { groups?: unknown }).groups)
          ? ((profile as { groups: string[] }).groups)
          : [];
        token.role = roleFromGroups(groups, groupToRole);
      }
      return token;
    },
    session({ session, token }) {
      session.user.role = (token.role as Role | null) ?? null;
      return session;
    },
  },
});

export interface AppSession {
  user: { name: string; email: string; role: Role | null };
}

const DEV_SESSION: AppSession = {
  user: { name: "Dev User", email: "dev@localhost", role: env.AUTH_DEV_ROLE },
};

/** Session accessor used everywhere instead of auth() — honors dev bypass. */
export async function getSession(): Promise<AppSession | null> {
  if (env.AUTH_DEV_BYPASS) {
    // Read request data even in bypass mode so pages behave identically to
    // real auth (session-gated pages are request-time, never prerendered).
    await cookies();
    return DEV_SESSION;
  }
  const s = await auth();
  if (!s?.user?.email) return null;
  return {
    user: {
      name: s.user.name ?? s.user.email,
      email: s.user.email,
      role: s.user.role ?? null,
    },
  };
}

export class AuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code);
  }
}

/**
 * Guard for server actions and data mutations. Throws instead of redirecting —
 * actions translate this into a structured ActionResult.
 */
export async function requireRole(required: Role): Promise<AppSession> {
  const session = await getSession();
  if (!session) throw new AuthError("UNAUTHENTICATED");
  if (!atLeast(session.user.role, required)) throw new AuthError("FORBIDDEN");
  return session;
}
