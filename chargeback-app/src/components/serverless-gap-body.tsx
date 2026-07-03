"use client";

import { useEffect, useState } from "react";
import { loadServerlessGapAction, type ServerlessGapResult } from "@/actions/insights";
import { upsertUserAction } from "@/actions/mappings";
import { ActionForm, Field } from "@/components/action-form";
import { GapSkeleton } from "@/components/serverless-gap-panel";
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

/**
 * Lazy-loaded body of the serverless-gap panel: fetches through the
 * loadServerlessGapAction server action on mount (i.e. on first expand),
 * renders the gap table with an inline "map user" fix per row.
 */
export default function ServerlessGapBody({ deskOptions }: { deskOptions: string[] }) {
  const [result, setResult] = useState<ServerlessGapResult | null>(null);
  const [scanId, setScanId] = useState(0);

  // result is reset to null (→ skeleton) in the re-scan handlers, not here —
  // the effect only kicks off the fetch and stores its outcome.
  useEffect(() => {
    let cancelled = false;
    loadServerlessGapAction().then((r) => {
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

  if (result == null) return <GapSkeleton />;

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

  const total = result.rows.reduce((s, r) => s + r.serverless_cost_30d, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {result.rows.length === 0 ? (
            <>Every serverless runner of the last 30 days is mapped. 🎉</>
          ) : (
            <>
              <span className="font-medium text-foreground">{result.rows.length}</span> unmapped
              runner{result.rows.length > 1 ? "s" : ""} ·{" "}
              <span className="font-medium text-foreground">{fmtMoney(total)}</span> serverless
              spend in 30 days
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
              <TableHead className="text-right">Serverless cost 30d</TableHead>
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
                <TableCell className="font-mono text-xs">{r.runner}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtMoney(r.serverless_cost_30d)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {fmtDbu(r.serverless_dbus_30d)}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="bg-violet-100 text-violet-800">
                    {r.top_category}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">{r.workspace_count}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.last_seen}</TableCell>
                <TableCell>
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
                      Map user
                    </summary>
                    <div className="mt-2 max-w-md rounded-lg border bg-muted/50 p-3">
                      <ActionForm
                        action={upsertUserAction}
                        submitLabel="Map user"
                        note="The runner ID is pre-filled from cost_fact and read-only — identity fidelity. Re-scan afterwards to see the row clear."
                      >
                        <Field label="User ID" name="user_id" defaultValue={r.runner} readOnly />
                        <Field label="Display name" name="user_name" />
                        <div className="space-y-1.5">
                          <Label
                            htmlFor={`gap-desk-${r.runner}`}
                            className="text-xs text-muted-foreground"
                          >
                            Home desk
                          </Label>
                          <Input
                            id={`gap-desk-${r.runner}`}
                            name="desk"
                            required
                            list="gap-desk-options"
                          />
                        </div>
                      </ActionForm>
                    </div>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <datalist id="gap-desk-options">
        {deskOptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <p className="text-xs text-muted-foreground">
        Scanned at {new Date(result.fetchedAt).toLocaleTimeString()} · trailing 30 days ·
        is_serverless = true only. Mapping a runner routes their future ad-hoc spend to their
        desk via the USER rule; tagged job spend is unaffected (TAG wins anyway).
      </p>
    </div>
  );
}
