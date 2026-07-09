import { env } from "@/lib/env";
import { logDuration, logTrace, time } from "@/lib/log";
import type { z } from "zod";
import type IDBSQLClient from "@databricks/sql/dist/contracts/IDBSQLClient";

export type SqlParam = string | number | boolean | null;

/**
 * A compact, stable name for a statement — leading verb + primary table (with
 * the catalog.schema prefix dropped). Used purely for log lines; never logs
 * the full SQL or any bound parameter *value* (only the keys), so nothing
 * sensitive reaches the log stream.
 */
function deriveLabel(sql: string): string {
  const s = sql.trim().replace(/\s+/g, " ");
  const verb = (s.match(/^(WITH|SELECT|INSERT|UPDATE|MERGE|DELETE)/i)?.[1] ?? "SQL").toUpperCase();
  const table = s
    .match(/\b(?:FROM|INTO|UPDATE)\s+([A-Za-z0-9_.]+)/i)?.[1]
    ?.split(".")
    .pop();
  return table ? `${verb} ${table}` : verb;
}

const paramKeys = (p: Record<string, SqlParam>): string | undefined => {
  const keys = Object.keys(p);
  return keys.length ? keys.join(",") : undefined;
};

/**
 * One shared driver client per server process; a session per query.
 * All SQL is parameterized (:name) — never interpolate user input. The only
 * interpolated value is env.SCHEMA, validated by regex at boot.
 */
let clientPromise: Promise<IDBSQLClient> | null = null;

/** Well-known Entra ID application ID of Azure Databricks (public constant). */
const AZURE_DATABRICKS_SCOPE = "2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default";

/**
 * DATABRICKS_AUTH=azure (default): acquire an Entra ID token for the Databricks
 * SQL scope via DefaultAzureCredential — one credential for every
 * non-interactive Entra scenario, with no code branching:
 *   - local dev: the developer's own `az login` identity (no secrets in .env)
 *   - container with an SPN: AZURE_TENANT_ID / AZURE_CLIENT_ID /
 *     AZURE_CLIENT_SECRET, read by @azure/identity's EnvironmentCredential
 *   - Azure (AKS / App Service / Container Apps): workload or managed identity
 *     — no secret shipped in the image at all
 * The resolved identity must be added to the Databricks workspace and granted
 * access to the SQL warehouse. The driver caches the token and re-invokes
 * getToken on expiry (~1h). If the managed-identity probe adds latency where
 * it can't apply, pin the chain with AZURE_TOKEN_CREDENTIALS=prod|dev.
 */
async function azureAuth() {
  const { DefaultAzureCredential } = await import("@azure/identity");
  const credential = new DefaultAzureCredential(
    env.AZURE_TENANT_ID ? { tenantId: env.AZURE_TENANT_ID } : {},
  );
  return {
    authType: "external-token" as const,
    getToken: async () =>
      (await credential.getToken(AZURE_DATABRICKS_SCOPE)).token,
  };
}

async function getClient(): Promise<IDBSQLClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { DBSQLClient } = await import("@databricks/sql");
      const client = new DBSQLClient();
      await client.connect({
        host: env.DATABRICKS_HOST!,
        path: env.DATABRICKS_HTTP_PATH!,
        ...(env.DATABRICKS_AUTH === "azure"
          ? await azureAuth()
          : {
              authType: "databricks-oauth" as const,
              oauthClientId: env.DATABRICKS_CLIENT_ID!,
              oauthClientSecret: env.DATABRICKS_CLIENT_SECRET!,
            }),
      });
      return client as unknown as IDBSQLClient;
    })().catch((e) => {
      clientPromise = null; // allow retry after a failed connect
      throw e;
    });
  }
  return clientPromise;
}

type Session = Awaited<ReturnType<IDBSQLClient["openSession"]>>;

/**
 * Small idle-session pool: opening a session costs an extra warehouse round
 * trip, and a page cache-miss fires several queries at once. Recently used
 * sessions are kept for reuse within a burst; anything idle past the TTL is
 * closed on next touch rather than trusted (warehouse auto-stop kills them).
 */
const idlePool: { session: Session; idleSince: number }[] = [];
const MAX_IDLE_SESSIONS = 4;
const IDLE_TTL_MS = 4 * 60_000;

function takePooledSession(): Session | null {
  let entry;
  while ((entry = idlePool.pop())) {
    if (Date.now() - entry.idleSince < IDLE_TTL_MS) return entry.session;
    entry.session.close().catch(() => {});
  }
  return null;
}

function releaseSession(session: Session): void {
  if (idlePool.length < MAX_IDLE_SESSIONS) {
    idlePool.push({ session, idleSince: Date.now() });
  } else {
    session.close().catch(() => {});
  }
}

function assertNotMock(): void {
  if (env.DAL_MOCK) {
    throw new Error(
      "query() reached in mock mode — the calling DAL module must branch to fixtures first",
    );
  }
}

async function runStatement<T>(
  session: Session,
  sql: string,
  namedParameters: Record<string, SqlParam>,
  schema?: z.ZodType<T>,
): Promise<T[]> {
  const op = await session.executeStatement(sql, { namedParameters });
  const rows = (await op.fetchAll()) as unknown[];
  await op.close();
  return schema ? rows.map((r) => schema.parse(r)) : (rows as T[]);
}

export async function query<T>(
  sql: string,
  namedParameters: Record<string, SqlParam> = {},
  schema?: z.ZodType<T>,
): Promise<T[]> {
  assertNotMock();
  const client = await getClient();
  const label = deriveLabel(sql);
  const params = paramKeys(namedParameters);

  // A pooled session may have been expired server-side; SELECTs are safe to
  // retry once on a fresh session, so a dead pooled session costs one attempt.
  // Timed by hand (not time()) so a benign dead-session retry doesn't warn.
  const pooled = takePooledSession();
  if (pooled) {
    const t0 = performance.now();
    try {
      const rows = await runStatement(pooled, sql, namedParameters, schema);
      releaseSession(pooled);
      logDuration("dal", label, performance.now() - t0, {
        via: "pool",
        rows: rows.length,
        params,
      });
      return rows;
    } catch {
      await pooled.close().catch(() => {});
      logTrace("dal", `${label} pooled session dead — retrying on a fresh one`, { params });
    }
  }

  const session = await client.openSession();
  try {
    const rows = await time(
      "dal",
      label,
      () => runStatement(session, sql, namedParameters, schema),
      (r) => ({ via: pooled ? "retry" : "fresh", rows: r.length, params }),
    );
    releaseSession(session);
    return rows;
  } catch (e) {
    await session.close().catch(() => {});
    throw e;
  }
}

/**
 * Execute DML (INSERT/UPDATE/MERGE/DELETE). Always a fresh session and never
 * retried — a statement that may have already executed must not run twice.
 */
export async function exec(
  sql: string,
  namedParameters: Record<string, SqlParam> = {},
): Promise<void> {
  assertNotMock();
  const client = await getClient();
  const session = await client.openSession();
  const label = deriveLabel(sql);
  try {
    await time("dal", label, () => runStatement(session, sql, namedParameters), {
      via: "exec",
      params: paramKeys(namedParameters),
    });
  } finally {
    await session.close().catch(() => {});
  }
}

/**
 * Fire-and-forget connection warm-up (instrumentation.ts): pays the driver
 * import + auth + connect + warehouse wake-up at boot instead of on the
 * first visitor's request. Never throws — a failure just means the first
 * request connects lazily as before.
 */
export function warmup(): void {
  if (env.DAL_MOCK) return;
  void query("SELECT 1")
    .then(() => console.log("[dal] warehouse connection warmed"))
    .catch((e) =>
      console.warn("[dal] warm-up failed (will connect lazily):", e?.message ?? e),
    );
}

/** Fully-qualified table/view reference. */
export const T = (name: string) => `${env.SCHEMA}.${name}`;
