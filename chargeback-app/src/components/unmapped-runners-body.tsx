"use client";

import { useEffect, useId, useState } from "react";
import {
  loadUnmappedRunnersAction,
  lookupSpNameAction,
  type UnmappedRunnersResult,
} from "@/actions/insights";
import { upsertUserAction } from "@/actions/mappings";
import { ActionForm, DatalistField, Field } from "@/components/action-form";
import { EditDialog, RowAction } from "@/components/edit-dialog";
import { ScanSkeleton } from "@/components/unmapped-runners-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDbu, fmtMoney } from "@/lib/format";
import { isServicePrincipal } from "@/lib/identity";

/**
 * Display-name field for SPN rows: queries Entra ID for the service
 * principal's display name when the dialog opens (dialog content mounts on
 * open) and prefills the input. The value stays editable — the lookup is a
 * convenience, not a source of record — and on miss/failure the field simply
 * behaves like the plain manual input.
 */
function SpNameField({ runnerId }: { runnerId: string }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"pending" | "done" | { error: string }>("pending");

  useEffect(() => {
    let cancelled = false;
    lookupSpNameAction(runnerId).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setStatus({ error: r.message });
      } else if (r.name == null) {
        setStatus({ error: "Not in Entra ID (Databricks-native SP?) — enter a name manually." });
      } else {
        // Don't clobber anything the steward typed while the lookup ran.
        setValue((v) => (v === "" ? r.name! : v));
        setStatus("done");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runnerId]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Display name
      </Label>
      <Input
        id={id}
        name="user_name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        placeholder={status === "pending" ? "Looking up in Entra ID…" : undefined}
      />
      {status === "done" && (
        <p className="text-xs text-muted-foreground">Name fetched from Entra ID — editable.</p>
      )}
      {typeof status === "object" && <p className="text-xs text-destructive">{status.error}</p>}
    </div>
  );
}

/**
 * Lazy-loaded body of the unmapped-runners panel: fetches through the
 * loadUnmappedRunnersAction server action on mount (i.e. on first expand),
 * renders the table with an inline "map user" fix per row.
 */
export default function UnmappedRunnersBody({ deskOptions }: { deskOptions: string[] }) {
  const [result, setResult] = useState<UnmappedRunnersResult | null>(null);
  const [scanId, setScanId] = useState(0);

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
            {result.rows.map((r) => (
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

      <p className="text-xs text-muted-foreground">
        Scanned at {new Date(result.fetchedAt).toLocaleTimeString()} · trailing 30 days · all
        compute, serverless slice broken out. Mapping a runner routes their future ad-hoc spend to
        their desk via the USER rule; tagged job spend is unaffected (TAG wins anyway).
      </p>
    </div>
  );
}
