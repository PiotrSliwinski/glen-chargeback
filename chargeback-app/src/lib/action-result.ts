/**
 * Every server action returns this shape — no raw errors cross the wire.
 */
export type ActionErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "BAD_KEY_FORMAT"
  | "DUPLICATE_KEY"
  | "ORPHAN_PRODUCT"
  | "OVERLAP"
  | "NOT_FOUND"
  | "REFERENCED"
  | "ALREADY_PUBLISHED"
  | "CHECKS_FAILED"
  | "INTERNAL";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; code: ActionErrorCode; message: string };

export const ok = (message?: string): ActionResult => ({ ok: true, message });
export const fail = (code: ActionErrorCode, message: string): ActionResult => ({
  ok: false,
  code,
  message,
});
