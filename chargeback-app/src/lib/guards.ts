import { redirect } from "next/navigation";
import { getSession, type AppSession } from "@/lib/auth";
import { atLeast, type Role } from "@/lib/rbac";

/**
 * Page-level guard: insufficient role → dashboard. There is no sign-in (single
 * fixed identity), so this only enforces the configured APP_ROLE ceiling.
 */
export async function requirePageRole(required: Role): Promise<AppSession> {
  const session = await getSession();
  if (!atLeast(session.user.role, required)) redirect("/");
  return session;
}
