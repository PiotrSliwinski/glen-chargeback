import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Databricks SQL driver is a CommonJS package with runtime deps that must
  // not be bundled by Turbopack — load it from node_modules at runtime.
  serverExternalPackages: ["@databricks/sql", "exceljs"],
};

export default nextConfig;
