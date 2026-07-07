"use client";

import { useEffect, useState } from "react";
import { loadUnmappedRunnersAction, type UnmappedRunnersResult } from "@/actions/insights";
import { upsertUserAction } from "@/actions/mappings";
import { SpNameField } from "@/components/sp-name-field";
import { ActionForm, DatalistField, Field } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import { ScanSkeleton } from "@/components/unmapped-runners-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/table-pagination";
import { fmtDbu, fmtMoney } from "@/lib/format";
import { isServicePrincipal } from "@/lib/identity";
import { paginate } from "@/lib/paginate";

/**
 * Lazy-loaded body of the unmapped-runners panel: fetches through the
 * loadUnmappedRunnersAction server action on mount (i.e. on first expand),
 * renders the table with an inline "map user" fix per row.
 */
export default function UnmappedRunnersBody({ deskOptions }: { deskOptions: string[] }) {
  const [result, setResult] = useState<UnmappedRunnersResult | null>(null);
  const [scanId, setScanId] = useState(0);
  // panel is lazy-loaded client-side, so its page lives in state, not the URL
  const [page, setPage] = useState(1);

  // result is reset to null (→ skeleton) in the re-scan handlers, not here —
  // the effect only kicks off the fetch and stores its outcome.
  useEffect(() => {
    let cancelled = false;
    loadUnmappedRunnersAction().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const rescan = () => {
    setResult(null);
    setPage(1);
    setScanId((n) => n + 1);
  };

  if (result == null) return <ScanSkeleton />;

  if (!result.ok) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {result.message}
        </p>
        <Button variant="outline" size="sm" onClick={rescan}>
          Try again
        </Button>
      </div>
    );
  }

  const total = result.rows.reduce((s, r) => s + r.cost_30d, 0);
  const spCount = result.rows.filter((r) => isServicePrincipal(r.runner)).length;
  const { rows: pageRows, ...paged } = paginate(result.rows, String(page));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {result.rows.length === 0 ? (
            <>Every runner who spent in the last 30 days is mapped.</>
          ) : (
            <>
              <span className="font-medium text-foreground">{result.rows.length}</span> unmapped
              runner{result.rows.length > 1 ? "s" : ""} ({spCount} service principal
              {spCount === 1 ? "" : "s"}) ·{" "}
              <span className="font-medium text-foreground">{fmtMoney(total)}</span> spend in 30
              days
            </>
          )}
        </p>
        <Button variant="outline" size="sm" onClick={rescan}>
          Re-scan
        </Button>
      </div>

      {result.rows.length > 0 && (
        <Table className="align-top">
          <TableHeader>
            <TableRow>
              <TableHead>Runner</TableHead>
              <TableHead className="text-right">Cost 30d</TableHead>
              <TableHead className="text-right">of which serverless</TableHead>
              <TableHead className="text-right">DBUs</TableHead>
              <TableHead>Top category</TableHead>
              <TableHead>Workspaces</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>
                <span className="sr-only">Fix</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((r) => (
              <TableRow key={r.runner}>
                <TableCell className="font-mono text-xs">
                  {r.runner}
                  {isServicePrincipal(r.runner) && (
                    <Badge variant="secondary" className="ml-2 font-sans">
                      SP
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.cost_30d)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.serverless_cost_30d > 0 ? fmtMoney(r.serverless_cost_30d) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {fmtDbu(r.dbus_30d)}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="bg-violet-100 text-violet-800">
                    {r.top_category}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">{r.workspace_count}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.last_seen}</TableCell>
                <TableCell>
                  <EditDialog
                    trigger={<RowAction>Map user</RowAction>}
                    title={`Map ${r.runner}`}
                    description="The runner ID is pre-filled from cost_fact and read-only — identity fidelity. Re-scan afterwards to see the row clear."
                  >
                    <ActionForm action={upsertUserAction} submitLabel="Map user">
                      <Field label="User ID" name="user_id" defaultValue={r.runner} readOnly />
                      {isServicePrincipal(r.runner) ? (
                        <SpNameField runnerId={r.runner} />
                      ) : (
                        <Field label="Display name" name="user_name" />
                      )}
                      <DatalistField label="Home desk" name="desk" options={deskOptions} />
                    </ActionForm>
                  </EditDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <TablePagination {...paged} noun="runner" onPageChange={setPage} />

      <p className="text-xs text-muted-foreground">
        Scanned at {new Date(result.fetchedAt).toLocaleTimeString()} · trailing 30 days · all
        compute, serverless slice broken out. Mapping a runner routes their future ad-hoc spend to
        their desk via the USER rule; tagged job spend is unaffected (TAG wins anyway).
      </p>
    </div>
  );
}
