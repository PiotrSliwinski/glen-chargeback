import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zDateOrNull, zId, zMonth, zNum, zStr, zStrOrNull } from "@/dal/parse";
import type { HealthReport, IntegrityViolation, ReconRow } from "@/dal/types";

/**
 * Health checks (Methodology §7.1 + §7.4 → §10.6).
 *
 * NOTE: the reconciliation query scans up to a year of system.billing.usage
 * and can run for minutes on a cold warehouse. It is cached ('health' tag,
 * hours lifetime) and refreshed explicitly from the health page. A future
 * iteration should move it to a scheduled Databricks Workflow writing into
 * an app_health_runs table (see implementation guide §11.1).
 */

export async function getReconciliation(): Promise<ReconRow[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("health");

  if (env.DAL_MOCK) return [...mockStore.recon].sort((a, b) => b.billing_month.localeCompare(a.billing_month));

  return query(
    `WITH billing_truth AS (
       SELECT DATE_TRUNC('month', u.usage_date) AS billing_month,
              SUM(u.usage_quantity
                  * COALESCE(lp.pricing.effective_list.default, lp.pricing.default)) AS billing_cost
       FROM system.billing.usage u
       LEFT JOIN system.billing.list_prices lp
         ON  u.sku_name = lp.sku_name
         AND u.cloud = lp.cloud
         AND lp.currency_code = 'USD'
         AND u.usage_start_time >= lp.price_start_time
         AND (lp.price_end_time IS NULL OR u.usage_start_time < lp.price_end_time)
       GROUP BY 1
     ),
     fact_total AS (
       SELECT DATE_TRUNC('month', usage_date) AS billing_month, SUM(cost) AS fact_cost
       FROM ${T("cost_fact")} GROUP BY 1
     ),
     report_total AS (
       SELECT billing_month, SUM(total_cost) AS report_cost
       FROM ${T("monthly_chargeback")} GROUP BY 1
     )
     SELECT b.billing_month, b.billing_cost, f.fact_cost, r.report_cost,
            b.billing_cost - f.fact_cost   AS fact_gap,
            b.billing_cost - r.report_cost AS report_gap
     FROM billing_truth b
     LEFT JOIN fact_total  f USING (billing_month)
     LEFT JOIN report_total r USING (billing_month)
     ORDER BY 1 DESC`,
    {},
    z.object({
      billing_month: zMonth,
      billing_cost: zNum,
      fact_cost: zNum,
      report_cost: zNum,
      fact_gap: zNum,
      report_gap: zNum,
    }) as z.ZodType<ReconRow>,
  );
}

/** §7.4 integrity checks; optionally scoped to one product (post-condition use). */
export async function getIntegrityViolations(product?: string): Promise<IntegrityViolation[]> {
  if (env.DAL_MOCK) return mockIntegrity(product);

  const violations: IntegrityViolation[] = [];
  const productFilter = product ? ` AND a.data_product = :product` : "";
  const params: Record<string, string> = product ? { product } : {};

  const overlaps = await query(
    `SELECT a.data_product, a.valid_from, a.valid_to, b.valid_from AS conflicting_from
     FROM ${T("data_product_mapping")} a
     JOIN ${T("data_product_mapping")} b
       ON  a.data_product = b.data_product
       AND a.valid_from < b.valid_from
       AND COALESCE(a.valid_to, DATE '9999-12-31') > b.valid_from${productFilter}`,
    params,
    z.object({
      data_product: zStr,
      valid_from: zDateOrNull,
      valid_to: zDateOrNull,
      conflicting_from: zDateOrNull,
    }),
  );
  for (const o of overlaps) {
    violations.push({
      check: "overlap",
      detail: `${o.data_product}: window from ${o.valid_from} overlaps window starting ${o.conflicting_from}`,
    });
  }

  if (!product) {
    const orphans = await query(
      `SELECT 'job_product_mapping' AS src, data_product FROM ${T("job_product_mapping")}
       WHERE data_product NOT IN (SELECT data_product FROM ${T("data_product_mapping")})
       UNION ALL
       SELECT 'warehouse_product_mapping', data_product FROM ${T("warehouse_product_mapping")}
       WHERE data_product IS NOT NULL
         AND data_product NOT IN (SELECT data_product FROM ${T("data_product_mapping")})
       UNION ALL
       SELECT 'tag_product_mapping', data_product FROM ${T("tag_product_mapping")}
       WHERE data_product NOT IN (SELECT data_product FROM ${T("data_product_mapping")})
       UNION ALL
       SELECT 'runner_product_mapping', data_product FROM ${T("runner_product_mapping")}
       WHERE data_product NOT IN (SELECT data_product FROM ${T("data_product_mapping")})`,
      {},
      z.object({ src: zStr, data_product: zStrOrNull }),
    );
    for (const o of orphans) {
      violations.push({
        check: "orphan_product",
        detail: `${o.src} references unknown product '${o.data_product}'`,
      });
    }

    const dupes = await query(
      `SELECT workspace_id, job_id, COUNT(*) AS c FROM ${T("job_product_mapping")}
       GROUP BY 1, 2 HAVING COUNT(*) > 1`,
      {},
      z.object({ workspace_id: zId, job_id: zId, c: zNum }),
    );
    for (const d of dupes) {
      violations.push({
        check: "duplicate_bridge_key",
        detail: `job_product_mapping has ${d.c} rows for (workspace ${d.workspace_id}, job ${d.job_id})`,
      });
    }

    // conflicting rules: same tag key=value (or runner) pointing at several
    // products — cost_fact resolves them deterministically, but the intent
    // is ambiguous and must be fixed before publication
    const ruleDupes = await query(
      `SELECT CONCAT('tag ', tag_key, '=', tag_value) AS rule_key, COUNT(*) AS c
       FROM ${T("tag_product_mapping")}
       GROUP BY tag_key, tag_value HAVING COUNT(*) > 1
       UNION ALL
       SELECT CONCAT('runner ', user_id), COUNT(*)
       FROM ${T("runner_product_mapping")}
       GROUP BY user_id HAVING COUNT(*) > 1`,
      {},
      z.object({ rule_key: zStr, c: zNum }),
    );
    for (const d of ruleDupes) {
      violations.push({
        check: "duplicate_rule_key",
        detail: `${d.c} rules for ${d.rule_key} — ambiguous, deterministic tie-break applies until fixed`,
      });
    }

    const flags = await query(
      `SELECT warehouse_id, data_product, is_shared FROM ${T("warehouse_product_mapping")}
       WHERE (is_shared = false AND data_product IS NULL)
          OR (is_shared = true  AND data_product IS NOT NULL)`,
      {},
      z.object({ warehouse_id: zStr, data_product: zStrOrNull, is_shared: z.boolean() }),
    );
    for (const f of flags) {
      violations.push({
        check: "warehouse_flags",
        detail: `warehouse ${f.warehouse_id}: is_shared=${f.is_shared} with data_product=${f.data_product ?? "NULL"}`,
      });
    }
  }

  return violations;
}

function mockIntegrity(product?: string): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  const rows = product
    ? mockStore.catalogue.filter((r) => r.data_product === product)
    : mockStore.catalogue;

  const byProduct = new Map<string, typeof rows>();
  for (const r of rows) {
    byProduct.set(r.data_product, [...(byProduct.get(r.data_product) ?? []), r]);
  }
  for (const [p, versions] of byProduct) {
    const sorted = [...versions].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    for (let i = 0; i < sorted.length - 1; i++) {
      const endsAt = sorted[i].valid_to ?? "9999-12-31";
      if (endsAt > sorted[i + 1].valid_from) {
        violations.push({
          check: "overlap",
          detail: `${p}: window from ${sorted[i].valid_from} overlaps window starting ${sorted[i + 1].valid_from}`,
        });
      }
    }
  }

  if (!product) {
    const known = new Set(mockStore.catalogue.map((r) => r.data_product));
    for (const j of mockStore.jobMappings) {
      if (!known.has(j.data_product))
        violations.push({
          check: "orphan_product",
          detail: `job_product_mapping references unknown product '${j.data_product}'`,
        });
    }
    for (const r of mockStore.tagRules) {
      if (!known.has(r.data_product))
        violations.push({
          check: "orphan_product",
          detail: `tag_product_mapping references unknown product '${r.data_product}'`,
        });
    }
    for (const r of mockStore.runnerRules) {
      if (!known.has(r.data_product))
        violations.push({
          check: "orphan_product",
          detail: `runner_product_mapping references unknown product '${r.data_product}'`,
        });
    }
    const seenTagRules = new Set<string>();
    for (const r of mockStore.tagRules) {
      const key = `${r.tag_key}=${r.tag_value}`;
      if (seenTagRules.has(key))
        violations.push({
          check: "duplicate_rule_key",
          detail: `several rules for tag ${key} — ambiguous, deterministic tie-break applies until fixed`,
        });
      seenTagRules.add(key);
    }
    const seenRunnerRules = new Set<string>();
    for (const r of mockStore.runnerRules) {
      if (seenRunnerRules.has(r.user_id))
        violations.push({
          check: "duplicate_rule_key",
          detail: `several rules for runner ${r.user_id} — ambiguous, deterministic tie-break applies until fixed`,
        });
      seenRunnerRules.add(r.user_id);
    }
    for (const w of mockStore.warehouseMappings) {
      if (w.data_product && !known.has(w.data_product))
        violations.push({
          check: "orphan_product",
          detail: `warehouse_product_mapping references unknown product '${w.data_product}'`,
        });
      if ((!w.is_shared && !w.data_product) || (w.is_shared && w.data_product))
        violations.push({
          check: "warehouse_flags",
          detail: `warehouse ${w.warehouse_id}: is_shared=${w.is_shared} with data_product=${w.data_product ?? "NULL"}`,
        });
    }
    const seen = new Set<string>();
    for (const j of mockStore.jobMappings) {
      const key = `${j.workspace_id}|${j.job_id}`;
      if (seen.has(key))
        violations.push({
          check: "duplicate_bridge_key",
          detail: `job_product_mapping has duplicate rows for (workspace ${j.workspace_id}, job ${j.job_id})`,
        });
      seen.add(key);
    }
  }
  return violations;
}

export async function getHealthReport(): Promise<HealthReport> {
  const [recon, violations] = await Promise.all([
    getReconciliation(),
    getIntegrityViolations(),
  ]);
  return { recon, violations, ranAt: new Date().toISOString() };
}

/** Publication gate (Methodology §10.6). */
export function isPublishable(
  report: HealthReport,
  month: string,
  publishedMonths: string[],
  currentMonth: string,
): { publishable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const recon = report.recon.find((r) => r.billing_month === month);
  if (!recon) reasons.push("no reconciliation result for this month");
  else if (Math.abs(recon.report_gap) >= env.RECON_TOLERANCE_USD)
    reasons.push(
      `report gap $${recon.report_gap.toFixed(2)} exceeds tolerance $${env.RECON_TOLERANCE_USD}`,
    );
  if (report.violations.length > 0)
    reasons.push(`${report.violations.length} integrity violation(s) open`);
  if (month >= currentMonth) reasons.push("month is not closed yet");
  if (publishedMonths.includes(month)) reasons.push("month is already published");
  return { publishable: reasons.length === 0, reasons };
}
