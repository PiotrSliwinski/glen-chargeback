#!/usr/bin/env node
// =====================================================================
// Recreates all Databricks chargeback objects from databricks/setup.sql
// (the runnable DDL from databricks_chargeback_methodology.md).
//
// Uses the same env vars as the app (.env.local / .env in chargeback-app):
//   DATABRICKS_HOST, DATABRICKS_HTTP_PATH
//   Warehouse auth: Entra ID via DefaultAzureCredential — `az login` locally,
//   an AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET SPN in a container,
//   or workload/managed identity in Azure.
//   DBX_SCHEMA (default main_dev.cost_reporting) — the script rewrites the
//   schema in setup.sql, so the same file deploys to any catalog.schema.
//
// Usage (from chargeback-app/):
//   npm run setup:dbx              # execute all statements
//   npm run setup:dbx -- --dry-run # print the statement plan, run nothing
//
// Idempotent by construction: tables are IF NOT EXISTS (data preserved),
// views are OR REPLACE (logic refreshed). Safe to re-run after editing
// the methodology's view definitions.
// =====================================================================

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sqlPath = path.join(appDir, "..", "databricks", "setup.sql");
const CANONICAL_SCHEMA = "main_dev.cost_reporting";

// ---- minimal .env loader (the app relies on Next.js for this; a
// standalone script must do it itself). Real environment wins.
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

const dryRun = process.argv.includes("--dry-run");
const host = process.env.DATABRICKS_HOST;
const httpPath = process.env.DATABRICKS_HTTP_PATH;
const schema = process.env.DBX_SCHEMA ?? CANONICAL_SCHEMA;

if (!/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(schema)) {
  fail(`DBX_SCHEMA must be <catalog>.<schema>, got: ${schema}`);
}
if (!dryRun && (!host || !httpPath)) {
  fail("DATABRICKS_HOST and DATABRICKS_HTTP_PATH must be set (see .env.example)");
}

// ---- split the script into statements, ignoring ';' inside single-quoted
// strings, line comments (--) and block comments (/* */)
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (ch === "'") {
      // string literal; '' is an escaped quote
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") { j++; break; }
        else j++;
      }
      current += sql.slice(i, j);
      i = j;
    } else if (two === "--") {
      const j = sql.indexOf("\n", i);
      current += sql.slice(i, j === -1 ? sql.length : j);
      i = j === -1 ? sql.length : j;
    } else if (two === "/*") {
      const j = sql.indexOf("*/", i);
      current += sql.slice(i, j === -1 ? sql.length : j + 2);
      i = j === -1 ? sql.length : j + 2;
    } else if (ch === ";") {
      statements.push(current);
      current = "";
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  statements.push(current);
  return statements.map((s) => s.trim()).filter(Boolean);
}

function label(stmt) {
  // strip comments so DDL keywords mentioned in headers don't mislabel
  const code = stmt.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const m = code.match(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(SCHEMA|TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_.]+)/i,
  );
  return m ? `${m[1].toUpperCase()} ${m[2]}` : code.trim().split("\n")[0].slice(0, 60);
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const raw = readFileSync(sqlPath, "utf8");
const statements = splitStatements(
  schema === CANONICAL_SCHEMA ? raw : raw.replaceAll(CANONICAL_SCHEMA, schema),
);

console.log(`${sqlPath}`);
console.log(`schema: ${schema} — ${statements.length} statements\n`);

if (dryRun) {
  statements.forEach((s, n) => console.log(`${String(n + 1).padStart(2)}. ${label(s)}`));
  process.exit(0);
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
let failed = false;
try {
  for (const [n, stmt] of statements.entries()) {
    const name = label(stmt);
    process.stdout.write(`${String(n + 1).padStart(2)}/${statements.length} ${name} ... `);
    const started = Date.now();
    try {
      const op = await session.executeStatement(stmt);
      await op.fetchAll();
      await op.close();
      console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (e) {
      console.log("FAILED");
      console.error(`\n${e.message ?? e}\n`);
      failed = true;
      break; // later objects depend on earlier ones — stop here
    }
  }
} finally {
  await session.close().catch(() => {});
  await client.close().catch(() => {});
}
process.exit(failed ? 1 : 0);
