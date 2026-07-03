import { z } from "zod";
import { AuthError, requireRole } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import type { Role } from "@/lib/rbac";
import { DomainError } from "@/services/errors";

/**
 * Shared mutation skeleton: role check → work → structured result.
 * No raw error ever crosses to the client; unexpected errors are logged
 * server-side with a generic message returned.
 */
export async function runAction(
  required: Role,
  fn: (actor: string) => Promise<string | void>,
): Promise<ActionResult> {
  try {
    const session = await requireRole(required);
    const message = await fn(session.user.email);
    return ok(message ?? undefined);
  } catch (e) {
    if (e instanceof AuthError) {
      return fail(
        e.code,
        e.code === "FORBIDDEN"
          ? "Your role does not permit this action."
          : "Sign in required.",
      );
    }
    if (e instanceof DomainError) return fail(e.code, e.message);
    if (e instanceof z.ZodError) {
      return fail(
        "VALIDATION",
        e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
      );
    }
    console.error("[action error]", e);
    return fail("INTERNAL", "Unexpected error — check the server logs.");
  }
}

export function parseForm<T>(formData: FormData, schema: z.ZodType<T>): T {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") raw[k] = v;
  }
  return schema.parse(raw);
}

/**
 * Multi-value field (bulk selection checkboxes / hidden inputs). parseForm
 * collapses repeated keys to the last value, so bulk actions read their key
 * list through this instead.
 */
export function formList(formData: FormData, name: string): string[] {
  const values = formData
    .getAll(name)
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (values.length === 0) {
    throw new DomainError("VALIDATION", "select at least one row first");
  }
  return [...new Set(values)];
}

/** empty string → null (optional text inputs) */
export const optionalText = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
