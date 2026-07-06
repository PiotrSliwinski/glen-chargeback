import { Suspense } from "react";
import Link from "next/link";
import {
  Activity,
  ChartColumn,
  Database,
  FileText,
  LayoutDashboard,
  ListTodo,
  ListTree,
  Receipt,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { atLeast } from "@/lib/rbac";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { Badge } from "@/components/ui/badge";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="px-4 pt-5 pb-3">
          <BrandLink />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <Suspense fallback={null}>
            <RoleNav orientation="vertical" />
          </Suspense>
        </div>
        <div className="border-t px-4 py-3">
          <Suspense fallback={null}>
            <UserChip />
          </Suspense>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print border-b bg-card lg:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <BrandLink />
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
    </div>
  );
}

function BrandLink() {
  return (
    <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-bold tracking-tight">
      <Zap className="size-4 text-amber-500" fill="currentColor" aria-hidden />
      Chargeback
    </Link>
  );
}

async function RoleNav({ orientation = "horizontal" }: { orientation?: "horizontal" | "vertical" }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const items: NavItem[] = [
    { href: "/", label: "Dashboard", icon: <LayoutDashboard aria-hidden /> },
    { href: "/report", label: "Monthly Report", icon: <FileText aria-hidden /> },
    { href: "/analytics", label: "Analytics", icon: <ChartColumn aria-hidden /> },
    { href: "/ai", label: "AI Costs", icon: <Sparkles aria-hidden /> },
    { href: "/drill", label: "Drill-down", icon: <ListTree aria-hidden /> },
    { href: "/desks", label: "Desks", icon: <Users aria-hidden /> },
    { href: "/invoices", label: "Invoices", icon: <Receipt aria-hidden /> },
  ];
  const stewardItems: NavItem[] = atLeast(session.user.role, "steward")
    ? [
        { href: "/queue", label: "Work Queue", icon: <ListTodo aria-hidden /> },
        { href: "/admin", label: "Reference Data", icon: <Database aria-hidden /> },
        { href: "/health", label: "Health", icon: <Activity aria-hidden /> },
      ]
    : [];
  if (orientation === "horizontal") {
    return <NavLinks items={[...items, ...stewardItems]} />;
  }
  return (
    <>
      <NavLinks items={items} orientation="vertical" />
      {stewardItems.length > 0 && (
        <>
          <div className="px-2.5 pt-4 pb-1 text-xs font-medium text-muted-foreground">Manage</div>
          <NavLinks items={stewardItems} orientation="vertical" />
        </>
      )}
    </>
  );
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
