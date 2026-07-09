import { z } from "zod";

/**
 * All configuration is validated once at module load — the app fails fast on
 * malformed config instead of failing on first use.
 *
 * DAL_MOCK serves all reads/writes from in-memory fixtures (auto-enabled when
 * no DATABRICKS_HOST is configured) so the app runs without a SQL warehouse.
 *
 * The app does no user sign-in: it runs as one fixed identity (APP_USER /
 * APP_USER_EMAIL / APP_ROLE) and authenticates to Databricks as a service
 * principal or via `az login`. Gate who can reach it at the network layer.
 *
 * Trace logging (read directly from process.env in src/lib/log.ts, not here,
 * so the Edge proxy can use it without importing this server-only module):
 *  - APP_LOG: off | slow | all. Unset → verbose in dev, silent in prod. Set
 *    APP_LOG=all (or slow) on a prod box to trace where a request spends time.
 *  - APP_LOG_SLOW_MS: threshold (default 200) for flagging/gating slow ops.
 */
const boolString = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const EnvSchema = z.object({
  // --- Databricks
  DATABRICKS_HOST: z.string().optional(),
  DATABRICKS_HTTP_PATH: z.string().optional(),
  // How the app authenticates to the SQL warehouse:
  //  - azure: acquire an Entra ID token via DefaultAzureCredential. One mode
  //    for every non-interactive Entra scenario — `az login` locally, an SPN
  //    from AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET in a container,
  //    or workload/managed identity in Azure (no secret at all). The identity
  //    must be added to the workspace with SQL-warehouse access.
  //  - databricks-oauth: Databricks-native OAuth M2M, where
  //    DATABRICKS_CLIENT_ID/SECRET is a Databricks-*generated* OAuth secret
  //    (not an Entra credential).
  // Defaults to databricks-oauth when DATABRICKS_CLIENT_SECRET is set (that
  // secret is a Databricks OAuth secret), otherwise azure — which resolves the
  // right identity unchanged from a laptop to Azure.
  DATABRICKS_AUTH: z.enum(["azure", "databricks-oauth"]).optional(),
  DATABRICKS_CLIENT_ID: z.string().optional(),
  DATABRICKS_CLIENT_SECRET: z.string().optional(),

  // --- Entra ID service principal for the warehouse (azure mode) + Graph.
  // Read natively by @azure/identity's EnvironmentCredential; leave unset in
  // Azure, where workload/managed identity is used instead (no secret shipped).
  AZURE_TENANT_ID: z.string().optional(),
  AZURE_CLIENT_ID: z.string().optional(),
  AZURE_CLIENT_SECRET: z.string().optional(),
  // catalog.schema — validated so it can be safely interpolated into SQL
  DBX_SCHEMA: z
    .string()
    .regex(/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/, "expected <catalog>.<schema>")
    .default("main_dev.cost_reporting"),
  DAL_MOCK: boolString,

  // --- Identity (no user sign-in; the app runs as one fixed identity).
  // APP_ROLE caps what the app can do — set `viewer` for a read-only deploy.
  // APP_USER_EMAIL is recorded as mapped_by on reference-data writes.
  APP_ROLE: z.enum(["viewer", "steward", "publisher"]).default("publisher"),
  APP_USER: z.string().default("Chargeback App"),
  APP_USER_EMAIL: z.string().default("chargeback-app@localhost"),

  // --- App behavior
  RECON_TOLERANCE_USD: z.coerce.number().positive().default(1),
});

const parsed = EnvSchema.parse(process.env);

/** Resolved warehouse auth mode (see DATABRICKS_AUTH above). */
const databricksAuth =
  parsed.DATABRICKS_AUTH ??
  (parsed.DATABRICKS_CLIENT_SECRET ? "databricks-oauth" : "azure");

// Fail fast on incomplete databricks-oauth config: a container mis-configured
// at deploy time should error at boot, not limp along and fail on the first
// warehouse query. azure mode can't be pre-validated — DefaultAzureCredential
// resolves its source (env SPN / managed identity / az login) at call time, so
// a bad credential surfaces at the boot warm-up instead.
if (databricksAuth === "databricks-oauth") {
  const missing = (
    ["DATABRICKS_CLIENT_ID", "DATABRICKS_CLIENT_SECRET"] as const
  ).filter((k) => !parsed[k]);
  if (missing.length > 0) {
    throw new Error(`DATABRICKS_AUTH=databricks-oauth requires ${missing.join(", ")}`);
  }
}

export const env = {
  ...parsed,
  /** Mock mode is on explicitly or whenever Databricks is not configured. */
  DAL_MOCK: parsed.DAL_MOCK || !parsed.DATABRICKS_HOST,
  DATABRICKS_AUTH: databricksAuth,
  /** Fully-qualified schema prefix for every table/view reference. */
  SCHEMA: parsed.DBX_SCHEMA,
};

export type Env = typeof env;
