"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

/**
 * Search box for admin tables. The query lives in the URL (?q=) so filtered
 * views are linkable and the filtering itself stays on the server — this
 * component only debounces keystrokes into router.replace.
 */
export function TableFilter({ placeholder = "Filter…" }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (next.trim()) params.set("q", next.trim());
      else params.delete("q");
      router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
    }, 250);
  }

  return (
    <Input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="no-print h-8 w-64 max-w-full"
    />
  );
}
