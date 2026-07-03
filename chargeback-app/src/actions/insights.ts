"use server";

import { AuthError, requireRole } from "@/lib/auth";
import { getUnmappedRunners } from "@/dal/insights";
import type { UnmappedRunnerRow } from "@/dal/types";
import { lookupServicePrincipalName } from "@/services/entra";

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

export type SpNameResult = { ok: true; name: string | null } | { ok: false; message: string };

/**
 * Entra ID display-name lookup for an SPN runner, invoked when the "Map user"
 * dialog opens on a service-principal row. name: null means the directory has
 * no such service principal (e.g. a Databricks-native SP).
 */
export async function lookupSpNameAction(runnerId: string): Promise<SpNameResult> {
  try {
    await requireRole("steward");
    const name = await lookupServicePrincipalName(runnerId);
    return { ok: true, name };
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, message: "A steward role is required for Entra ID lookups." };
    }
    console.error("[entra sp lookup]", e);
    return {
      ok: false,
      message:
        "Entra ID lookup failed — check the server logs. The app's identity needs the Application.Read.All Graph permission.",
    };
  }
}
