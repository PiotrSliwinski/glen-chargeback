"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { parseForm, runAction } from "@/actions/run";
import { getIntegrityViolationsLive, getReconciliation, isPublishable } from "@/dal/health";
import { getPublishedMonths } from "@/dal/reports";
import { publishMonth } from "@/dal/publish";
import { DomainError } from "@/services/errors";
import { fmtMonth } from "@/lib/format";

const Publish = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  confirm: z.string(),
});

/**
 * Publication (Methodology §9/§10.6) — Publisher role only, gated on the
 * health checks, and guarded by a typed confirmation because it is the one
 * hard-to-reverse action in the system.
 */
export async function publishMonthAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("publisher", async () => {
    const input = parseForm(formData, Publish);
    if (input.confirm.trim() !== input.month) {
      throw new DomainError(
        "VALIDATION",
        `type '${input.month}' in the confirmation box to publish`,
      );
    }
    // Re-evaluate the gate server-side — never trust the button state.
    // Integrity checks run LIVE (cheap queries; must see edits made a moment
    // ago). Reconciliation stays cached: the scan takes minutes, and every
    // in-app mutation that could move it expires the 'health' tag anyway.
    const [recon, violations, published] = await Promise.all([
      getReconciliation(),
      getIntegrityViolationsLive(),
      getPublishedMonths(),
    ]);
    const currentMonth = new Date().toISOString().slice(0, 7);
    const gate = isPublishable({ recon, violations }, input.month, published, currentMonth);
    if (!gate.publishable) {
      throw new DomainError("CHECKS_FAILED", `cannot publish: ${gate.reasons.join("; ")}`);
    }
    await publishMonth(input.month);
    updateTag("reports-published");
    updateTag("health");
    return `${fmtMonth(input.month)} published. Desk invoices now read this immutable snapshot.`;
  });
}

/** Health refresh — re-runs §7.1/§7.4 by expiring the cached results. */
export async function refreshHealthAction(): Promise<ActionResult> {
  return runAction("steward", async () => {
    updateTag("health");
    return "Health checks re-run.";
  });
}
