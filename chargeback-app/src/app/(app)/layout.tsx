import { Suspense } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { atLeast } from "@/lib/rbac";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { Badge } from "@/components/ui/badge";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-bold tracking-tight">
            <Zap className="size-4 text-amber-500" fill="currentColor" aria-hidden />
            Chargeback
          </Link>
          <div className="order-3 -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 md:order-none md:mx-0 md:w-auto md:flex-1 md:overflow-x-visible">
            <Suspense fallback={null}>
              <RoleNav />
            </Suspense>
          </div>
          <div className="ml-auto">
            <Suspense fallback={null}>
              <UserChip />
            </Suspense>
          </div>
        </div>
      </header>
      {env.DAL_MOCK && (
        <div className="no-print bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-800">
          Mock data mode — no Databricks connection configured. All figures are fixtures.
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

async function RoleNav() {
  const session = await getSession();
  if (!session) redirect("/login");
  const items: NavItem[] = [
    { href: "/", label: "Dashboard" },
    { href: "/report", label: "Monthly Report" },
    { href: "/analytics", label: "Analytics" },
    { href: "/ai", label: "AI Costs" },
    { href: "/drill", label: "Drill-down" },
    { href: "/desks", label: "Desks" },
    { href: "/invoices", label: "Invoices" },
  ];
  if (atLeast(session.user.role, "steward")) {
    items.push(
      { href: "/queue", label: "Work Queue" },
      { href: "/admin", label: "Reference Data" },
      { href: "/health", label: "Health" },
    );
  }
  return <NavLinks items={items} />;
}

async function UserChip() {
  const session = await getSession();
  if (!session) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{session.user.name}</span>
      <Badge variant="secondary" className="uppercase tracking-wide">
        {session.user.role ?? "no role"}
      </Badge>
    </div>
  );
}
