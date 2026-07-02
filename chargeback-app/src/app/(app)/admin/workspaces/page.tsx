import { Suspense } from "react";
import { requirePageRole } from "@/lib/guards";
import { listJobMappings, listWorkspaces } from "@/dal/mappings";
import { deleteWorkspaceAction, upsertWorkspaceAction } from "@/actions/mappings";
import { ActionForm, Field } from "@/components/action-form";
import { Card, EmptyState, PageTitle } from "@/components/ui";

export const metadata = { title: "Workspaces" };

export default function WorkspacesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading workspaces…</p>}>
      <Workspaces />
    </Suspense>
  );
}

async function Workspaces() {
  await requirePageRole("steward");
  const [rows, jobMappings] = await Promise.all([listWorkspaces(), listJobMappings()]);
  const jobRefs = (id: string) => jobMappings.filter((j) => j.workspace_id === id).length;

  return (
    <div>
      <PageTitle
        title="Workspace mapping"
        subtitle="workspace_mapping — workspace ID → friendly name. Unmapped workspaces surface in reports as UNMAPPED: <id>, never dropped."
      />

      <details className="no-print mb-6">
        <summary className="btn cursor-pointer">＋ Add workspace</summary>
        <Card className="mt-3 max-w-md">
          <ActionForm
            action={upsertWorkspaceAction}
            submitLabel="Save workspace"
            note="Prefer adding workspaces from the Work Queue — there the ID is pre-filled from billing data and cannot be mistyped."
          >
            <Field label="Workspace ID" name="workspace_id" />
            <Field label="Friendly name" name="workspace_name" />
          </ActionForm>
        </Card>
      </details>

      <Card>
        {rows.length === 0 ? (
          <EmptyState message="No workspaces mapped yet." />
        ) : (
          <table className="w-full align-top">
            <thead>
              <tr>
                <th className="th">Workspace ID</th>
                <th className="th">Name</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.workspace_id}>
                  <td className="td font-mono text-xs">{r.workspace_id}</td>
                  <td className="td">{r.workspace_name}</td>
                  <td className="td">
                    <div className="flex gap-4">
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                          Rename
                        </summary>
                        <div className="mt-2 max-w-md rounded-md border border-slate-200 bg-slate-50 p-3">
                          <ActionForm
                            action={upsertWorkspaceAction}
                            submitLabel="Update name"
                            note="Cosmetic only — the name appears in reports; attribution is unaffected. The ID cannot change: it comes from system.billing.usage."
                          >
                            <Field
                              label="Workspace ID"
                              name="workspace_id"
                              defaultValue={r.workspace_id}
                              readOnly
                            />
                            <Field
                              label="Friendly name"
                              name="workspace_name"
                              defaultValue={r.workspace_name}
                            />
                          </ActionForm>
                        </div>
                      </details>
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-red-600 hover:underline">
                          Remove
                        </summary>
                        <div className="mt-2 max-w-md rounded-md border border-red-200 bg-red-50 p-3">
                          <ActionForm
                            action={deleteWorkspaceAction}
                            submitLabel="Remove workspace"
                            danger
                            note={
                              jobRefs(r.workspace_id) > 0
                                ? `Heads up: ${jobRefs(r.workspace_id)} job mapping(s) reference this workspace — they keep working, but reports will show 'UNMAPPED: ${r.workspace_id}'. Remove only for decommissioned workspaces.`
                                : `If this workspace still bills, reports will show 'UNMAPPED: ${r.workspace_id}' and it reappears in the work queue. Remove only for decommissioned workspaces.`
                            }
                          >
                            <input type="hidden" name="workspace_id" value={r.workspace_id} />
                          </ActionForm>
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
