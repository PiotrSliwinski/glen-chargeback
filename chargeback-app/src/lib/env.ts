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

  // --- Entra ID credential for the warehouse + Graph (DefaultAzureCredential).
  // The only warehouse auth path: an Entra ID token via DefaultAzureCredential,
  // resolved at runtime with no config change from laptop to cluster —
  // `az login` locally, an SPN from AZURE_TENANT_ID/AZURE_CLIENT_ID/
  // AZURE_CLIENT_SECRET in a container (read natively by EnvironmentCredential),
  // or workload/managed identity in Azure (no secret shipped). The identity
  // must be added to the workspace with SQL-warehouse access.
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

// The warehouse credential (DefaultAzureCredential) resolves its source — env
// SPN / managed identity / az login — at call time, so there is nothing to
// pre-validate at boot; a bad credential surfaces at the boot warm-up instead.

export const env = {
  ...parsed,
  /** Mock mode is on explicitly or whenever Databricks is not configured. */
  DAL_MOCK: parsed.DAL_MOCK || !parsed.DATABRICKS_HOST,
  /** Fully-qualified schema prefix for every table/view reference. */
  SCHEMA: parsed.DBX_SCHEMA,
};

export type Env = typeof env;
