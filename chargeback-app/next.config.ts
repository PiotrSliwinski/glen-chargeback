import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheLife: {
    // Warehouse-backed reads follow a Power BI import model: they re-run only
    // when a mutation calls updateTag or the user presses "Refresh data"
    // (actions/refresh.ts). Between refreshes every tab serves from cache —
    // the long lifetimes below are deliberate, so navigation never queries
    // the warehouse.
    warehouse: {
      // Client-side reuse only: after this the router re-checks the server,
      // which still answers from the tagged server cache without touching
      // the warehouse. Kept short so one user's mutation or publication
      // becomes visible to OTHER users' open tabs within minutes — the
      // import-model economics live in revalidate/expire, not here.
      stale: 300,
      revalidate: 30 * 86400, // effectively: no scheduled background refresh
      expire: 30 * 86400,
    },
  },
  // Databricks SQL driver is a CommonJS package with runtime deps that must
  // not be bundled by Turbopack — load it from node_modules at runtime.
  serverExternalPackages: ["@databricks/sql", "exceljs"],
};

export default nextConfig;
