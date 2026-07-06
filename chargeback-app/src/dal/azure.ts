import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { monthStart } from "@/lib/format";
import { exec, query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zMonth, zNum, zStr, zStrOrNull } from "@/dal/parse";
import type {
  AzureDeskTotalRow,
  AzureMethodMixRow,
  AzureMonthResourceRow,
  AzureMonthlyRow,
  AzureResourceAttributionRow,
  AzureResourceMappingRow,
  AzureRgRuleRow,
  AzureSubscriptionRuleRow,
  AzureTagRuleRow,
  AzureTrendPoint,
} from "@/dal/types";

/**
 * Azure attribution: the four Azure rule tables (setup.sql §4A) and the
 * coverage reads over azure_cost_fact (§6A). Same shape as dal/mappings —
 * plain persistence, cached under 'azure'; every write stamps mapped_by /
 * mapped_at. Rules point at the SHARED product catalogue, so desk/domain
 * and multi-desk splits derive from data_product_mapping like everywhere.
 * ARM identifiers are lowercased at the write boundary — azure_usage_view
 * lowercases the fact side, so the join only works if rules match.
 */

const now = () => new Date().toISOString();

/** ARM ids and subscription GUIDs are case-insensitive — store lowercase. */
const arm = (s: string) => s.trim().toLowerCase();

// ============================== reads ==============================

export async function listAzureResourceMappings(): Promise<AzureResourceMappingRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) return [...mockStore.azureResourceMappings];
  return query(
    `SELECT resource_id, data_product, note, mapped_by, mapped_at
     FROM ${T("azure_resource_product_mapping")} ORDER BY resource_id`,
    {},
    z.object({
      resource_id: zStr,
      data_product: zStr,
      note: zStrOrNull,
      mapped_by: zStrOrNull,
      mapped_at: zStrOrNull,
    }) as z.ZodType<AzureResourceMappingRow>,
  );
}

export async function listAzureTagRules(): Promise<AzureTagRuleRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) return [...mockStore.azureTagRules];
  return query(
    `SELECT tag_key, tag_value, data_product, note, mapped_by, mapped_at
     FROM ${T("azure_tag_product_mapping")} ORDER BY tag_key, tag_value`,
    {},
    z.object({
      tag_key: zStr,
      tag_value: zStr,
      data_product: zStr,
      note: zStrOrNull,
      mapped_by: zStrOrNull,
      mapped_at: zStrOrNull,
    }) as z.ZodType<AzureTagRuleRow>,
  );
}

export async function listAzureRgRules(): Promise<AzureRgRuleRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) return [...mockStore.azureRgRules];
  return query(
    `SELECT subscription_id, resource_group, data_product, note, mapped_by, mapped_at
     FROM ${T("azure_rg_product_mapping")} ORDER BY subscription_id, resource_group`,
    {},
    z.object({
      subscription_id: zStr,
      resource_group: zStr,
      data_product: zStr,
      note: zStrOrNull,
      mapped_by: zStrOrNull,
      mapped_at: zStrOrNull,
    }) as z.ZodType<AzureRgRuleRow>,
  );
}

export async function listAzureSubscriptionRules(): Promise<AzureSubscriptionRuleRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) return [...mockStore.azureSubscriptionRules];
  return query(
    `SELECT subscription_id, data_product, note, mapped_by, mapped_at
     FROM ${T("azure_subscription_product_mapping")} ORDER BY subscription_id`,
    {},
    z.object({
      subscription_id: zStr,
      data_product: zStr,
      note: zStrOrNull,
      mapped_by: zStrOrNull,
      mapped_at: zStrOrNull,
    }) as z.ZodType<AzureSubscriptionRuleRow>,
  );
}

/**
 * Attribution outcome for every Azure resource with cost in the trailing
 * 30 days: one row per (resource, method, product) — a resource bridge-mapped
 * mid-window and then tagged at source shows both rows, like jobs.
 */
export async function getAzureResourceAttributions(): Promise<AzureResourceAttributionRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) return [...mockStore.azureAttributions];
  return query(
    // tags_json: the slice's costliest row's tags — what the tag rules saw
    `SELECT subscription_id, resource_group, resource_id,
            MAX(resource_name) AS resource_name,
            MAX_BY(meter_category, cost) AS meter_category,
            attribution_method, data_product, desk,
            MAX_BY(tags_json, cost) AS tags_json,
            SUM(cost) AS cost_30d
     FROM ${T("azure_cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
       AND resource_id IS NOT NULL
     GROUP BY subscription_id, resource_group, resource_id,
              attribution_method, data_product, desk
     ORDER BY cost_30d DESC LIMIT 500`,
    {},
    z.object({
      subscription_id: zStr,
      resource_group: zStrOrNull,
      resource_id: zStr,
      resource_name: zStrOrNull,
      meter_category: zStrOrNull,
      attribution_method: zStr,
      data_product: zStr,
      desk: zStr,
      tags_json: zStrOrNull,
      cost_30d: zNum,
    }) as z.ZodType<AzureResourceAttributionRow>,
  );
}

/** Trailing-30-day Azure cost per desk — UNALLOCATED = not yet claimed. */
export async function getAzureDeskTotals(): Promise<AzureDeskTotalRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) {
    const map = new Map<string, number>();
    for (const a of mockStore.azureAttributions) {
      map.set(a.desk, (map.get(a.desk) ?? 0) + a.cost_30d);
    }
    return [...map.entries()]
      .map(([desk, cost_30d]) => ({ desk, cost_30d }))
      .sort((a, b) => b.cost_30d - a.cost_30d);
  }
  return query(
    `SELECT desk, SUM(cost) AS cost_30d
     FROM ${T("azure_cost_fact")}
     WHERE usage_date >= current_date() - INTERVAL 30 DAYS
     GROUP BY desk ORDER BY cost_30d DESC`,
    {},
    z.object({ desk: zStr, cost_30d: zNum }) as z.ZodType<AzureDeskTotalRow>,
  );
}

// ==================== cost monitoring reads (/azure) ====================
// Month-scoped rollups over azure_monthly_chargeback / azure_cost_fact for
// the Azure cost screen. Azure never enters the published snapshot, so all
// of these are live-only — no mode parameter. Cached under 'azure' so rule
// edits (which re-attribute cost) refresh the screen immediately.

/** Scale the (≈ one month) Azure fixtures by the shared mock month factor. */
const azureMockScale = (month: string) => mockStore.monthFactor[month] ?? 0;

/** Months with any Azure cost, newest first — feeds the /azure month picker. */
export async function getAzureMonths(): Promise<string[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) return [...mockStore.months].reverse();
  const rows = await query(
    `SELECT DISTINCT billing_month FROM ${T("azure_monthly_chargeback")} ORDER BY 1 DESC`,
    {},
    z.object({ billing_month: zMonth }),
  );
  return rows.map((r) => r.billing_month);
}

/** One month of Azure cost at product × desk × meter-category grain. */
export async function getAzureMonthlyRows(month: string): Promise<AzureMonthlyRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) {
    const f = azureMockScale(month);
    const map = new Map<string, AzureMonthlyRow & { resources: Set<string> }>();
    for (const a of mockStore.azureAttributions) {
      const category = a.meter_category ?? "Other";
      const key = `${a.data_product}|${a.desk}|${category}`;
      const e = map.get(key) ?? {
        data_product: a.data_product,
        desk: a.desk,
        usage_category: category,
        distinct_resources: 0,
        total_cost: 0,
        resources: new Set<string>(),
      };
      e.resources.add(a.resource_id);
      e.total_cost += Math.round(a.cost_30d * f * 100) / 100;
      map.set(key, e);
    }
    return [...map.values()]
      .map(({ resources, ...row }) => ({ ...row, distinct_resources: resources.size }))
      .filter((r) => r.total_cost > 0)
      .sort((a, b) => b.total_cost - a.total_cost);
  }
  return query(
    `SELECT data_product, desk,
            COALESCE(usage_category, 'Other') AS usage_category,
            SUM(distinct_resources) AS distinct_resources,
            SUM(total_cost) AS total_cost
     FROM ${T("azure_monthly_chargeback")}
     WHERE billing_month = :month
     GROUP BY 1, 2, 3 ORDER BY total_cost DESC`,
    { month: monthStart(month) },
    z.object({
      data_product: zStr,
      desk: zStr,
      usage_category: zStr,
      distinct_resources: zNum,
      total_cost: zNum,
    }) as z.ZodType<AzureMonthlyRow>,
  );
}

/** Azure cost per month × desk, trailing 12 months — the Azure trend feed. */
export async function getAzureTrend(month: string): Promise<AzureTrendPoint[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) {
    const window = mockStore.months.filter((m) => m <= month).slice(-12);
    return window.flatMap((m) => {
      const f = azureMockScale(m);
      const byDesk = new Map<string, number>();
      for (const a of mockStore.azureAttributions) {
        byDesk.set(a.desk, (byDesk.get(a.desk) ?? 0) + Math.round(a.cost_30d * f * 100) / 100);
      }
      return [...byDesk.entries()]
        .filter(([, cost]) => cost > 0)
        .map(([desk, total_cost]) => ({ billing_month: m, desk, total_cost }));
    });
  }
  return query(
    `SELECT billing_month, desk, SUM(total_cost) AS total_cost
     FROM ${T("azure_monthly_chargeback")}
     WHERE billing_month > add_months(:month, -12) AND billing_month <= :month
     GROUP BY 1, 2 ORDER BY 1`,
    { month: monthStart(month) },
    z.object({
      billing_month: zMonth,
      desk: zStr,
      total_cost: zNum,
    }) as z.ZodType<AzureTrendPoint>,
  );
}

/** The month's Azure cost per attribution method — is TAG growing, NONE shrinking? */
export async function getAzureMethodMix(month: string): Promise<AzureMethodMixRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) {
    const f = azureMockScale(month);
    const map = new Map<string, number>();
    for (const a of mockStore.azureAttributions) {
      map.set(
        a.attribution_method,
        (map.get(a.attribution_method) ?? 0) + Math.round(a.cost_30d * f * 100) / 100,
      );
    }
    return [...map.entries()]
      .filter(([, cost]) => cost > 0)
      .map(([attribution_method, cost]) => ({ attribution_method, cost }) as AzureMethodMixRow)
      .sort((a, b) => b.cost - a.cost);
  }
  return query(
    `SELECT attribution_method, SUM(cost) AS cost
     FROM ${T("azure_cost_fact")}
     WHERE usage_date >= :month AND usage_date < add_months(:month, 1)
     GROUP BY 1 ORDER BY cost DESC`,
    { month: monthStart(month) },
    z.object({ attribution_method: zStr, cost: zNum }) as z.ZodType<AzureMethodMixRow>,
  );
}

/**
 * The month's Azure cost per resource — one row per (resource, method,
 * product, desk), so a resource that changed attribution mid-month shows
 * one row per method, like the coverage audit.
 */
export async function getAzureMonthResources(month: string): Promise<AzureMonthResourceRow[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) {
    const f = azureMockScale(month);
    return mockStore.azureAttributions
      .map((a) => ({
        subscription_id: a.subscription_id,
        resource_group: a.resource_group,
        resource_id: a.resource_id,
        resource_name: a.resource_name,
        meter_category: a.meter_category,
        attribution_method: a.attribution_method,
        data_product: a.data_product,
        desk: a.desk,
        cost: Math.round(a.cost_30d * f * 100) / 100,
      }))
      .filter((r) => r.cost > 0)
      .sort((a, b) => b.cost - a.cost);
  }
  return query(
    `SELECT subscription_id, resource_group, resource_id,
            MAX(resource_name) AS resource_name,
            MAX_BY(meter_category, cost) AS meter_category,
            attribution_method, data_product, desk,
            SUM(cost) AS cost
     FROM ${T("azure_cost_fact")}
     WHERE usage_date >= :month AND usage_date < add_months(:month, 1)
       AND resource_id IS NOT NULL
     GROUP BY subscription_id, resource_group, resource_id,
              attribution_method, data_product, desk
     ORDER BY cost DESC LIMIT 500`,
    { month: monthStart(month) },
    z.object({
      subscription_id: zStr,
      resource_group: zStrOrNull,
      resource_id: zStr,
      resource_name: zStrOrNull,
      meter_category: zStrOrNull,
      attribution_method: zStr,
      data_product: zStr,
      desk: zStr,
      cost: zNum,
    }) as z.ZodType<AzureMonthResourceRow>,
  );
}

export interface TaggedAzureBridgeResource {
  resource_id: string;
  data_product: string;
  tagged_cost_30d: number;
}

/**
 * Janitor: bridge rows whose resources now emit TAG-attributed cost — the
 * data_product tag has landed at source, the bridge row is redundant.
 */
export async function getTaggedAzureBridgeResources(): Promise<TaggedAzureBridgeResource[]> {
  "use cache";
  cacheLife("warehouse");
  cacheTag("azure");
  if (env.DAL_MOCK) {
    const tagged = new Map<string, number>();
    for (const a of mockStore.azureAttributions) {
      if (a.attribution_method === "TAG") {
        tagged.set(a.resource_id, (tagged.get(a.resource_id) ?? 0) + a.cost_30d);
      }
    }
    return mockStore.azureResourceMappings
      .filter((m) => tagged.has(m.resource_id))
      .map((m) => ({
        resource_id: m.resource_id,
        data_product: m.data_product,
        tagged_cost_30d: tagged.get(m.resource_id)!,
      }));
  }
  return query(
    `SELECT rm.resource_id, rm.data_product, SUM(cf.cost) AS tagged_cost_30d
     FROM ${T("azure_resource_product_mapping")} rm
     JOIN ${T("azure_cost_fact")} cf
       ON  cf.resource_id = lower(rm.resource_id)
       AND cf.attribution_method = 'TAG'
       AND cf.usage_date >= current_date() - INTERVAL 30 DAYS
     GROUP BY 1, 2 ORDER BY tagged_cost_30d DESC`,
    {},
    z.object({
      resource_id: zStr,
      data_product: zStr,
      tagged_cost_30d: zNum,
    }) as z.ZodType<TaggedAzureBridgeResource>,
  );
}

// ============================== writes ==============================

/**
 * Desk of a product's active catalogue row — mock re-attribution helper.
 * Split products use the primary desk (largest share), same as dal/mappings.
 */
function mockActiveDesk(data_product: string): string {
  const actives = mockStore.catalogue.filter(
    (c) => c.data_product === data_product && c.valid_to == null,
  );
  return actives.sort((a, b) => b.cost_split_pct - a.cost_split_pct)[0]?.desk ?? "UNALLOCATED";
}

export async function insertAzureResourceMapping(
  row: { resource_id: string; data_product: string; note: string | null },
  actor: string,
): Promise<void> {
  const resource_id = arm(row.resource_id);
  if (env.DAL_MOCK) {
    mockStore.azureResourceMappings.push({
      ...row,
      resource_id,
      mapped_by: actor,
      mapped_at: now(),
    });
    // azure_cost_fact is a view — the resource's NONE rows re-attribute
    const desk = mockActiveDesk(row.data_product);
    for (const a of mockStore.azureAttributions) {
      if (a.resource_id === resource_id && a.attribution_method === "NONE") {
        a.attribution_method = "RESOURCE_MAPPING";
        a.data_product = row.data_product;
        a.desk = desk;
      }
    }
    return;
  }
  await exec(
    `INSERT INTO ${T("azure_resource_product_mapping")}
       (resource_id, data_product, note, mapped_by, mapped_at)
     VALUES (:resource_id, :data_product, :note, :actor, current_timestamp())`,
    { resource_id, data_product: row.data_product, note: row.note, actor },
  );
}

/** OR-chain over resource ids + named params — bulk WHERE clause. */
function resourceKeyPredicate(ids: string[]): { where: string; params: Record<string, string> } {
  return {
    where: ids.map((_, i) => `lower(resource_id) = :r_${i}`).join(" OR "),
    params: Object.fromEntries(ids.map((id, i) => [`r_${i}`, arm(id)])),
  };
}

export async function deleteAzureResourceMapping(resource_id: string): Promise<void> {
  await deleteAzureResourceMappings([resource_id]);
}

/** Bulk delete in one statement — Databricks guarantees per-statement atomicity only. */
export async function deleteAzureResourceMappings(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (env.DAL_MOCK) {
    const wanted = new Set(ids.map(arm));
    mockStore.azureResourceMappings = mockStore.azureResourceMappings.filter(
      (m) => !wanted.has(m.resource_id),
    );
    // without the bridge rows, RESOURCE_MAPPING attributions recompute to NONE
    for (const a of mockStore.azureAttributions) {
      if (wanted.has(a.resource_id) && a.attribution_method === "RESOURCE_MAPPING") {
        a.attribution_method = "NONE";
        a.data_product = "UNALLOCATED";
        a.desk = "UNALLOCATED";
      }
    }
    return;
  }
  const { where, params } = resourceKeyPredicate(ids);
  await exec(`DELETE FROM ${T("azure_resource_product_mapping")} WHERE ${where}`, params);
}

/** Point existing bridge rows at a new product in one atomic UPDATE. */
export async function remapAzureResources(
  ids: string[],
  data_product: string,
  note: string | null,
  actor: string,
): Promise<void> {
  if (ids.length === 0) return;
  if (env.DAL_MOCK) {
    const wanted = new Set(ids.map(arm));
    for (const m of mockStore.azureResourceMappings) {
      if (!wanted.has(m.resource_id)) continue;
      m.data_product = data_product;
      m.note = note;
      m.mapped_by = actor;
      m.mapped_at = now();
    }
    const desk = mockActiveDesk(data_product);
    for (const a of mockStore.azureAttributions) {
      if (wanted.has(a.resource_id) && a.attribution_method === "RESOURCE_MAPPING") {
        a.data_product = data_product;
        a.desk = desk;
      }
    }
    return;
  }
  const { where, params } = resourceKeyPredicate(ids);
  await exec(
    `UPDATE ${T("azure_resource_product_mapping")}
     SET data_product = :data_product, note = :note,
         mapped_by = :actor, mapped_at = current_timestamp()
     WHERE ${where}`,
    { ...params, data_product, note, actor },
  );
}

export async function insertAzureTagRule(
  row: { tag_key: string; tag_value: string; data_product: string; note: string | null },
  actor: string,
): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.azureTagRules.push({ ...row, mapped_by: actor, mapped_at: now() });
    // NONE rows whose resource tags carry key=value re-attribute
    const desk = mockActiveDesk(row.data_product);
    for (const a of mockStore.azureAttributions) {
      if (a.attribution_method !== "NONE" || !a.tags_json) continue;
      let tags: Record<string, string>;
      try {
        tags = JSON.parse(a.tags_json);
      } catch {
        continue;
      }
      if (tags[row.tag_key] === row.tag_value) {
        a.attribution_method = "TAG_RULE";
        a.data_product = row.data_product;
        a.desk = desk;
      }
    }
    return;
  }
  await exec(
    `INSERT INTO ${T("azure_tag_product_mapping")}
       (tag_key, tag_value, data_product, note, mapped_by, mapped_at)
     VALUES (:tag_key, :tag_value, :data_product, :note, :actor, current_timestamp())`,
    { ...row, actor },
  );
}

export async function deleteAzureTagRule(tag_key: string, tag_value: string): Promise<void> {
  if (env.DAL_MOCK) {
    const rule = mockStore.azureTagRules.find(
      (r) => r.tag_key === tag_key && r.tag_value === tag_value,
    );
    mockStore.azureTagRules = mockStore.azureTagRules.filter(
      (r) => !(r.tag_key === tag_key && r.tag_value === tag_value),
    );
    // rows the rule carried fall back to NONE
    for (const a of mockStore.azureAttributions) {
      if (a.attribution_method === "TAG_RULE" && a.data_product === rule?.data_product) {
        a.attribution_method = "NONE";
        a.data_product = "UNALLOCATED";
        a.desk = "UNALLOCATED";
      }
    }
    return;
  }
  await exec(
    `DELETE FROM ${T("azure_tag_product_mapping")}
     WHERE tag_key = :tag_key AND tag_value = :tag_value`,
    { tag_key, tag_value },
  );
}

export async function insertAzureRgRule(
  row: {
    subscription_id: string;
    resource_group: string;
    data_product: string;
    note: string | null;
  },
  actor: string,
): Promise<void> {
  const subscription_id = arm(row.subscription_id);
  const resource_group = arm(row.resource_group);
  if (env.DAL_MOCK) {
    mockStore.azureRgRules.push({
      ...row,
      subscription_id,
      resource_group,
      mapped_by: actor,
      mapped_at: now(),
    });
    const desk = mockActiveDesk(row.data_product);
    for (const a of mockStore.azureAttributions) {
      if (
        a.attribution_method === "NONE" &&
        a.subscription_id === subscription_id &&
        a.resource_group === resource_group
      ) {
        a.attribution_method = "RESOURCE_GROUP";
        a.data_product = row.data_product;
        a.desk = desk;
      }
    }
    return;
  }
  await exec(
    `INSERT INTO ${T("azure_rg_product_mapping")}
       (subscription_id, resource_group, data_product, note, mapped_by, mapped_at)
     VALUES (:subscription_id, :resource_group, :data_product, :note, :actor,
             current_timestamp())`,
    { subscription_id, resource_group, data_product: row.data_product, note: row.note, actor },
  );
}

export async function deleteAzureRgRule(
  subscription_id: string,
  resource_group: string,
): Promise<void> {
  const sub = arm(subscription_id);
  const rg = arm(resource_group);
  if (env.DAL_MOCK) {
    mockStore.azureRgRules = mockStore.azureRgRules.filter(
      (r) => !(r.subscription_id === sub && r.resource_group === rg),
    );
    for (const a of mockStore.azureAttributions) {
      if (
        a.attribution_method === "RESOURCE_GROUP" &&
        a.subscription_id === sub &&
        a.resource_group === rg
      ) {
        a.attribution_method = "NONE";
        a.data_product = "UNALLOCATED";
        a.desk = "UNALLOCATED";
      }
    }
    return;
  }
  await exec(
    `DELETE FROM ${T("azure_rg_product_mapping")}
     WHERE lower(subscription_id) = :subscription_id
       AND lower(resource_group) = :resource_group`,
    { subscription_id: sub, resource_group: rg },
  );
}

export async function insertAzureSubscriptionRule(
  row: { subscription_id: string; data_product: string; note: string | null },
  actor: string,
): Promise<void> {
  const subscription_id = arm(row.subscription_id);
  if (env.DAL_MOCK) {
    mockStore.azureSubscriptionRules.push({
      ...row,
      subscription_id,
      mapped_by: actor,
      mapped_at: now(),
    });
    const desk = mockActiveDesk(row.data_product);
    for (const a of mockStore.azureAttributions) {
      if (a.attribution_method === "NONE" && a.subscription_id === subscription_id) {
        a.attribution_method = "SUBSCRIPTION";
        a.data_product = row.data_product;
        a.desk = desk;
      }
    }
    return;
  }
  await exec(
    `INSERT INTO ${T("azure_subscription_product_mapping")}
       (subscription_id, data_product, note, mapped_by, mapped_at)
     VALUES (:subscription_id, :data_product, :note, :actor, current_timestamp())`,
    { subscription_id, data_product: row.data_product, note: row.note, actor },
  );
}

export async function deleteAzureSubscriptionRule(subscription_id: string): Promise<void> {
  const sub = arm(subscription_id);
  if (env.DAL_MOCK) {
    mockStore.azureSubscriptionRules = mockStore.azureSubscriptionRules.filter(
      (r) => r.subscription_id !== sub,
    );
    for (const a of mockStore.azureAttributions) {
      if (a.attribution_method === "SUBSCRIPTION" && a.subscription_id === sub) {
        a.attribution_method = "NONE";
        a.data_product = "UNALLOCATED";
        a.desk = "UNALLOCATED";
      }
    }
    return;
  }
  await exec(
    `DELETE FROM ${T("azure_subscription_product_mapping")}
     WHERE lower(subscription_id) = :subscription_id`,
    { subscription_id: sub },
  );
}
