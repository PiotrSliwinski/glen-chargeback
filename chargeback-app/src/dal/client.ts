import { env } from "@/lib/env";
import type { z } from "zod";
import type IDBSQLClient from "@databricks/sql/dist/contracts/IDBSQLClient";

export type SqlParam = string | number | boolean | null;

/**
 * One shared driver client per server process; a session per query.
 * All SQL is parameterized (:name) — never interpolate user input. The only
 * interpolated value is env.SCHEMA, validated by regex at boot.
 */
let clientPromise: Promise<IDBSQLClient> | null = null;

/** Well-known Entra ID application ID of Azure Databricks (public constant). */
const AZURE_DATABRICKS_SCOPE = "2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default";

/**
 * DATABRICKS_AUTH=azure-cli: authenticate as the developer's own Entra ID
 * user via `az login` — no secrets in .env. The driver caches the token and
 * re-invokes getToken when it expires (~1h).
 */
async function azureCliAuth() {
  const { AzureCliCredential } = await import("@azure/identity");
  const credential = new AzureCliCredential(
    env.ENTRA_TENANT_ID ? { tenantId: env.ENTRA_TENANT_ID } : {},
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
        ...(env.DATABRICKS_AUTH === "azure-cli"
          ? await azureCliAuth()
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

  // A pooled session may have been expired server-side; SELECTs are safe to
  // retry once on a fresh session, so a dead pooled session costs one attempt.
  const pooled = takePooledSession();
  if (pooled) {
    try {
      const rows = await runStatement(pooled, sql, namedParameters, schema);
      releaseSession(pooled);
      return rows;
    } catch {
      await pooled.close().catch(() => {});
    }
  }

  const session = await client.openSession();
  try {
    const rows = await runStatement(session, sql, namedParameters, schema);
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
  try {
    await runStatement(session, sql, namedParameters);
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
