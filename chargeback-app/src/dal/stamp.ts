import { cacheLife, cacheTag } from "next/cache";
import { DATA_TAGS } from "@/lib/cache-tags";

/**
 * Fill time of the warehouse cache generation currently on screen. Tagged
 * with every warehouse tag, so the entry is recomputed whenever ANY of them
 * is expired — by the global "Refresh data" action or by any mutation
 * (mapping, catalogue, Azure rule, publication, health re-run) — and reads
 * as "data as of" next to the refresh button.
 */
export async function getDataRefreshedAt(): Promise<string> {
  "use cache";
  cacheLife("warehouse");
  cacheTag(...DATA_TAGS);
  return new Date().toISOString();
}
