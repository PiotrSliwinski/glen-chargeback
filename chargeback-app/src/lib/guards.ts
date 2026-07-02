import { redirect } from "next/navigation";
import { getSession, type AppSession } from "@/lib/auth";
import { atLeast, type Role } from "@/lib/rbac";

/** Page-level guard: unauthenticated → /login, insufficient role → dashboard. */
export async function requirePageRole(required: Role): Promise<AppSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!atLeast(session.user.role, required)) redirect("/");
  return session;
}
