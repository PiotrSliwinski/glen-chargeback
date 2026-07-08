"use server";

import { refresh, updateTag } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { DATA_TAGS } from "@/lib/cache-tags";
import { warmWarehouseCache } from "@/dal/warm";
import { runAction } from "@/actions/run";

/**
 * The "Refresh data" button expires every warehouse-backed tag at once and
 * then re-runs every default-view query (Power BI import-model semantics):
 * the refresh pays for the warehouse round trips, so when the spinner stops
 * every tab serves from cache and navigation is instant. Between refreshes
 * all tabs serve from cache — reference-data edits stay coherent regardless,
 * because each mutation calls updateTag on its own tags.
 *
 * 'health' is deliberately excluded: its reconciliation scans up to a year
 * of system.billing.usage and can run for minutes, which would block this
 * action's round trip (and any viewer could trigger it). The Health page
 * has its own steward-gated "Re-run checks" button, and every mutation that
 * can move the checks expires 'health' itself.
 */
const REFRESH_TAGS = DATA_TAGS.filter((tag) => tag !== "health");

export async function refreshDataAction(): Promise<ActionResult> {
  return runAction(
    "viewer",
    async () => {
      for (const tag of REFRESH_TAGS) updateTag(tag);
      // updateTag gives read-your-writes within this action, so every cached
      // read the warm pass makes misses and stores a fresh result.
      const { warmed, failed } = await warmWarehouseCache();
      refresh();
      return failed.length === 0
        ? `Data refreshed — ${warmed} queries re-cached, all tabs are warm.`
        : `Data refreshed — ${failed.length} warm-up ${
            failed.length === 1 ? "query" : "queries"
          } failed; those views will re-query on first visit.`;
    },
    "refresh-data",
  );
}
