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
      stale: 3600, // client may reuse for 1 hour without asking the server
      revalidate: 30 * 86400, // effectively: no scheduled background refresh
      expire: 30 * 86400,
    },
  },
  // Databricks SQL driver is a CommonJS package with runtime deps that must
  // not be bundled by Turbopack — load it from node_modules at runtime.
  serverExternalPackages: ["@databricks/sql", "exceljs"],
};

export default nextConfig;
