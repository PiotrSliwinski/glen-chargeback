import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zDateOrNull, zId, zMonth, zNum, zStr, zStrOrNull } from "@/dal/parse";
import { scopesOverlap } from "@/lib/tag-rules";
import type { HealthReport, IntegrityViolation, ReconRow } from "@/dal/types";

/**
 * Health checks (Methodology §7.1 + §7.4 → §10.6).
 *
 * NOTE: the reconciliation query scans up to a year of system.billing.usage
 * and can run for minutes on a cold warehouse. It is cached ('health' tag,
 * warehouse lifetime) and refreshed explicitly from the health page's
 * "Re-run checks" button or by mutations — deliberately NOT by the global
 * "Refresh data" button, which would block its round trip on this scan. A
 * future iteration should move it to a scheduled Databricks Workflow writing
 * into an app_health_runs table (see implementation guide §11.1).
 */

export async function getReconciliation(): Promise<ReconRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("health");

  if (env.DAL_MOCK) return [...mockStore.recon].sort((a, b) => b.billing_month.localeCompare(a.billing_month));

  return query(
    `WITH billing_daily AS (
       SELECT u.usage_date, u.usage_unit,
              SUM(u.usage_quantity
                  * COALESCE(lp.pricing.effective_list.default, lp.pricing.default)) AS list_cost
       FROM system.billing.usage u
       LEFT JOIN system.billing.list_prices lp
         ON  u.sku_name = lp.sku_name
         AND u.cloud = lp.cloud
         AND lp.currency_code = 'USD'
         AND u.usage_start_time >= lp.price_start_time
         AND (lp.price_end_time IS NULL OR u.usage_start_time < lp.price_end_time)
       GROUP BY 1, 2
     ),
     -- DBU reservation discount, same as query_view/usage_view: join +
     -- re-aggregate so overlapping windows can never fan cost out, DBU rows only
     billing_truth AS (
       SELECT DATE_TRUNC('month', b.usage_date) AS billing_month,
              SUM(b.list_cost
                  * (1 - CASE WHEN b.usage_unit = 'DBU'
                              THEN COALESCE(b.discount_pct, 0) ELSE 0 END)) AS billing_cost
       FROM (
         SELECT b.usage_date, b.usage_unit, b.list_cost, MAX(d.discount_pct) AS discount_pct
         FROM billing_daily b
         LEFT JOIN ${T("dbu_discount_plan")} d
           ON  b.usage_date >= d.valid_from
           AND b.usage_date <= d.valid_to
         GROUP BY b.usage_date, b.usage_unit, b.list_cost
       ) b
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

/**
 * Azure counterpart of getReconciliation: the raw Azure bill (azure_usage_view
 * is a plain GROUP BY over azure_cleaned.amortized_costs, so its SUM equals the
 * source's) vs azure_cost_fact (attribution waterfall + split fan-out) vs
 * azure_monthly_chargeback (the rollup). A gap means the waterfall or a
 * multi-desk split is minting or losing Azure money. Informational — Azure is
 * never published, so gaps here do not block publication.
 */
export async function getAzureReconciliation(): Promise<ReconRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("health");

  if (env.DAL_MOCK) {
    return [...mockStore.azureRecon].sort((a, b) => b.billing_month.localeCompare(a.billing_month));
  }

  return query(
    `WITH billing_truth AS (
       SELECT DATE_TRUNC('month', usage_date) AS billing_month,
              SUM(total_cost) AS billing_cost
       FROM ${T("azure_usage_view")} GROUP BY 1
     ),
     fact_total AS (
       SELECT DATE_TRUNC('month', usage_date) AS billing_month, SUM(cost) AS fact_cost
       FROM ${T("azure_cost_fact")} GROUP BY 1
     ),
     report_total AS (
       SELECT billing_month, SUM(total_cost) AS report_cost
       FROM ${T("azure_monthly_chargeback")} GROUP BY 1
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

/**
 * §7.4 integrity checks, cached like every other warehouse read. Both tags
 * matter: catalogue mutations expire 'health', bridge-mapping mutations
 * expire 'mappings' (which the global "Refresh data" button also expires).
 */
export async function getIntegrityViolations(product?: string): Promise<IntegrityViolation[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("health", "mappings");
  return getIntegrityViolationsLive(product);
}

/**
 * Live §7.4 scan; optionally scoped to one product. The write-path
 * post-condition (productCatalogue.postCheck) calls this directly — it must
 * see the row written a moment ago, never a cached generation.
 */
export async function getIntegrityViolationsLive(
  product?: string,
): Promise<IntegrityViolation[]> {
  if (env.DAL_MOCK) return mockIntegrity(product);

  const violations: IntegrityViolation[] = [];
  const productFilter = product ? ` AND a.data_product = :product` : "";
  const params: Record<string, string> = product ? { product } : {};

  // overlap is per (product, desk): concurrent rows for DIFFERENT desks are
  // a legitimate multi-desk split, not a violation
  const overlaps = await query(
    `SELECT a.data_product, a.desk, a.valid_from, a.valid_to, b.valid_from AS conflicting_from
     FROM ${T("data_product_mapping")} a
     JOIN ${T("data_product_mapping")} b
       ON  a.data_product = b.data_product
       AND a.desk = b.desk
       AND a.valid_from < b.valid_from
       AND COALESCE(a.valid_to, DATE '9999-12-31') > b.valid_from${productFilter}`,
    params,
    z.object({
      data_product: zStr,
      desk: zStr,
      valid_from: zDateOrNull,
      valid_to: zDateOrNull,
      conflicting_from: zDateOrNull,
    }),
  );
  for (const o of overlaps) {
    violations.push({
      check: "overlap",
      detail: `${o.data_product} (desk ${o.desk}): window from ${o.valid_from} overlaps window starting ${o.conflicting_from}`,
    });
  }

  // split shares of one validity window must sum to 1 — otherwise cost_fact
  // mints or loses money on every row of the product (§7.1 invariant)
  const splitSums = await query(
    `SELECT a.data_product, a.valid_from, SUM(COALESCE(a.cost_split_pct, 1.0)) AS split_sum
     FROM ${T("data_product_mapping")} a
     ${product ? "WHERE a.data_product = :product" : ""}
     GROUP BY a.data_product, a.valid_from, a.valid_to
     HAVING ABS(SUM(COALESCE(a.cost_split_pct, 1.0)) - 1.0) > 0.001`,
    params,
    z.object({ data_product: zStr, valid_from: zDateOrNull, split_sum: zNum }),
  );
  for (const s of splitSums) {
    violations.push({
      check: "split_sum",
      detail: `${s.data_product}: desk shares of the window starting ${s.valid_from} sum to ${(s.split_sum * 100).toFixed(2)}% — must be 100%`,
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
       WHERE data_product NOT IN (SELECT data_product FROM ${T("data_product_mapping")})
       UNION ALL
       SELECT 'endpoint_product_mapping', data_product FROM ${T("endpoint_product_mapping")}
       WHERE data_product NOT IN (SELECT data_product FROM ${T("data_product_mapping")})
       UNION ALL
       SELECT 'pipeline_product_mapping', data_product FROM ${T("pipeline_product_mapping")}
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

    const endpointDupes = await query(
      `SELECT workspace_id, endpoint_name, COUNT(*) AS c FROM ${T("endpoint_product_mapping")}
       GROUP BY 1, 2 HAVING COUNT(*) > 1`,
      {},
      z.object({ workspace_id: zId, endpoint_name: zStr, c: zNum }),
    );
    for (const d of endpointDupes) {
      violations.push({
        check: "duplicate_bridge_key",
        detail: `endpoint_product_mapping has ${d.c} rows for (workspace ${d.workspace_id}, endpoint ${d.endpoint_name})`,
      });
    }

    const pipelineDupes = await query(
      `SELECT workspace_id, pipeline_id, COUNT(*) AS c FROM ${T("pipeline_product_mapping")}
       GROUP BY 1, 2 HAVING COUNT(*) > 1`,
      {},
      z.object({ workspace_id: zId, pipeline_id: zStr, c: zNum }),
    );
    for (const d of pipelineDupes) {
      violations.push({
        check: "duplicate_bridge_key",
        detail: `pipeline_product_mapping has ${d.c} rows for (workspace ${d.workspace_id}, pipeline ${d.pipeline_id})`,
      });
    }

    // conflicting rules: same tag key=value with OVERLAPPING scopes (same
    // scope twice, or a scoped rule next to a 'both' rule — they can match
    // the same record), or the same runner twice — the facts resolve them
    // deterministically, but the intent is ambiguous and must be fixed
    // before publication. One databricks + one azure rule on the same
    // key=value is fine: they can never match the same record.
    const ruleDupes = await query(
      `SELECT CONCAT('tag ', tag_key, '=', tag_value) AS rule_key, COUNT(*) AS c
       FROM ${T("tag_product_mapping")}
       GROUP BY tag_key, tag_value
       HAVING COUNT(*) > 1
          AND NOT (SUM(CASE WHEN scope = 'both' THEN 1 ELSE 0 END) = 0
               AND SUM(CASE WHEN scope = 'databricks' THEN 1 ELSE 0 END) <= 1
               AND SUM(CASE WHEN scope = 'azure' THEN 1 ELSE 0 END) <= 1)
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

    // DBU reservation windows must not overlap (both ends inclusive) — the
    // views resolve overlaps deterministically (deepest discount wins), but
    // the intended rate is ambiguous. Duplicate windows count as overlaps.
    const discountOverlaps = await query(
      `SELECT a.valid_from, a.valid_to, b.valid_from AS conflicting_from
       FROM ${T("dbu_discount_plan")} a
       JOIN ${T("dbu_discount_plan")} b
         ON  a.valid_from < b.valid_from
         AND a.valid_to  >= b.valid_from
       UNION ALL
       SELECT valid_from, valid_to, valid_from
       FROM ${T("dbu_discount_plan")}
       GROUP BY valid_from, valid_to HAVING COUNT(*) > 1`,
      {},
      z.object({ valid_from: zDateOrNull, valid_to: zDateOrNull, conflicting_from: zDateOrNull }),
    );
    for (const o of discountOverlaps) {
      violations.push({
        check: "discount_overlap",
        detail:
          o.valid_from === o.conflicting_from
            ? `dbu_discount_plan: duplicate windows ${o.valid_from} → ${o.valid_to}`
            : `dbu_discount_plan: window ${o.valid_from} → ${o.valid_to} overlaps window starting ${o.conflicting_from}`,
      });
    }

    const discountRanges = await query(
      `SELECT valid_from, valid_to, discount_pct FROM ${T("dbu_discount_plan")}
       WHERE discount_pct <= 0 OR discount_pct > 1 OR valid_to < valid_from`,
      {},
      z.object({ valid_from: zDateOrNull, valid_to: zDateOrNull, discount_pct: zNum }),
    );
    for (const r of discountRanges) {
      violations.push({
        check: "discount_range",
        detail: `dbu_discount_plan: window ${r.valid_from} → ${r.valid_to} with discount_pct=${r.discount_pct} — must be a 0–1 fraction and valid_to ≥ valid_from`,
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

  // overlap is per (product, desk): concurrent rows for DIFFERENT desks are
  // a legitimate multi-desk split, not a violation
  const byProductDesk = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.data_product}|${r.desk}`;
    byProductDesk.set(key, [...(byProductDesk.get(key) ?? []), r]);
  }
  for (const versions of byProductDesk.values()) {
    const sorted = [...versions].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    for (let i = 0; i < sorted.length - 1; i++) {
      const endsAt = sorted[i].valid_to ?? "9999-12-31";
      if (endsAt > sorted[i + 1].valid_from) {
        violations.push({
          check: "overlap",
          detail: `${sorted[i].data_product} (desk ${sorted[i].desk}): window from ${sorted[i].valid_from} overlaps window starting ${sorted[i + 1].valid_from}`,
        });
      }
    }
  }

  // split shares of one validity window must sum to 1 (§7.1 invariant)
  const byWindow = new Map<string, { product: string; from: string; sum: number }>();
  for (const r of rows) {
    const key = `${r.data_product}|${r.valid_from}|${r.valid_to ?? ""}`;
    const w = byWindow.get(key) ?? { product: r.data_product, from: r.valid_from, sum: 0 };
    w.sum += r.cost_split_pct;
    byWindow.set(key, w);
  }
  for (const w of byWindow.values()) {
    if (Math.abs(w.sum - 1) > 0.001) {
      violations.push({
        check: "split_sum",
        detail: `${w.product}: desk shares of the window starting ${w.from} sum to ${(w.sum * 100).toFixed(2)}% — must be 100%`,
      });
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
    // same key=value with overlapping scopes = conflict (a databricks rule
    // next to an azure rule is fine — they can never match the same record)
    const flaggedTagRules = new Set<string>();
    for (let i = 0; i < mockStore.tagRules.length; i++) {
      for (let j = i + 1; j < mockStore.tagRules.length; j++) {
        const a = mockStore.tagRules[i];
        const b = mockStore.tagRules[j];
        const key = `${a.tag_key}=${a.tag_value}`;
        if (
          a.tag_key === b.tag_key &&
          a.tag_value === b.tag_value &&
          scopesOverlap(a.scope, b.scope) &&
          !flaggedTagRules.has(key)
        ) {
          flaggedTagRules.add(key);
          violations.push({
            check: "duplicate_rule_key",
            detail: `several rules for tag ${key} with overlapping scopes — ambiguous, deterministic tie-break applies until fixed`,
          });
        }
      }
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
    const seenEndpoints = new Set<string>();
    for (const e of mockStore.endpointMappings) {
      if (!known.has(e.data_product))
        violations.push({
          check: "orphan_product",
          detail: `endpoint_product_mapping references unknown product '${e.data_product}'`,
        });
      const key = `${e.workspace_id}|${e.endpoint_name}`;
      if (seenEndpoints.has(key))
        violations.push({
          check: "duplicate_bridge_key",
          detail: `endpoint_product_mapping has duplicate rows for (workspace ${e.workspace_id}, endpoint ${e.endpoint_name})`,
        });
      seenEndpoints.add(key);
    }
    const seenPipelines = new Set<string>();
    for (const p of mockStore.pipelineMappings) {
      if (!known.has(p.data_product))
        violations.push({
          check: "orphan_product",
          detail: `pipeline_product_mapping references unknown product '${p.data_product}'`,
        });
      const key = `${p.workspace_id}|${p.pipeline_id}`;
      if (seenPipelines.has(key))
        violations.push({
          check: "duplicate_bridge_key",
          detail: `pipeline_product_mapping has duplicate rows for (workspace ${p.workspace_id}, pipeline ${p.pipeline_id})`,
        });
      seenPipelines.add(key);
    }

    // DBU reservation windows: no overlaps (both ends inclusive), sane rates
    const discounts = [...mockStore.dbuDiscounts].sort((a, b) =>
      a.valid_from.localeCompare(b.valid_from),
    );
    for (let i = 0; i < discounts.length - 1; i++) {
      if (discounts[i].valid_to >= discounts[i + 1].valid_from) {
        violations.push({
          check: "discount_overlap",
          detail: `dbu_discount_plan: window ${discounts[i].valid_from} → ${discounts[i].valid_to} overlaps window starting ${discounts[i + 1].valid_from}`,
        });
      }
    }
    for (const d of discounts) {
      if (d.discount_pct <= 0 || d.discount_pct > 1 || d.valid_to < d.valid_from) {
        violations.push({
          check: "discount_range",
          detail: `dbu_discount_plan: window ${d.valid_from} → ${d.valid_to} with discount_pct=${d.discount_pct} — must be a 0–1 fraction and valid_to ≥ valid_from`,
        });
      }
    }
  }
  return violations;
}

export async function getHealthReport(): Promise<HealthReport> {
  const [recon, azureRecon, violations] = await Promise.all([
    getReconciliation(),
    getAzureReconciliation(),
    getIntegrityViolations(),
  ]);
  return { recon, azureRecon, violations };
}

/**
 * Publication gate (Methodology §10.6). Takes only what it evaluates, so
 * the publish action can feed it LIVE integrity results (cheap queries)
 * alongside the cached reconciliation (a minutes-long scan whose cache is
 * expired by every mutation that could move it).
 */
export function isPublishable(
  report: Pick<HealthReport, "recon" | "violations">,
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
