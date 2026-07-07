"use client";

import { useEffect, useId, useState } from "react";
import { lookupSpNameAction } from "@/actions/insights";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Display-name field for service-principal rows: queries Entra ID for the
 * SP's display name when the dialog opens (dialog content mounts on open)
 * and prefills the input. The value stays editable — the lookup is a
 * convenience, not a source of record — and on miss/failure the field simply
 * behaves like the plain manual input. Used by every "map runner" dialog
 * (work queue, unmapped-runners panel, /ai fix column).
 */
export function SpNameField({ runnerId }: { runnerId: string }) {
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
