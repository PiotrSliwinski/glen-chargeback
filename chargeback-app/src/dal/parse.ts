import { z } from "zod";

/**
 * The Databricks driver returns DATE columns as Date objects and DECIMALs
 * sometimes as strings — normalize at the DAL boundary.
 */

/** DATE/TIMESTAMP/string → 'YYYY-MM' */
export const zMonth = z
  .union([z.string(), z.date()])
  .transform((v) => (typeof v === "string" ? v.slice(0, 7) : v.toISOString().slice(0, 7)));

/** DATE/TIMESTAMP/string → 'YYYY-MM-DD' */
export const zDate = z
  .union([z.string(), z.date()])
  .transform((v) => (typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10)));

export const zDateOrNull = z
  .union([z.string(), z.date(), z.null()])
  .transform((v) =>
    v == null ? null : typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10),
  );

/** number | numeric string | null → number (null → 0) */
export const zNum = z
  .union([z.number(), z.string(), z.null()])
  .transform((v) => (v == null ? 0 : typeof v === "string" ? Number(v) : v));

export const zStr = z.string();
export const zStrOrNull = z.string().nullable();

/**
 * IDs (workspace_id, job_id) are strings in the app but may be BIGINT in the
 * deployed tables (e.g. workspace_mapping.workspace_id) — coerce to string.
 */
export const zId = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((v) => String(v));
export const zIdOrNull = z
  .union([z.string(), z.number(), z.bigint(), z.null()])
  .transform((v) => (v == null ? null : String(v)));
