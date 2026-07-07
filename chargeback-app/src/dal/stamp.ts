import { cacheLife, cacheTag } from "next/cache";

/**
 * Fill time of the warehouse cache generation currently on screen. The entry
 * is recomputed whenever the 'reports-live' tag is expired — by the global
 * "Refresh data" action or by any mutation that touches live attribution —
 * so it reads as "data as of" next to the refresh button.
 */
export async function getDataRefreshedAt(): Promise<string> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("reports-live");
  return new Date().toISOString();
}
