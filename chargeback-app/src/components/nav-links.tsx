"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Pulsing underline while the destination page's Databricks queries run.
 * Absolutely positioned so the nav doesn't shift when it appears.
 */
function PendingIndicator() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        "absolute inset-x-2 bottom-0.5 h-0.5 rounded-full bg-primary transition-opacity",
        pending ? "animate-pulse opacity-100" : "opacity-0",
      )}
    />
  );
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1">
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Button
            key={item.href}
            asChild
            size="sm"
            variant={active ? "secondary" : "ghost"}
            className={cn("relative", active ? undefined : "text-muted-foreground")}
          >
            <Link href={item.href}>
              {item.label}
              <PendingIndicator />
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
