import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { env } from "@/lib/env";
import { exec, query, T } from "@/dal/client";
import { mockStore } from "@/dal/mock";
import { zDate, zDateOrNull, zId, zStr, zStrOrNull } from "@/dal/parse";
import type {
  DataProductRow,
  JobMappingRow,
  RunnerRuleRow,
  TagRuleRow,
  UserMappingRow,
  WarehouseMappingRow,
  WorkspaceMappingRow,
} from "@/dal/types";

/**
 * The write surface of the whole system: the mapping tables (Methodology §4).
 * Reads are cached under 'catalogue' / 'mappings'; every write is stamped
 * with mapped_by / mapped_at. Business rules (versioning, integrity) live in
 * src/services — this module is plain persistence.
 */

// ============================== reads ==============================

export async function listCatalogue(): Promise<DataProductRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalogue");
  if (env.DAL_MOCK) {
    return [...mockStore.catalogue].sort(
      (a, b) =>
        a.data_product.localeCompare(b.data_product) || b.valid_from.localeCompare(a.valid_from),
    );
  }
  return query(
    `SELECT data_product, data_domain, desk, product_owner, valid_from, valid_to,
            mapped_by, mapped_at
     FROM ${T("data_product_mapping")}
     ORDER BY data_product, valid_from DESC`,
    {},
    z.object({
      data_product: zStr,
      data_domain: zStr,
      desk: zStr,
      product_owner: zStrOrNull,
      valid_from: zDate,
      valid_to: zDateOrNull,
      mapped_by: zStrOrNull,
      mapped_at: zStrOrNull,
    }) as z.ZodType<DataProductRow>,
  );
}

/** Active catalogue rows (valid today) — feeds product dropdowns. */
export async function listActiveProducts(): Promise<DataProductRow[]> {
  const all = await listCatalogue();
  const today = new Date().toISOString().slice(0, 10);
  return all.filter((r) => r.valid_from <= today && (!r.valid_to || r.valid_to > today));
}

export async function listJobMappings(): Promise<JobMappingRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("mappings");
  if (env.DAL_MOCK) return [...mockStore.jobMappings];
  return query(
    `SELECT workspace_id, job_id, data_product, note, mapped_by, mapped_at
     FROM ${T("job_product_mapping")} ORDER BY workspace_id, job_id`,
    {},
    z.object({
      workspace_id: zId,
      job_id: zId,
      data_product: zStr,
      note: zStrOrNull,
      mapped_by: zStrOrNull,
      mapped_at: zStrOrNull,
    }) as z.ZodType<JobMappingRow>,
  );
}

export async function listTagRules(): Promise<TagRuleRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("mappings");
  if (env.DAL_MOCK) return [...mockStore.tagRules];
  return query(
    `SELECT tag_key, tag_value, data_product, note, mapped_by, mapped_at
     FROM ${T("tag_product_mapping")} ORDER BY tag_key, tag_value`,
    {},
    z.object({
      tag_key: zStr,
      tag_value: zStr,
      data_product: zStr,
      note: zStrOrNull,
      mapped_by: zStrOrNull,
      mapped_at: zStrOrNull,
    }) as z.ZodType<TagRuleRow>,
  );
}

export async function listRunnerRules(): Promise<RunnerRuleRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("mappings");
  if (env.DAL_MOCK) return [...mockStore.runnerRules];
  return query(
    `SELECT user_id, data_product, note, mapped_by, mapped_at
     FROM ${T("runner_product_mapping")} ORDER BY user_id`,
    {},
    z.object({
      user_id: zStr,
      data_product: zStr,
      note: zStrOrNull,
      mapped_by: zStrOrNull,
      mapped_at: zStrOrNull,
    }) as z.ZodType<RunnerRuleRow>,
  );
}

export async function listWarehouseMappings(): Promise<WarehouseMappingRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("mappings");
  if (env.DAL_MOCK) return [...mockStore.warehouseMappings];
  return query(
    `SELECT warehouse_id, data_product, is_shared FROM ${T("warehouse_product_mapping")}
     ORDER BY warehouse_id`,
    {},
    z.object({
      warehouse_id: zStr,
      data_product: zStrOrNull,
      is_shared: z.boolean(),
    }) as z.ZodType<WarehouseMappingRow>,
  );
}

export async function listUsers(): Promise<UserMappingRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("mappings");
  if (env.DAL_MOCK) return [...mockStore.users];
  return query(
    `SELECT user_id, user_name, desk FROM ${T("user_mapping")} ORDER BY user_name`,
    {},
    z.object({ user_id: zStr, user_name: zStr, desk: zStr }) as z.ZodType<UserMappingRow>,
  );
}

export async function listWorkspaces(): Promise<WorkspaceMappingRow[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("mappings");
  if (env.DAL_MOCK) return [...mockStore.workspaces];
  return query(
    `SELECT workspace_id, workspace_name FROM ${T("workspace_mapping")} ORDER BY workspace_name`,
    {},
    z.object({ workspace_id: zId, workspace_name: zStr }) as z.ZodType<WorkspaceMappingRow>,
  );
}

// ============================== writes ==============================

const now = () => new Date().toISOString();

export async function insertProduct(
  row: Pick<DataProductRow, "data_product" | "data_domain" | "desk" | "product_owner" | "valid_from">,
  actor: string,
): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.catalogue.push({ ...row, valid_to: null, mapped_by: actor, mapped_at: now() });
    // registering a product clears a matching rogue-tag queue entry
    mockStore.queueRogueTags = mockStore.queueRogueTags.filter(
      (r) => r.raw_tag_data_product !== row.data_product,
    );
    return;
  }
  await exec(
    `INSERT INTO ${T("data_product_mapping")}
       (data_product, data_domain, desk, product_owner, cost_split_pct,
        valid_from, valid_to, mapped_by, mapped_at)
     VALUES (:data_product, :data_domain, :desk, :product_owner, 1.0,
             :valid_from, NULL, :actor, current_timestamp())`,
    { ...row, actor },
  );
}

/**
 * Move a product to a new desk/domain: close the active row AND insert the
 * successor in ONE atomic MERGE (Databricks has single-statement atomicity
 * only — see implementation guide §8.1). Exclusive-join semantics: old row
 * valid_to = cutover, new row valid_from = cutover.
 */
export async function moveProduct(
  args: {
    data_product: string;
    cutover: string;
    new_domain: string;
    new_desk: string;
    new_owner: string | null;
  },
  actor: string,
): Promise<void> {
  if (env.DAL_MOCK) {
    const active = mockStore.catalogue.find(
      (r) => r.data_product === args.data_product && r.valid_to == null,
    );
    if (active) active.valid_to = args.cutover;
    mockStore.catalogue.push({
      data_product: args.data_product,
      data_domain: args.new_domain,
      desk: args.new_desk,
      product_owner: args.new_owner,
      valid_from: args.cutover,
      valid_to: null,
      mapped_by: actor,
      mapped_at: now(),
    });
    return;
  }
  await exec(
    `MERGE INTO ${T("data_product_mapping")} t
     USING (
       SELECT :data_product AS data_product, 'close' AS action UNION ALL
       SELECT :data_product, 'insert'
     ) s
     ON  t.data_product = s.data_product
     AND s.action = 'close'
     AND t.valid_to IS NULL
     WHEN MATCHED THEN
       UPDATE SET valid_to = :cutover, mapped_by = :actor, mapped_at = current_timestamp()
     WHEN NOT MATCHED AND s.action = 'insert' THEN
       INSERT (data_product, data_domain, desk, product_owner, cost_split_pct,
               valid_from, valid_to, mapped_by, mapped_at)
       VALUES (:data_product, :new_domain, :new_desk, :new_owner, 1.0,
               :cutover, NULL, :actor, current_timestamp())`,
    { ...args, actor },
  );
}

export async function retireProduct(
  data_product: string,
  valid_to: string,
  actor: string,
): Promise<void> {
  if (env.DAL_MOCK) {
    const active = mockStore.catalogue.find(
      (r) => r.data_product === data_product && r.valid_to == null,
    );
    if (active) {
      active.valid_to = valid_to;
      active.mapped_by = actor;
      active.mapped_at = now();
    }
    return;
  }
  await exec(
    `UPDATE ${T("data_product_mapping")}
     SET valid_to = :valid_to, mapped_by = :actor, mapped_at = current_timestamp()
     WHERE data_product = :data_product AND valid_to IS NULL`,
    { data_product, valid_to, actor },
  );
}

/** product_owner is metadata, not hierarchy — in-place update is allowed. */
export async function updateProductOwner(
  data_product: string,
  product_owner: string | null,
  actor: string,
): Promise<void> {
  if (env.DAL_MOCK) {
    const active = mockStore.catalogue.find(
      (r) => r.data_product === data_product && r.valid_to == null,
    );
    if (active) {
      active.product_owner = product_owner;
      active.mapped_by = actor;
      active.mapped_at = now();
    }
    return;
  }
  await exec(
    `UPDATE ${T("data_product_mapping")}
     SET product_owner = :product_owner, mapped_by = :actor, mapped_at = current_timestamp()
     WHERE data_product = :data_product AND valid_to IS NULL`,
    { data_product, product_owner, actor },
  );
}

export async function insertJobMapping(
  row: { workspace_id: string; job_id: string; data_product: string; note: string | null },
  actor: string,
): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.jobMappings.push({ ...row, mapped_by: actor, mapped_at: now() });
    mockStore.queueUntaggedJobs = mockStore.queueUntaggedJobs.filter(
      (q) => !(q.workspace_id === row.workspace_id && q.job_id === row.job_id),
    );
    // cost_fact is a view — the job's NONE rows re-attribute via the new bridge row
    const desk = mockStore.catalogue.find(
      (c) => c.data_product === row.data_product && c.valid_to == null,
    )?.desk;
    for (const a of mockStore.jobAttributions) {
      if (
        a.workspace_id === row.workspace_id &&
        a.job_id === row.job_id &&
        a.attribution_method === "NONE"
      ) {
        a.attribution_method = "JOB_MAPPING";
        a.data_product = row.data_product;
        a.desk = desk ?? "UNALLOCATED";
      }
    }
    return;
  }
  await exec(
    `INSERT INTO ${T("job_product_mapping")}
       (workspace_id, job_id, data_product, note, mapped_by, mapped_at)
     VALUES (:workspace_id, :job_id, :data_product, :note, :actor, current_timestamp())`,
    { ...row, actor },
  );
}

export async function deleteJobMapping(workspace_id: string, job_id: string): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.jobMappings = mockStore.jobMappings.filter(
      (j) => !(j.workspace_id === workspace_id && j.job_id === job_id),
    );
    // without the bridge row, the job's JOB_MAPPING attribution recomputes to NONE
    for (const a of mockStore.jobAttributions) {
      if (
        a.workspace_id === workspace_id &&
        a.job_id === job_id &&
        a.attribution_method === "JOB_MAPPING"
      ) {
        a.attribution_method = "NONE";
        a.data_product = "UNALLOCATED";
        a.desk = "UNALLOCATED";
      }
    }
    return;
  }
  await exec(
    `DELETE FROM ${T("job_product_mapping")}
     WHERE workspace_id = :workspace_id AND job_id = :job_id`,
    { workspace_id, job_id },
  );
}

/** Desk of a product's active catalogue row — mock re-attribution helper. */
function mockActiveDesk(data_product: string): string {
  return (
    mockStore.catalogue.find((c) => c.data_product === data_product && c.valid_to == null)
      ?.desk ?? "UNALLOCATED"
  );
}

export async function insertTagRule(
  row: { tag_key: string; tag_value: string; data_product: string; note: string | null },
  actor: string,
): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.tagRules.push({ ...row, mapped_by: actor, mapped_at: now() });
    // cost_fact is a view — NONE rows whose tags carry key=value re-attribute
    const desk = mockActiveDesk(row.data_product);
    const matched = new Set<string>();
    for (const a of mockStore.jobAttributions) {
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
        matched.add(`${a.workspace_id}|${a.job_id}`);
      }
    }
    mockStore.queueUntaggedJobs = mockStore.queueUntaggedJobs.filter(
      (q) => !matched.has(`${q.workspace_id}|${q.job_id}`),
    );
    return;
  }
  await exec(
    `INSERT INTO ${T("tag_product_mapping")}
       (tag_key, tag_value, data_product, note, mapped_by, mapped_at)
     VALUES (:tag_key, :tag_value, :data_product, :note, :actor, current_timestamp())`,
    { ...row, actor },
  );
}

export async function deleteTagRule(tag_key: string, tag_value: string): Promise<void> {
  if (env.DAL_MOCK) {
    const rule = mockStore.tagRules.find(
      (r) => r.tag_key === tag_key && r.tag_value === tag_value,
    );
    mockStore.tagRules = mockStore.tagRules.filter(
      (r) => !(r.tag_key === tag_key && r.tag_value === tag_value),
    );
    // rows the rule carried fall back to NONE
    for (const a of mockStore.jobAttributions) {
      if (a.attribution_method === "TAG_RULE" && a.data_product === rule?.data_product) {
        a.attribution_method = "NONE";
        a.data_product = "UNALLOCATED";
        a.desk = "UNALLOCATED";
      }
    }
    return;
  }
  await exec(
    `DELETE FROM ${T("tag_product_mapping")}
     WHERE tag_key = :tag_key AND tag_value = :tag_value`,
    { tag_key, tag_value },
  );
}

export async function insertRunnerRule(
  row: { user_id: string; data_product: string; note: string | null },
  actor: string,
): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.runnerRules.push({ ...row, mapped_by: actor, mapped_at: now() });
    // queue rows carry the runner — use them to find the jobs the rule catches
    const desk = mockActiveDesk(row.data_product);
    const matched = new Set(
      mockStore.queueUntaggedJobs
        .filter((q) => q.runner === row.user_id)
        .map((q) => `${q.workspace_id}|${q.job_id}`),
    );
    for (const a of mockStore.jobAttributions) {
      if (a.attribution_method === "NONE" && matched.has(`${a.workspace_id}|${a.job_id}`)) {
        a.attribution_method = "RUNNER_RULE";
        a.data_product = row.data_product;
        a.desk = desk;
      }
    }
    mockStore.queueUntaggedJobs = mockStore.queueUntaggedJobs.filter(
      (q) => q.runner !== row.user_id,
    );
    return;
  }
  await exec(
    `INSERT INTO ${T("runner_product_mapping")}
       (user_id, data_product, note, mapped_by, mapped_at)
     VALUES (:user_id, :data_product, :note, :actor, current_timestamp())`,
    { ...row, actor },
  );
}

export async function deleteRunnerRule(user_id: string): Promise<void> {
  if (env.DAL_MOCK) {
    const rule = mockStore.runnerRules.find((r) => r.user_id === user_id);
    mockStore.runnerRules = mockStore.runnerRules.filter((r) => r.user_id !== user_id);
    for (const a of mockStore.jobAttributions) {
      if (a.attribution_method === "RUNNER_RULE" && a.data_product === rule?.data_product) {
        a.attribution_method = "NONE";
        a.data_product = "UNALLOCATED";
        a.desk = "UNALLOCATED";
      }
    }
    return;
  }
  await exec(`DELETE FROM ${T("runner_product_mapping")} WHERE user_id = :user_id`, {
    user_id,
  });
}

export async function upsertWarehouseMapping(row: WarehouseMappingRow): Promise<void> {
  if (env.DAL_MOCK) {
    const existing = mockStore.warehouseMappings.find(
      (w) => w.warehouse_id === row.warehouse_id,
    );
    if (existing) {
      existing.data_product = row.data_product;
      existing.is_shared = row.is_shared;
    } else {
      mockStore.warehouseMappings.push({ ...row });
    }
    mockStore.queueUnassignedWarehouses = mockStore.queueUnassignedWarehouses.filter(
      (q) => q.warehouse_id !== row.warehouse_id,
    );
    return;
  }
  await exec(
    `MERGE INTO ${T("warehouse_product_mapping")} t
     USING (SELECT :warehouse_id AS warehouse_id) s
     ON t.warehouse_id = s.warehouse_id
     WHEN MATCHED THEN UPDATE SET data_product = :data_product, is_shared = :is_shared
     WHEN NOT MATCHED THEN
       INSERT (warehouse_id, data_product, is_shared)
       VALUES (:warehouse_id, :data_product, :is_shared)`,
    { ...row },
  );
}

export async function upsertUser(row: UserMappingRow): Promise<void> {
  if (env.DAL_MOCK) {
    const existing = mockStore.users.find((u) => u.user_id === row.user_id);
    if (existing) {
      existing.user_name = row.user_name;
      existing.desk = row.desk;
    } else {
      mockStore.users.push({ ...row });
    }
    mockStore.queueUnknownRunners = mockStore.queueUnknownRunners.filter(
      (q) => q.runner !== row.user_id,
    );
    mockStore.serverlessGap = mockStore.serverlessGap.filter((g) => g.runner !== row.user_id);
    return;
  }
  await exec(
    `MERGE INTO ${T("user_mapping")} t
     USING (SELECT :user_id AS user_id) s
     ON t.user_id = s.user_id
     WHEN MATCHED THEN UPDATE SET user_name = :user_name, desk = :desk
     WHEN NOT MATCHED THEN
       INSERT (user_id, user_name, desk) VALUES (:user_id, :user_name, :desk)`,
    { ...row },
  );
}

export async function deleteUser(user_id: string): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.users = mockStore.users.filter((u) => u.user_id !== user_id);
    return;
  }
  await exec(`DELETE FROM ${T("user_mapping")} WHERE user_id = :user_id`, { user_id });
}

export async function upsertWorkspace(row: WorkspaceMappingRow): Promise<void> {
  if (env.DAL_MOCK) {
    const existing = mockStore.workspaces.find((w) => w.workspace_id === row.workspace_id);
    if (existing) {
      existing.workspace_name = row.workspace_name;
    } else {
      mockStore.workspaces.push({ ...row });
    }
    mockStore.queueUnknownWorkspaces = mockStore.queueUnknownWorkspaces.filter(
      (q) => q.workspace_id !== row.workspace_id,
    );
    return;
  }
  // workspace_id is BIGINT in the deployed table (methodology DDL says STRING)
  // — cast explicitly so the string parameter binds predictably.
  await exec(
    `MERGE INTO ${T("workspace_mapping")} t
     USING (SELECT CAST(:workspace_id AS BIGINT) AS workspace_id) s
     ON t.workspace_id = s.workspace_id
     WHEN MATCHED THEN UPDATE SET workspace_name = :workspace_name
     WHEN NOT MATCHED THEN
       INSERT (workspace_id, workspace_name)
       VALUES (CAST(:workspace_id AS BIGINT), :workspace_name)`,
    { ...row },
  );
}

export async function deleteWorkspace(workspace_id: string): Promise<void> {
  if (env.DAL_MOCK) {
    mockStore.workspaces = mockStore.workspaces.filter((w) => w.workspace_id !== workspace_id);
    return;
  }
  await exec(
    `DELETE FROM ${T("workspace_mapping")}
     WHERE workspace_id = CAST(:workspace_id AS BIGINT)`,
    { workspace_id },
  );
}
