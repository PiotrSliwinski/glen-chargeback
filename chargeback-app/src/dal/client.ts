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

export async function query<T>(
  sql: string,
  namedParameters: Record<string, SqlParam> = {},
  schema?: z.ZodType<T>,
): Promise<T[]> {
  if (env.DAL_MOCK) {
    throw new Error(
      "query() reached in mock mode — the calling DAL module must branch to fixtures first",
    );
  }
  const client = await getClient();
  const session = await client.openSession();
  try {
    const op = await session.executeStatement(sql, { namedParameters });
    const rows = (await op.fetchAll()) as unknown[];
    await op.close();
    return schema ? rows.map((r) => schema.parse(r)) : (rows as T[]);
  } finally {
    await session.close().catch(() => {});
  }
}

/** Execute DML (INSERT/UPDATE/MERGE/DELETE). */
export async function exec(
  sql: string,
  namedParameters: Record<string, SqlParam> = {},
): Promise<void> {
  await query(sql, namedParameters);
}

/** Fully-qualified table/view reference. */
export const T = (name: string) => `${env.SCHEMA}.${name}`;
