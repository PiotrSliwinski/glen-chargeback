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
 */
const boolString = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const EnvSchema = z.object({
  // --- Databricks
  DATABRICKS_HOST: z.string().optional(),
  DATABRICKS_HTTP_PATH: z.string().optional(),
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

export const env = {
  ...parsed,
  /** Mock mode is on explicitly or whenever Databricks is not configured. */
  DAL_MOCK: parsed.DAL_MOCK || !parsed.DATABRICKS_HOST,
  /** Fully-qualified schema prefix for every table/view reference. */
  SCHEMA: parsed.DBX_SCHEMA,
};

export type Env = typeof env;
