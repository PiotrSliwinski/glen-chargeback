"use server";

import { AuthError, requireRole } from "@/lib/auth";
import { getUnmappedRunners } from "@/dal/insights";
import type { UnmappedRunnerRow } from "@/dal/types";

/**
 * On-demand data loader for the unmapped-runners panel: the cost_fact scan
 * only runs when a steward opens the panel, never as part of page rendering.
 * Same no-raw-errors contract as the mutation actions.
 */

export type UnmappedRunnersResult =
  | { ok: true; rows: UnmappedRunnerRow[]; fetchedAt: string }
  | { ok: false; message: string };

export async function loadUnmappedRunnersAction(): Promise<UnmappedRunnersResult> {
  try {
    await requireRole("steward");
    const rows = await getUnmappedRunners();
    return { ok: true, rows, fetchedAt: new Date().toISOString() };
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: "A steward role is required to run this scan." };
    }
    console.error("[unmapped runners]", e);
    return { ok: false, message: "Could not scan for unmapped runners — check the server logs." };
  }
}
