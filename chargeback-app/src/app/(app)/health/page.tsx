import { Suspense } from "react";
import { requirePageRole } from "@/lib/guards";
import { getSession } from "@/lib/auth";
import { atLeast } from "@/lib/rbac";
import { env } from "@/lib/env";
import { getHealthReport, isPublishable } from "@/dal/health";
import { getDesks, getPublishedMonths } from "@/dal/reports";
import { publishMonthAction, refreshHealthAction } from "@/actions/publish";
import { ActionForm, Field } from "@/components/action-form";
import { fmtMoneyExact, fmtMonth } from "@/lib/format";
import { Card, EmptyState, PageTitle, StatusChip } from "@/components/ui";

export const metadata = { title: "Health & publication" };

export default function HealthPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Running health checks…</p>}>
      <Health />
    </Suspense>
  );
}

async function Health() {
  await requirePageRole("steward");
  const session = await getSession();
  const isPublisher = atLeast(session?.user.role ?? null, "publisher");

  const [report, publishedMonths] = await Promise.all([getHealthReport(), getPublishedMonths()]);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const tolerance = env.RECON_TOLERANCE_USD;

  // The publication candidate: latest closed, unpublished month.
  const candidate = report.recon
    .map((r) => r.billing_month)
    .filter((m) => m < currentMonth && !publishedMonths.includes(m))
    .sort()
    .at(-1);
  const gate = candidate
    ? isPublishable(report, candidate, publishedMonths, currentMonth)
    : null;

  return (
    <div>
      <PageTitle
        title="Health & reconciliation"
        subtitle="§7.1 invariant + §7.4 integrity checks — all green before every publication"
      >
        <ActionForm action={refreshHealthAction} submitLabel="Re-run checks" className="no-print" />
      </PageTitle>

      <Card className="mb-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">
          Reconciliation — billing truth vs cost_fact vs report
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          The three totals must match per month (tolerance ${tolerance}). A gap means spend is
          being dropped or double-counted somewhere — do not publish until resolved.
        </p>
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Month</th>
              <th className="th text-right">Billing truth</th>
              <th className="th text-right">cost_fact</th>
              <th className="th text-right">Report</th>
              <th className="th text-right">Gap</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.recon.map((r) => {
              const pass =
                Math.abs(r.fact_gap) < tolerance && Math.abs(r.report_gap) < tolerance;
              return (
                <tr key={r.billing_month}>
                  <td className="td">
                    {fmtMonth(r.billing_month)}
                    {publishedMonths.includes(r.billing_month) && (
                      <span className="ml-1.5 text-xs text-indigo-600">published</span>
                    )}
                  </td>
                  <td className="td text-right tabular-nums">{fmtMoneyExact(r.billing_cost)}</td>
                  <td className="td text-right tabular-nums">{fmtMoneyExact(r.fact_cost)}</td>
                  <td className="td text-right tabular-nums">{fmtMoneyExact(r.report_cost)}</td>
                  <td className="td text-right tabular-nums">
                    {r.report_gap === 0 ? "0.00" : r.report_gap.toFixed(2)}
                  </td>
                  <td className="td">
                    <StatusChip ok={pass} label={pass ? "reconciled" : "GAP"} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="mb-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">
          Mapping-table integrity (§7.4)
        </h2>
        {report.violations.length === 0 ? (
          <p className="mt-2 text-sm text-emerald-700">
            ✓ No overlapping validity windows, orphan bridge products, duplicate bridge keys, or
            inconsistent warehouse flags.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {report.violations.map((v, i) => (
              <li key={i} className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
                <span className="font-mono text-xs uppercase">{v.check}</span> — {v.detail}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Monthly publication</h2>
        <p className="mb-3 text-xs text-slate-500">
          Publishing snapshots the month into monthly_chargeback_published. Desks are invoiced from
          the snapshot only — mapping edits after publication cannot change an issued invoice. This
          is the one hard-to-reverse action in the system.
        </p>
        {candidate && (
          <Suspense fallback={<p className="text-sm text-slate-500">Computing diff…</p>}>
            <PublicationDiff candidate={candidate} publishedMonths={publishedMonths} />
          </Suspense>
        )}
        {!candidate ? (
          <EmptyState message="Nothing to publish — every closed month with data is already published." />
        ) : !isPublisher ? (
          <p className="text-sm text-slate-500">
            Next up: <strong>{fmtMonth(candidate)}</strong>. Publication requires the{" "}
            <span className="font-mono text-xs">publisher</span> role.
          </p>
        ) : gate && !gate.publishable ? (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">{fmtMonth(candidate)} is not publishable yet:</p>
            <ul className="mt-1 list-inside list-disc">
              {gate.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="max-w-md">
            <ActionForm
              action={publishMonthAction}
              submitLabel={`Publish ${fmtMonth(candidate)}`}
              note="The gate re-runs server-side on submit — a stale green button cannot publish a broken month."
            >
              <input type="hidden" name="month" value={candidate} />
              <Field
                label={`Type ${candidate} to confirm`}
                name="confirm"
                placeholder={candidate}
              />
            </ActionForm>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * What the publisher signs off on: the candidate month's live desk totals
 * (which the snapshot will freeze) next to the last published month.
 */
async function PublicationDiff({
  candidate,
  publishedMonths,
}: {
  candidate: string;
  publishedMonths: string[];
}) {
  const prevPublished = publishedMonths.filter((m) => m < candidate).sort().at(-1) ?? null;
  const [current, previous] = await Promise.all([
    getDesks(candidate, "live"),
    prevPublished ? getDesks(prevPublished, "published") : Promise.resolve([]),
  ]);
  const prevByDesk = new Map(previous.map((d) => [d.desk, d.total_cost]));
  const desks = [...new Set([...current.map((d) => d.desk), ...previous.map((d) => d.desk)])];
  const rows = desks
    .map((desk) => {
      const cur = current.find((d) => d.desk === desk)?.total_cost ?? 0;
      const prev = prevByDesk.get(desk) ?? null;
      return { desk, cur, prev, delta: prev == null ? null : cur - prev };
    })
    .sort((a, b) => b.cur - a.cur);

  return (
    <div className="mb-4 rounded-md border border-slate-200 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        What would be published — {fmtMonth(candidate)} (live, to be frozen)
        {prevPublished && <> vs {fmtMonth(prevPublished)} (published)</>}
      </p>
      <table className="w-full max-w-xl">
        <thead>
          <tr>
            <th className="th">Desk</th>
            {prevPublished && <th className="th text-right">{fmtMonth(prevPublished)}</th>}
            <th className="th text-right">{fmtMonth(candidate)}</th>
            {prevPublished && <th className="th text-right">Δ</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.desk}>
              <td className="td">{r.desk}</td>
              {prevPublished && (
                <td className="td text-right tabular-nums">
                  {r.prev == null ? "—" : fmtMoneyExact(r.prev)}
                </td>
              )}
              <td className="td text-right tabular-nums">{fmtMoneyExact(r.cur)}</td>
              {prevPublished && (
                <td
                  className={`td text-right tabular-nums ${
                    (r.delta ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"
                  }`}
                >
                  {r.delta == null ? "—" : `${r.delta >= 0 ? "+" : ""}${fmtMoneyExact(r.delta)}`}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
