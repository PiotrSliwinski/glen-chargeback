"use server";

import { refresh, updateTag } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { runAction } from "@/actions/run";

/**
 * Every warehouse-backed cache tag. The "Refresh data" button expires them
 * all at once (Power BI import-model semantics): the current page re-renders
 * against fresh queries immediately, and every other tab re-queries on its
 * next visit. Between refreshes all tabs serve from cache — reference-data
 * edits stay coherent regardless, because each mutation calls updateTag on
 * its own tag.
 */
const DATA_TAGS = [
  "reports-live",
  "reports-published",
  "azure",
  "queue",
  "health",
  "mappings",
  "catalogue",
] as const;

export async function refreshDataAction(): Promise<ActionResult> {
  return runAction("viewer", async () => {
    for (const tag of DATA_TAGS) updateTag(tag);
    refresh();
    return "Data refreshed from the warehouse.";
  });
}
