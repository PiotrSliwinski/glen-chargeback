import { Suspense } from "react";
import { requirePageRole } from "@/lib/guards";
import { listActiveProducts, listUsers } from "@/dal/mappings";
import { deleteUserAction, upsertUserAction } from "@/actions/mappings";
import { ActionForm, Field } from "@/components/action-form";
import { Card, EmptyState, PageTitle } from "@/components/ui";

export const metadata = { title: "Users" };

export default function UsersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading users…</p>}>
      <Users />
    </Suspense>
  );
}

async function Users() {
  await requirePageRole("steward");
  const [rows, products] = await Promise.all([listUsers(), listActiveProducts()]);
  const deskOptions = [
    ...new Set([...products.map((p) => p.desk), ...rows.map((r) => r.desk)]),
  ].sort();

  return (
    <div>
      <PageTitle
        title="User mapping"
        subtitle="user_mapping — runner identity → display name + home desk. user_id must match executed_by / identity_metadata.run_as exactly, including service principal IDs."
      />

      <details className="no-print mb-6">
        <summary className="btn cursor-pointer">＋ Add user</summary>
        <Card className="mt-3 max-w-md">
          <ActionForm
            action={upsertUserAction}
            submitLabel="Save user"
            note="Prefer adding users from the Work Queue — there the user_id is pre-filled from the system tables and cannot be mistyped."
          >
            <Field label="User ID (email or SP application id)" name="user_id" />
            <Field label="Display name" name="user_name" />
            <DeskField deskOptions={deskOptions} />
          </ActionForm>
        </Card>
      </details>

      <Card>
        {rows.length === 0 ? (
          <EmptyState message="No users mapped yet." />
        ) : (
          <table className="w-full align-top">
            <thead>
              <tr>
                <th className="th">User ID</th>
                <th className="th">Display name</th>
                <th className="th">Desk</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td className="td font-mono text-xs">{r.user_id}</td>
                  <td className="td">{r.user_name}</td>
                  <td className="td">{r.desk}</td>
                  <td className="td">
                    <div className="flex gap-4">
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                          Edit
                        </summary>
                        <div className="mt-2 max-w-md rounded-md border border-slate-200 bg-slate-50 p-3">
                          <ActionForm
                            action={upsertUserAction}
                            submitLabel="Update user"
                            note="Changing the desk re-routes this runner's AD_HOC spend in live views from now on; published months are unaffected. The user_id itself cannot change — remove and re-add if the identity is wrong."
                          >
                            <Field label="User ID" name="user_id" defaultValue={r.user_id} readOnly />
                            <Field label="Display name" name="user_name" defaultValue={r.user_name} />
                            <DeskField deskOptions={deskOptions} defaultValue={r.desk} id={`desk-${r.user_id}`} />
                          </ActionForm>
                        </div>
                      </details>
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-red-600 hover:underline">
                          Remove
                        </summary>
                        <div className="mt-2 max-w-md rounded-md border border-red-200 bg-red-50 p-3">
                          <ActionForm
                            action={deleteUserAction}
                            submitLabel="Remove user"
                            danger
                            note="Their ad-hoc spend loses its desk (waterfall rule 4 stops matching) and the runner reappears in the work queue if they keep spending. Remove only for departed users or wrong identities."
                          >
                            <input type="hidden" name="user_id" value={r.user_id} />
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

function DeskField({
  deskOptions,
  defaultValue,
  id = "desk",
}: {
  deskOptions: string[];
  defaultValue?: string;
  id?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        Home desk
      </label>
      <input
        id={id}
        name="desk"
        required
        defaultValue={defaultValue}
        className="input"
        list="desk-options-list"
      />
      <datalist id="desk-options-list">
        {deskOptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </div>
  );
}
