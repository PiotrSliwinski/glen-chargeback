import { z } from "zod";

/**
 * All configuration is validated once at module load — the app fails fast on
 * malformed config instead of failing on first use.
 *
 * Two development affordances:
 *  - DAL_MOCK: serve all reads/writes from in-memory fixtures (auto-enabled
 *    when no DATABRICKS_HOST is configured) so the app runs without a
 *    SQL warehouse.
 *  - AUTH_DEV_BYPASS: skip Entra ID sign-in and act as a fixed dev user
 *    (role from AUTH_DEV_ROLE). Never enable outside local development.
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
  //  - service-principal: Databricks OAuth M2M with DATABRICKS_CLIENT_ID/SECRET,
  //    where the secret is a Databricks-generated OAuth secret.
  //  - azure-spn: an Entra ID service principal (Azure app registration) —
  //    DATABRICKS_CLIENT_ID/SECRET is its client id + client secret, exchanged
  //    for an Entra token. Also needs ENTRA_TENANT_ID. Use this when the secret
  //    comes from the Azure portal (the common "SPN client id + password").
  //  - azure-cli: the developer's own Entra ID identity from `az login`
  //    (development/testing — no secrets needed)
  // Defaults to service-principal when a client secret is configured,
  // otherwise azure-cli.
  DATABRICKS_AUTH: z.enum(["service-principal", "azure-cli", "azure-spn"]).optional(),
  DATABRICKS_CLIENT_ID: z.string().optional(),
  DATABRICKS_CLIENT_SECRET: z.string().optional(),
  // catalog.schema — validated so it can be safely interpolated into SQL
  DBX_SCHEMA: z
    .string()
    .regex(/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/, "expected <catalog>.<schema>")
    .default("main_dev.cost_reporting"),
  DAL_MOCK: boolString,

  // --- Auth (Entra ID via NextAuth)
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  ENTRA_GROUP_VIEWER: z.string().optional(),
  ENTRA_GROUP_STEWARD: z.string().optional(),
  ENTRA_GROUP_PUBLISHER: z.string().optional(),
  AUTH_DEV_BYPASS: boolString,
  AUTH_DEV_ROLE: z.enum(["viewer", "steward", "publisher"]).default("publisher"),

  // --- App behavior
  RECON_TOLERANCE_USD: z.coerce.number().positive().default(1),
});

const parsed = EnvSchema.parse(process.env);

// Fail fast on incomplete azure-spn config: a container mis-configured at
// deploy time should error at boot, not limp along and fail on the first
// warehouse query.
if (parsed.DATABRICKS_AUTH === "azure-spn") {
  const missing = (
    ["ENTRA_TENANT_ID", "DATABRICKS_CLIENT_ID", "DATABRICKS_CLIENT_SECRET"] as const
  ).filter((k) => !parsed[k]);
  if (missing.length > 0) {
    throw new Error(`DATABRICKS_AUTH=azure-spn requires ${missing.join(", ")}`);
  }
}

export const env = {
  ...parsed,
  /** Mock mode is on explicitly or whenever Databricks is not configured. */
  DAL_MOCK: parsed.DAL_MOCK || !parsed.DATABRICKS_HOST,
  /** Resolved warehouse auth mode (see DATABRICKS_AUTH above). */
  DATABRICKS_AUTH:
    parsed.DATABRICKS_AUTH ??
    (parsed.DATABRICKS_CLIENT_SECRET ? "service-principal" : "azure-cli"),
  /** Fully-qualified schema prefix for every table/view reference. */
  SCHEMA: parsed.DBX_SCHEMA,
};

export type Env = typeof env;
