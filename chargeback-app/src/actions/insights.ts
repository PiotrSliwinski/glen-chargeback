"use server";

import { AuthError, requireRole } from "@/lib/auth";
import { getServerlessGap } from "@/dal/insights";
import type { ServerlessGapRow } from "@/dal/types";

/**
 * On-demand data loader for the serverless-gap panel: the cost_fact scan only
 * runs when a steward opens the panel, never as part of page rendering.
 * Same no-raw-errors contract as the mutation actions.
 */

export type ServerlessGapResult =
  | { ok: true; rows: ServerlessGapRow[]; fetchedAt: string }
  | { ok: false; message: string };

export async function loadServerlessGapAction(): Promise<ServerlessGapResult> {
  try {
    await requireRole("steward");
    const rows = await getServerlessGap();
    return { ok: true, rows, fetchedAt: new Date().toISOString() };
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: "A steward role is required to run this scan." };
    }
    console.error("[serverless gap]", e);
    return { ok: false, message: "Could not scan for unmapped serverless runners — check the server logs." };
  }
}
