"use client";

import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firstOfNextMonth } from "@/lib/format";

/**
 * Date input defaulting to the first of next month, computed in the browser
 * after mount. Runtime-prefetched routes (e.g. /queue) must not read the
 * server clock during render (next-prerender-runtime-current-time), so the
 * default cannot be a server-rendered `firstOfNextMonth()` prop.
 */
export function NextMonthDateField({ label, name }: { label: string; name: string }) {
  const id = useId();
  const [value, setValue] = useState("");
  useEffect(() => {
    // The clock may only be read after mount (never during server render or
    // prerender), so a post-mount setState is the point of this component.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue((v) => (v === "" ? firstOfNextMonth() : v));
  }, []);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        name={name}
        type="date"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );
}
