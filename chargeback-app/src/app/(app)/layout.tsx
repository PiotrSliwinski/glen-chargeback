import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { atLeast } from "@/lib/rbac";
import { NavLinks, type NavItem } from "@/components/nav-links";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm font-bold tracking-tight text-slate-900">
              ⚡ Chargeback
            </Link>
            <Suspense fallback={null}>
              <RoleNav />
            </Suspense>
          </div>
          <Suspense fallback={null}>
            <UserChip />
          </Suspense>
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
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span>
        {session.user.name}
        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-medium uppercase tracking-wide">
          {session.user.role ?? "no role"}
        </span>
      </span>
    </div>
  );
}
