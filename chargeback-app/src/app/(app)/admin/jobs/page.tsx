import { Suspense } from "react";
import { requirePageRole } from "@/lib/guards";
import { listActiveProducts, listJobMappings, listWorkspaces } from "@/dal/mappings";
import { getTaggedBridgeJobs } from "@/dal/workQueue";
import { deleteJobMappingAction, mapJobAction } from "@/actions/mappings";
import { ActionForm, Field, SelectField } from "@/components/action-form";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import { fmtMoney } from "@/lib/format";

export const metadata = { title: "Job bridge" };

export default function JobsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading job mappings…</p>}>
      <Jobs />
    </Suspense>
  );
}

async function Jobs() {
  await requirePageRole("steward");
  const [rows, products, workspaces, taggedJobs] = await Promise.all([
    listJobMappings(),
    listActiveProducts(),
    listWorkspaces(),
    getTaggedBridgeJobs(),
  ]);
  const productOptions = products.map((p) => ({
    value: p.data_product,
    label: `${p.data_product} (${p.desk})`,
  }));
  const wsName = new Map(workspaces.map((w) => [w.workspace_id, w.workspace_name]));

  return (
    <div>
      <PageTitle
        title="Job bridge"
        subtitle="job_product_mapping — manual bridge for jobs not yet tagged at source (waterfall rule 2). Target state: this table is empty."
      />

      <details className="no-print mb-6">
        <summary className="btn cursor-pointer">＋ Map a job</summary>
        <Card className="mt-3 max-w-md">
          <ActionForm
            action={mapJobAction}
            submitLabel="Map job"
            note="job_id is only unique within a workspace — both are required."
          >
            <SelectField
              label="Workspace"
              name="workspace_id"
              options={workspaces.map((w) => ({
                value: w.workspace_id,
                label: `${w.workspace_name} (${w.workspace_id})`,
              }))}
            />
            <Field label="Job ID" name="job_id" />
            <SelectField label="Data product" name="data_product" options={productOptions} />
            <Field label="Note (why mapped manually)" name="note" required={false} />
          </ActionForm>
        </Card>
      </details>

      {taggedJobs.length > 0 && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50/50">
          <h2 className="mb-1 text-sm font-semibold text-emerald-800">
            🧹 Safe to remove — now tagged at source
          </h2>
          <p className="mb-3 text-xs text-emerald-700">
            These bridge rows point at jobs that produced TAG-attributed cost in the last 30 days:
            the tag has landed, the bridge is redundant. Removing them shrinks this table toward
            its goal state (empty). The tag keeps winning either way — it is rule 1 of the
            waterfall.
          </p>
          <table className="w-full max-w-2xl">
            <thead>
              <tr>
                <th className="th">Workspace</th>
                <th className="th">Job ID</th>
                <th className="th">Product</th>
                <th className="th text-right">TAG cost 30d</th>
                <th className="th">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {taggedJobs.map((j) => (
                <tr key={`${j.workspace_id}|${j.job_id}`}>
                  <td className="td">{wsName.get(j.workspace_id) ?? j.workspace_id}</td>
                  <td className="td font-mono text-xs">{j.job_id}</td>
                  <td className="td font-mono text-xs">{j.data_product}</td>
                  <td className="td text-right tabular-nums">{fmtMoney(j.tagged_cost_30d)}</td>
                  <td className="td">
                    <ActionForm action={deleteJobMappingAction} submitLabel="Remove bridge">
                      <input type="hidden" name="workspace_id" value={j.workspace_id} />
                      <input type="hidden" name="job_id" value={j.job_id} />
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState message="No bridge mappings — every job attributes via tags. That's the goal state." />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Workspace</th>
                <th className="th">Job ID</th>
                <th className="th">Product</th>
                <th className="th">Note</th>
                <th className="th">Mapped by / at</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.workspace_id}|${r.job_id}`}>
                  <td className="td">{wsName.get(r.workspace_id) ?? r.workspace_id}</td>
                  <td className="td font-mono text-xs">{r.job_id}</td>
                  <td className="td font-mono text-xs">{r.data_product}</td>
                  <td className="td text-xs">{r.note ?? "—"}</td>
                  <td className="td text-xs text-slate-500">
                    {r.mapped_by ?? "—"}
                    {r.mapped_at && <> · {r.mapped_at.slice(0, 10)}</>}
                  </td>
                  <td className="td">
                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-red-600 hover:underline">
                        Remove
                      </summary>
                      <div className="mt-2 max-w-xs rounded-md border border-red-200 bg-red-50 p-3">
                        <ActionForm
                          action={deleteJobMappingAction}
                          submitLabel="Remove mapping"
                          danger
                          note="Remove once the job is tagged at source — otherwise its spend falls back to the work queue."
                        >
                          <input type="hidden" name="workspace_id" value={r.workspace_id} />
                          <input type="hidden" name="job_id" value={r.job_id} />
                        </ActionForm>
                      </div>
                    </details>
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
