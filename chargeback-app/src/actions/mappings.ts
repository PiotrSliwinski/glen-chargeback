"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { formList, optionalText, parseForm, runAction } from "@/actions/run";
import * as dal from "@/dal/mappings";
import { assertProductExists } from "@/services/productCatalogue";
import { DomainError } from "@/services/errors";

function invalidateMappings() {
  updateTag("mappings");
  updateTag("queue");
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
    if (existing.some((r) => r.tag_key === input.tag_key && r.tag_value === input.tag_value)) {
      throw new DomainError(
        "DUPLICATE_KEY",
        `a rule for tag ${input.tag_key}=${input.tag_value} already exists`,
      );
    }
    await dal.insertTagRule(input, actor);
    invalidateMappings();
    return `Rule created: tag ${input.tag_key}=${input.tag_value} → '${input.data_product}'. Applies to all past and future spend carrying that tag.`;
  });
}

const DeleteTagRule = z.object({
  tag_key: z.string().min(1),
  tag_value: z.string().min(1),
});

export async function deleteTagRuleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const input = parseForm(formData, DeleteTagRule);
    await dal.deleteTagRule(input.tag_key, input.tag_value);
    invalidateMappings();
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
    await dal.upsertUser(input);
    invalidateMappings();
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
    invalidateMappings();
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
// referenced products must exist before commit), then applies row by row —
// the DAL has no multi-row statements.

/** Bridge-row keys travel as 'workspace_id|job_id' — same shape as React keys. */
function parseJobKeys(formData: FormData): { workspace_id: string; job_id: string }[] {
  return formList(formData, "keys").map((key) => {
    const [workspace_id, job_id, ...rest] = key.split("|");
    if (!workspace_id || !job_id || rest.length > 0) {
      throw new DomainError("VALIDATION", `malformed job key '${key}'`);
    }
    return { workspace_id, job_id };
  });
}

export async function bulkDeleteJobMappingsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  return runAction("steward", async () => {
    const keys = parseJobKeys(formData);
    for (const { workspace_id, job_id } of keys) {
      await dal.deleteJobMapping(workspace_id, job_id);
    }
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
    for (const { workspace_id, job_id } of keys) {
      await dal.deleteJobMapping(workspace_id, job_id);
      await dal.insertJobMapping(
        { workspace_id, job_id, data_product: input.data_product, note: input.note },
        actor,
      );
    }
    invalidateMappings();
    return `${keys.length} job${keys.length > 1 ? "s" : ""} re-mapped to '${input.data_product}'. Reminder: the durable fix is tagging at source.`;
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
    for (const id of ids) {
      const row = existing.get(id)!;
      await dal.upsertUser({ user_id: id, user_name: row.user_name, desk: input.desk });
    }
    invalidateMappings();
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
    for (const id of ids) {
      await dal.deleteUser(id);
    }
    invalidateMappings();
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
