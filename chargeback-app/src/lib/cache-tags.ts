/**
 * Every warehouse-backed cache tag in the app. The DAL tags each cached read
 * with one of these; mutations expire the tags they touch (actions/*), and
 * the "Refresh data" button expires the set wholesale (actions/refresh.ts).
 * Kept in one place so the refresh action and the freshness stamp
 * (dal/stamp.ts) can never drift out of sync with the DAL.
 */
export const DATA_TAGS = [
  "reports-live",
  "reports-published",
  "azure",
  "queue",
  "health",
  "mappings",
  "catalogue",
] as const;

export type DataTag = (typeof DATA_TAGS)[number];
