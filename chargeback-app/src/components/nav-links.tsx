"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ReactNode;
}

/**
 * Pulsing indicator while the destination page's Databricks queries run.
 * Absolutely positioned so the nav doesn't shift when it appears: an
 * underline in the horizontal nav, a left edge bar in the sidebar.
 */
function PendingIndicator({ vertical }: { vertical: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        "absolute rounded-full bg-primary transition-opacity",
        vertical ? "inset-y-1.5 left-0 w-0.5" : "inset-x-2 bottom-0.5 h-0.5",
        pending ? "animate-pulse opacity-100" : "opacity-0",
      )}
    />
  );
}

export function NavLinks({
  items,
  orientation = "horizontal",
}: {
  items: NavItem[];
  orientation?: "horizontal" | "vertical";
}) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";
  return (
    <nav
      className={cn(
        vertical
          ? "flex flex-col gap-0.5"
          : "flex w-max items-center gap-1 md:w-auto md:flex-wrap",
      )}
    >
      {items.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Button
            key={item.href}
            asChild
            size="sm"
            variant={active ? "secondary" : "ghost"}
            className={cn(
              "relative px-2.5",
              vertical && "w-full justify-start gap-2",
              active ? undefined : "text-muted-foreground",
            )}
          >
            <Link href={item.href} aria-current={active ? "page" : undefined}>
              {vertical && item.icon}
              {item.label}
              <PendingIndicator vertical={vertical} />
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
