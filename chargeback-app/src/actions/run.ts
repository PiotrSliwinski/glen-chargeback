import { z } from "zod";
import { AuthError, requireRole } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { logDuration, logError } from "@/lib/log";
import type { Role } from "@/lib/rbac";
import { DomainError } from "@/services/errors";

/**
 * Shared mutation skeleton: role check → work → structured result.
 * No raw error ever crosses to the client; unexpected errors are logged
 * server-side with a generic message returned.
 *
 * `label` names the action in the timing log — the DML statements it issues
 * are already timed individually in the DAL, so this line brackets the whole
 * mutation (auth + work). Note it does NOT cover the post-action `updateTag`
 * re-render: that cost shows up as the `[dal]` re-execution lines that follow.
 */
export async function runAction(
  required: Role,
  fn: (actor: string) => Promise<string | void>,
  label = "action",
): Promise<ActionResult> {
  const t0 = performance.now();
  try {
    const session = await requireRole(required);
    const message = await fn(session.user.email);
    logDuration("action", label, performance.now() - t0, {
      actor: session.user.email,
      role: required,
    });
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
    logError("action", `${label} errored after ${Math.round(performance.now() - t0)}ms`, e);
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

/** empty string → null (optional date inputs, e.g. an open-ended valid_to) */
export const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "expected YYYY-MM-DD or empty");
