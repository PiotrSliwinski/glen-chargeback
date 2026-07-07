import { randomBytes } from "crypto";

/**
 * Process-local secret shared between instrumentation.ts and /api/warm:
 * the boot hook can't run "use cache" functions itself (no request scope),
 * so it fetches the warm route on localhost, authenticated by this token.
 * Kept on globalThis so every bundle in the process sees the same value;
 * it never leaves the process, so external callers can't produce it.
 */
const g = globalThis as unknown as { __chargebackBootToken?: string };
export const bootToken: string = (g.__chargebackBootToken ??= randomBytes(32).toString("hex"));
