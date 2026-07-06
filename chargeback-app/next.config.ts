import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheLife: {
    // Warehouse-backed reads change only when the pipeline runs (~daily) or
    // via an app mutation, and every mutation already calls updateTag — so
    // pages can serve from cache for a long time and refresh in the
    // background. Work-queue reads stay on the built-in "minutes" profile.
    warehouse: {
      stale: 300, // client may reuse for 5 minutes without asking the server
      revalidate: 1800, // background refresh at most every 30 minutes
      expire: 86400, // serve stale up to 1 day before blocking on the query
    },
  },
  // Databricks SQL driver is a CommonJS package with runtime deps that must
  // not be bundled by Turbopack — load it from node_modules at runtime.
  serverExternalPackages: ["@databricks/sql", "exceljs"],
};

export default nextConfig;
