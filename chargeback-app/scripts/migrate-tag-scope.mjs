#!/usr/bin/env node
// =====================================================================
// One-off migration for deployments whose tag_product_mapping predates
// the unified-tag-rules change (setup.sql §9 migration note):
//   1. ADD COLUMN scope STRING
//   2. backfill existing rows with scope = 'databricks'
//   3. ALTER COLUMN scope SET NOT NULL
//   4. fold azure_tag_product_mapping in (scope = 'azure'), then drop it
//
// Idempotent: each step checks live state first, so rerunning after a
// partial failure resumes where it stopped. After this succeeds, rerun
// `npm run setup:dbx` to recreate the views against the new shape.
//
// Same env vars as setup-databricks.mjs / the app:
//   DATABRICKS_HOST, DATABRICKS_HTTP_PATH, AZURE_* (DefaultAzureCredential),
//   DBX_SCHEMA (default main_dev.cost_reporting)
//
// Usage (from chargeback-app/):
//   npm run migrate:tag-scope
// =====================================================================

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- minimal .env loader, same as setup-databricks.mjs
for (const file of [".env.local", ".env"]) {
  const p = path.join(appDir, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

const host = process.env.DATABRICKS_HOST;
const httpPath = process.env.DATABRICKS_HTTP_PATH;
const schema = process.env.DBX_SCHEMA ?? "main_dev.cost_reporting";

if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(schema)) fail(`DBX_SCHEMA must be <catalog>.<schema>, got: ${schema}`);
if (!host || !httpPath) fail("DATABRICKS_HOST and DATABRICKS_HTTP_PATH must be set (see .env.example)");

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ---- connect exactly like src/dal/client.ts
async function connect() {
  const { DBSQLClient } = await import("@databricks/sql");
  const client = new DBSQLClient();
  const { DefaultAzureCredential } = await import("@azure/identity");
  const credential = new DefaultAzureCredential(
    process.env.AZURE_TENANT_ID ? { tenantId: process.env.AZURE_TENANT_ID } : {},
  );
  await client.connect({
    host,
    path: httpPath,
    authType: "external-token",
    getToken: async () =>
      (await credential.getToken("2ff814a6-3304-4ab8-85cb-cd0e6f879c1d/.default")).token,
  });
  return client;
}

const client = await connect();
const session = await client.openSession();

async function run(sql) {
  const op = await session.executeStatement(sql);
  const rows = await op.fetchAll();
  await op.close();
  return rows;
}

async function step(name, sql) {
  process.stdout.write(`${name} ... `);
  const started = Date.now();
  const rows = await run(sql);
  console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return rows;
}

const [catalog, schemaName] = schema.split(".");
const tagTable = `${schema}.tag_product_mapping`;
const azureTable = `${schema}.azure_tag_product_mapping`;

async function tableExists(name) {
  const rows = await run(
    `SELECT 1 FROM ${catalog}.information_schema.tables
     WHERE table_schema = '${schemaName}' AND table_name = '${name}'`,
  );
  return rows.length > 0;
}

async function hasScopeColumn() {
  const rows = await run(
    `SELECT 1 FROM ${catalog}.information_schema.columns
     WHERE table_schema = '${schemaName}' AND table_name = 'tag_product_mapping'
       AND column_name = 'scope'`,
  );
  return rows.length > 0;
}

let failed = false;
try {
  console.log(`migrating ${tagTable}\n`);

  if (!(await tableExists("tag_product_mapping"))) {
    console.log("tag_product_mapping does not exist yet — nothing to migrate; just run npm run setup:dbx");
  } else {
    if (await hasScopeColumn()) {
      console.log("scope column already present — skipping ADD COLUMN");
    } else {
      await step("ALTER TABLE ADD COLUMN scope", `ALTER TABLE ${tagTable} ADD COLUMN scope STRING`);
    }

    await step(
      "backfill scope = 'databricks' where NULL",
      `UPDATE ${tagTable} SET scope = 'databricks' WHERE scope IS NULL`,
    );
    await step("ALTER COLUMN scope SET NOT NULL", `ALTER TABLE ${tagTable} ALTER COLUMN scope SET NOT NULL`);

    if (await tableExists("azure_tag_product_mapping")) {
      await step(
        "fold azure_tag_product_mapping in (scope = 'azure')",
        `INSERT INTO ${tagTable} (tag_key, tag_value, data_product, note, mapped_by, mapped_at, scope)
         SELECT a.tag_key, a.tag_value, a.data_product, a.note, a.mapped_by, a.mapped_at, 'azure'
         FROM ${azureTable} a
         WHERE NOT EXISTS (
           SELECT 1 FROM ${tagTable} t
           WHERE t.tag_key = a.tag_key AND t.tag_value = a.tag_value AND t.scope = 'azure'
         )`,
      );
      await step("DROP TABLE azure_tag_product_mapping", `DROP TABLE ${azureTable}`);
    } else {
      console.log("azure_tag_product_mapping not present — nothing to fold in");
    }

    console.log("\nmigration complete — now rerun: npm run setup:dbx");
  }
} catch (e) {
  console.log("FAILED");
  console.error(`\n${e.message ?? e}\n`);
  failed = true;
} finally {
  await session.close().catch(() => {});
  await client.close().catch(() => {});
}
process.exit(failed ? 1 : 0);
