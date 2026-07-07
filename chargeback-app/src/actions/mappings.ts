"use server";

import { revalidateTag, updateTag } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { formList, optionalText, parseForm, runAction } from "@/actions/run";
import * as dal from "@/dal/mappings";
import { SCOPE_LABELS, scopeCovers, scopesOverlap } from "@/lib/tag-rules";
import { assertProductExists } from "@/services/productCatalogue";
import { DomainError } from "@/services/errors";

function invalidateMappings(opts: { queue?: "keep" | "background" } = {}) {
  updateTag("mappings");
  // The server action's response re-renders the current page, so every tag
  // expired with updateTag is paid for inline before the dialog reports
  // success — and the "queue" queries are 30-day cost_fact scans. Actions
  // pick per mutation:
  //  - default: expire inline (read-your-writes — e.g. a mapped job must
  //    leave the untagged-jobs list before the dialog closes)
  //  - "keep": a desk-only move of an already-mapped runner cannot change
  //    any queue query, so keep the cache
  //  - "background": user membership changes — the unknown-runners list
  //    already updates instantly via its "mappings" tag, so the deep scans
  //    serve stale and refresh in the background instead of freezing the
  //    dialog
  if (opts.queue === "background") revalidateTag("queue", "max");
  else if (opts.queue !== "keep") updateTag("queue");
  updateTag("reports-live");
  updateTag("health");
}

const MapJob = z.object({
  workspace_id: z.string().min(1),
  job_id: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

export async function mapJobAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, MapJob);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listJobMappings();
    if (
      existing.some(
        (j) => j.workspace_id === input.workspace_id && j.job_id === input.job_id,
      )
    ) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `job ${input.job_id} in workspace ${input.workspace_id} is already mapped`,
      );
    }
    await dal.insertJobMapping(input, actor);
    invalidateMappings();
    return `Job ${input.job_id} mapped to '${input.data_product}'. Reminder: the durable fix is tagging the job at source.`;
  });
}

const DeleteJobMapping = z.object({
  workspace_id: z.string().min(1),
  job_id: z.string().min(1),
});

export async function deleteJobMappingAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteJobMapping);
    await dal.deleteJobMapping(input.workspace_id, input.job_id);
    invalidateMappings();
    return `Mapping removed for job ${input.job_id}. Its future spend attributes via tags — or falls to the work queue.`;
  });
}

const AddTagRule = z.object({
  tag_key: z.string().min(1),
  tag_value: z.string().min(1),
  data_product: z.string().min(1),
  scope: z.enum(["databricks", "azure", "both"]),
  note: optionalText,
});

export async function addTagRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, AddTagRule);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listTagRules();
    // rules whose scopes can match the same record are conflicting duplicates
    const clash = existing.find(
      (r) =>
        r.tag_key === input.tag_key &&
        r.tag_value === input.tag_value &&
        scopesOverlap(r.scope, input.scope),
    );
    if (clash) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `a ${SCOPE_LABELS[clash.scope]}-scoped rule for tag ${input.tag_key}=${input.tag_value} already exists`,
      );
    }
    await dal.insertTagRule(input, actor);
    invalidateMappings();
    // azure-covering rules re-attribute azure_cost_fact too
    if (scopeCovers(input.scope, "azure")) updateTag("azure");
    return `Rule created: ${SCOPE_LABELS[input.scope]} tag ${input.tag_key}=${input.tag_value} → '${input.data_product}'. Applies to all past and future spend carrying that tag.`;
  });
}

const EditTagRule = z.object({
  tag_key: z.string().min(1),
  tag_value: z.string().min(1),
  scope: z.enum(["databricks", "azure", "both"]),
  data_product: z.string().min(1),
  note: optionalText,
});

/** Re-point a rule at a new product; key, value and scope are its identity and stay fixed. */
export async function editTagRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, EditTagRule);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listTagRules();
    if (
      !existing.some(
        (r) =>
          r.tag_key === input.tag_key &&
          r.tag_value === input.tag_value &&
          r.scope === input.scope,
      )
    ) {
      throw new DomainError(
        "NOT_FOUND",
        `no ${SCOPE_LABELS[input.scope]}-scoped rule for tag ${input.tag_key}=${input.tag_value}`,
      );
    }
    await dal.updateTagRule(
      input.tag_key,
      input.tag_value,
      input.scope,
      input.data_product,
      input.note,
      actor,
    );
    invalidateMappings();
    if (scopeCovers(input.scope, "azure")) updateTag("azure");
    return `Rule updated: tag ${input.tag_key}=${input.tag_value} now routes to '${input.data_product}' — all spend it carries follows.`;
  });
}

const DeleteTagRule = z.object({
  tag_key: z.string().min(1),
  tag_value: z.string().min(1),
  scope: z.enum(["databricks", "azure", "both"]),
});

export async function deleteTagRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteTagRule);
    await dal.deleteTagRule(input.tag_key, input.tag_value, input.scope);
    invalidateMappings();
    if (scopeCovers(input.scope, "azure")) updateTag("azure");
    return `Rule removed for tag ${input.tag_key}=${input.tag_value}. Spend it carried falls back to later waterfall rules — or the work queue.`;
  });
}

const AddRunnerRule = z.object({
  user_id: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

export async function addRunnerRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, AddRunnerRule);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listRunnerRules();
    if (existing.some((r) => r.user_id === input.user_id)) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `runner '${input.user_id}' already has a rule — remove it first`,
      );
    }
    await dal.insertRunnerRule(input, actor);
    invalidateMappings();
    return `Rule created: everything '${input.user_id}' runs → '${input.data_product}'.`;
  });
}

const EditRunnerRule = z.object({
  user_id: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

/** Re-point a runner rule at a new product; the identity stays fixed. */
export async function editRunnerRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, EditRunnerRule);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listRunnerRules();
    if (!existing.some((r) => r.user_id === input.user_id)) {
      throw new DomainError("NOT_FOUND", `no rule for runner '${input.user_id}'`);
    }
    await dal.updateRunnerRule(input.user_id, input.data_product, input.note, actor);
    invalidateMappings();
    return `Rule updated: everything '${input.user_id}' runs now routes to '${input.data_product}'.`;
  });
}

const DeleteRunnerRule = z.object({
  user_id: z.string().min(1),
});

export async function deleteRunnerRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteRunnerRule);
    await dal.deleteRunnerRule(input.user_id);
    invalidateMappings();
    return `Rule removed for '${input.user_id}'. Their job spend no longer attributes via this rule — jobs never default to the runner's desk.`;
  });
}

const MapEndpoint = z.object({
  workspace_id: z.string().min(1),
  endpoint_name: z.string().min(1),
  data_product: z.string().min(1),
  note: optionalText,
});

export async function mapEndpointAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const input = parseForm(formData, MapEndpoint);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listEndpointMappings();
    if (
      existing.some(
        (e) =>
          e.workspace_id === input.workspace_id && e.endpoint_name === input.endpoint_name,
      )
    ) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `endpoint '${input.endpoint_name}' in workspace ${input.workspace_id} is already mapped — remove it first`,
      );
    }
    await dal.insertEndpointMapping(input, actor);
    invalidateMappings();
    return `Endpoint '${input.endpoint_name}' mapped to '${input.data_product}' — its serving spend with no attributable user, batch inference included (spend run by mapped users bills their desk first). Reminder: the durable fix is tagging the endpoint at source.`;
  });
}

const DeleteEndpointMapping = z.object({
  workspace_id: z.string().min(1),
  endpoint_name: z.string().min(1),
});

export async function deleteEndpointMappingAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteEndpointMapping);
    await dal.deleteEndpointMapping(input.workspace_id, input.endpoint_name);
    invalidateMappings();
    return `Mapping removed for endpoint '${input.endpoint_name}'. Its future spend attributes via tags — or falls to UNALLOCATED.`;
  });
}

const AddUser = z.object({
  user_id: z.string().min(1),
  user_name: z.string().min(1),
  desk: z.string().min(1),
});

export async function upsertUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, AddUser);
    // desk-only move: membership and display names stay as the queue saw them
    // (queue surfaces runner_name, so a rename must still refresh it)
    const prev = (await dal.listUsers()).find((u) => u.user_id === input.user_id);
    await dal.upsertUser(input);
    invalidateMappings({
      queue: prev && prev.user_name === input.user_name ? "keep" : "background",
    });
    return `Runner '${input.user_id}' mapped to desk ${input.desk}.`;
  });
}

const DeleteUser = z.object({
  user_id: z.string().min(1),
});

export async function deleteUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteUser);
    const existing = await dal.listUsers();
    if (!existing.some((u) => u.user_id === input.user_id)) {
      throw new DomainError("NOT_FOUND", `runner '${input.user_id}' is not in user_mapping`);
    }
    await dal.deleteUser(input.user_id);
    invalidateMappings({ queue: "background" });
    return `Runner '${input.user_id}' removed. Their future ad-hoc spend loses its desk and will surface in the work queue.`;
  });
}

const AddWorkspace = z.object({
  workspace_id: z.string().min(1),
  workspace_name: z.string().min(1),
});

export async function upsertWorkspaceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, AddWorkspace);
    await dal.upsertWorkspace(input);
    invalidateMappings();
    return `Workspace ${input.workspace_id} named '${input.workspace_name}'.`;
  });
}

const DeleteWorkspace = z.object({
  workspace_id: z.string().min(1),
});

export async function deleteWorkspaceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteWorkspace);
    const existing = await dal.listWorkspaces();
    if (!existing.some((w) => w.workspace_id === input.workspace_id)) {
      throw new DomainError(
        "NOT_FOUND",
        `workspace ${input.workspace_id} is not in workspace_mapping`,
      );
    }
    await dal.deleteWorkspace(input.workspace_id);
    invalidateMappings();
    return `Workspace ${input.workspace_id} removed. If it still bills, it will show as 'UNMAPPED: ${input.workspace_id}' in reports and reappear in the work queue — spend is never dropped.`;
  });
}

// ============================== bulk actions ==============================
// Each bulk action validates the whole batch up front (§7.4(b) still holds:
// referenced products must exist before commit). Job-bridge batches apply as
// ONE statement (Databricks has single-statement atomicity only); the other
// mapping tables still apply row by row.

/**
 * Bridge-row keys travel as 'workspace_id|job_id' — same shape as React keys.
 * Deduped: the work queue can show one job on several rows (split by category
 * or runner), and a job must never yield two bridge rows.
 */
function parseJobKeys(formData: FormData): { workspace_id: string; job_id: string }[] {
  return [...new Set(formList(formData, "keys"))].map((key) => {
    const [workspace_id, job_id, ...rest] = key.split("|");
    if (!workspace_id || !job_id || rest.length > 0) {
      throw new DomainError("VALIDATION", `malformed job key '${key}'`);
    }
    return { workspace_id, job_id };
  });
}

const BulkMapJobs = z.object({ data_product: z.string().min(1), note: optionalText });

/** Work-queue bulk fix: NEW bridge rows for untagged jobs (vs. re-mapping existing ones). */
export async function bulkMapJobsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const keys = parseJobKeys(formData);
    const input = parseForm(formData, BulkMapJobs);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listJobMappings();
    const dupes = keys.filter((k) =>
      existing.some((j) => j.workspace_id === k.workspace_id && j.job_id === k.job_id),
    );
    if (dupes.length > 0) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `already mapped: job${dupes.length > 1 ? "s" : ""} ${dupes.map((k) => k.job_id).join(", ")}`,
      );
    }
    await dal.insertJobMappings(keys, input.data_product, input.note, actor);
    invalidateMappings();
    return `${keys.length} job${keys.length > 1 ? "s" : ""} mapped to '${input.data_product}'. Reminder: the durable fix is tagging at source.`;
  });
}

export async function bulkDeleteJobMappingsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const keys = parseJobKeys(formData);
    await dal.deleteJobMappings(keys);
    invalidateMappings();
    return `${keys.length} bridge mapping${keys.length > 1 ? "s" : ""} removed. Future spend for those jobs attributes via tags — or falls to the work queue.`;
  });
}

const BulkRemapJobs = z.object({ data_product: z.string().min(1), note: optionalText });

export async function bulkRemapJobsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const keys = parseJobKeys(formData);
    const input = parseForm(formData, BulkRemapJobs);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listJobMappings();
    const missing = keys.filter(
      (k) =>
        !existing.some((j) => j.workspace_id === k.workspace_id && j.job_id === k.job_id),
    );
    if (missing.length > 0) {
      throw new DomainError(
        "NOT_FOUND",
        `no bridge row for job${missing.length > 1 ? "s" : ""} ${missing.map((k) => k.job_id).join(", ")}`,
      );
    }
    await dal.remapJobs(keys, input.data_product, input.note, actor);
    invalidateMappings();
    return `${keys.length} job${keys.length > 1 ? "s" : ""} re-mapped to '${input.data_product}'. Reminder: the durable fix is tagging at source.`;
  });
}

/**
 * Endpoint keys travel as 'workspace_id|endpoint_name' — same shape as React
 * keys. Deduped for the same reason as jobs: one endpoint, one bridge row.
 */
function parseEndpointKeys(formData: FormData): { workspace_id: string; endpoint_name: string }[] {
  return [...new Set(formList(formData, "keys"))].map((key) => {
    const [workspace_id, endpoint_name, ...rest] = key.split("|");
    if (!workspace_id || !endpoint_name || rest.length > 0) {
      throw new DomainError("VALIDATION", `malformed endpoint key '${key}'`);
    }
    return { workspace_id, endpoint_name };
  });
}

const BulkMapEndpoints = z.object({ data_product: z.string().min(1), note: optionalText });

/** Work-queue bulk fix: NEW bridge rows for unmapped serving endpoints. */
export async function bulkMapEndpointsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async (actor) => {
    const keys = parseEndpointKeys(formData);
    const input = parseForm(formData, BulkMapEndpoints);
    await assertProductExists(input.data_product); // §7.4(b) before commit
    const existing = await dal.listEndpointMappings();
    const dupes = keys.filter((k) =>
      existing.some(
        (e) => e.workspace_id === k.workspace_id && e.endpoint_name === k.endpoint_name,
      ),
    );
    if (dupes.length > 0) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `already mapped: endpoint${dupes.length > 1 ? "s" : ""} ${dupes.map((k) => k.endpoint_name).join(", ")}`,
      );
    }
    await dal.insertEndpointMappings(keys, input.data_product, input.note, actor);
    invalidateMappings();
    return `${keys.length} endpoint${keys.length > 1 ? "s" : ""} mapped to '${input.data_product}' — their serving spend with no attributable user routes there. Reminder: the durable fix is tagging each endpoint at source.`;
  });
}

/**
 * Work-queue bulk fix: register unknown workspaces. Friendly names default to
 * the raw workspace ID (refine later under Reference data → Workspaces) —
 * attribution is unaffected either way.
 */
export async function bulkAddWorkspacesAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const ids = [...new Set(formList(formData, "workspace_ids"))];
    const existing = new Map((await dal.listWorkspaces()).map((w) => [w.workspace_id, w]));
    for (const id of ids) {
      await dal.upsertWorkspace({
        workspace_id: id,
        workspace_name: existing.get(id)?.workspace_name ?? id,
      });
    }
    invalidateMappings();
    return `${ids.length} workspace${ids.length > 1 ? "s" : ""} registered. Friendly names default to the workspace ID — refine them under Reference data → Workspaces.`;
  });
}

const BulkAssignWarehouses = z.object({
  mode: z.enum(["shared", "dedicated"]),
  data_product: optionalText,
});

export async function bulkAssignWarehousesAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const ids = formList(formData, "warehouse_ids");
    const input = parseForm(formData, BulkAssignWarehouses);
    // Same invariant as the single-row action: dedicated ⇔ product present.
    if (input.mode === "dedicated") {
      if (!input.data_product) {
        throw new DomainError("VALIDATION", "a dedicated warehouse needs a data product");
      }
      await assertProductExists(input.data_product);
    }
    const data_product = input.mode === "dedicated" ? input.data_product : null;
    for (const warehouse_id of ids) {
      await dal.upsertWarehouseMapping({
        warehouse_id,
        data_product,
        is_shared: input.mode === "shared",
      });
    }
    invalidateMappings();
    return input.mode === "dedicated"
      ? `${ids.length} warehouse${ids.length > 1 ? "s" : ""} dedicated to '${input.data_product}' — including idle cost.`
      : `${ids.length} warehouse${ids.length > 1 ? "s" : ""} marked shared — allocated per query.`;
  });
}

const BulkAddUsers = z.object({ desk: z.string().min(1) });

/**
 * Work-queue bulk fix: register unknown runners on one desk. Display names
 * default to the raw identity (refine later under Reference data → Users);
 * runners already in user_mapping keep their existing name and only move desk.
 */
export async function bulkAddUsersAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const ids = [...new Set(formList(formData, "user_ids"))];
    const input = parseForm(formData, BulkAddUsers);
    const existing = new Map((await dal.listUsers()).map((u) => [u.user_id, u]));
    await dal.upsertUsers(
      ids.map((id) => ({
        user_id: id,
        user_name: existing.get(id)?.user_name ?? id,
        desk: input.desk,
      })),
    );
    invalidateMappings({ queue: "background" });
    return `${ids.length} runner${ids.length > 1 ? "s" : ""} mapped to desk ${input.desk}. Display names default to the raw identity — refine them under Reference data → Users.`;
  });
}

const BulkSetDesk = z.object({ desk: z.string().min(1) });

export async function bulkSetUserDeskAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const ids = formList(formData, "user_ids");
    const input = parseForm(formData, BulkSetDesk);
    const existing = new Map((await dal.listUsers()).map((u) => [u.user_id, u]));
    const missing = ids.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw new DomainError("NOT_FOUND", `not in user_mapping: ${missing.join(", ")}`);
    }
    await dal.upsertUsers(
      ids.map((id) => {
        const row = existing.get(id)!;
        return { user_id: id, user_name: row.user_name, desk: input.desk };
      }),
    );
    invalidateMappings({ queue: "keep" });
    return `${ids.length} runner${ids.length > 1 ? "s" : ""} moved to desk ${input.desk}. Live AD_HOC spend re-routes from now on; published months are unaffected.`;
  });
}

export async function bulkDeleteUsersAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const ids = formList(formData, "user_ids");
    const existing = await dal.listUsers();
    const missing = ids.filter((id) => !existing.some((u) => u.user_id === id));
    if (missing.length > 0) {
      throw new DomainError("NOT_FOUND", `not in user_mapping: ${missing.join(", ")}`);
    }
    await dal.deleteUsers(ids);
    invalidateMappings({ queue: "background" });
    return `${ids.length} runner${ids.length > 1 ? "s" : ""} removed. Their future ad-hoc spend loses its desk and surfaces in the work queue.`;
  });
}

export async function bulkDeleteWorkspacesAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const ids = formList(formData, "workspace_ids");
    const existing = await dal.listWorkspaces();
    const missing = ids.filter((id) => !existing.some((w) => w.workspace_id === id));
    if (missing.length > 0) {
      throw new DomainError("NOT_FOUND", `not in workspace_mapping: ${missing.join(", ")}`);
    }
    for (const id of ids) {
      await dal.deleteWorkspace(id);
    }
    invalidateMappings();
    return `${ids.length} workspace${ids.length > 1 ? "s" : ""} removed. Any that still bill show as 'UNMAPPED: <id>' and reappear in the work queue — spend is never dropped.`;
  });
}

const AssignWarehouse = z.object({
  warehouse_id: z.string().min(1),
  mode: z.enum(["shared", "dedicated"]),
  data_product: optionalText,
});

export async function assignWarehouseAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, AssignWarehouse);
    // The shared/dedicated toggle makes §7.4(d) violations unrepresentable.
    if (input.mode === "dedicated") {
      if (!input.data_product) {
        throw new DomainError("VALIDATION", "a dedicated warehouse needs a data product");
      }
      await assertProductExists(input.data_product);
      await dal.upsertWarehouseMapping({
        warehouse_id: input.warehouse_id,
        data_product: input.data_product,
        is_shared: false,
      });
      invalidateMappings();
      return `Warehouse ${input.warehouse_id} dedicated to '${input.data_product}' — including its idle cost.`;
    }
    await dal.upsertWarehouseMapping({
      warehouse_id: input.warehouse_id,
      data_product: null,
      is_shared: true,
    });
    invalidateMappings();
    return `Warehouse ${input.warehouse_id} marked shared — allocated per query.`;
  });
}
