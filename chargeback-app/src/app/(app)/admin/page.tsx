import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import {
  listCatalogue,
  listJobMappings,
  listUsers,
  listWarehouseMappings,
  listWorkspaces,
} from "@/dal/mappings";
import { Card, PageTitle } from "@/components/ui";

export const metadata = { title: "Reference data" };

export default function AdminIndexPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <AdminIndex />
    </Suspense>
  );
}

async function AdminIndex() {
  await requirePageRole("steward");
  const [catalogue, jobs, warehouses, users, workspaces] = await Promise.all([
    listCatalogue(),
    listJobMappings(),
    listWarehouseMappings(),
    listUsers(),
    listWorkspaces(),
  ]);
  const activeProducts = new Set(
    catalogue.filter((r) => r.valid_to == null).map((r) => r.data_product),
  ).size;

  const items = [
    {
      href: "/admin/products",
      title: "Product catalogue",
      desc: "data_product_mapping — the hierarchy backbone. Validity-versioned: domain and desk always derive from here.",
      stat: `${activeProducts} active products, ${catalogue.length} rows incl. history`,
    },
    {
      href: "/admin/jobs",
      title: "Job bridge",
      desc: "job_product_mapping — temporary bridge for untagged jobs. Target state: empty.",
      stat: `${jobs.length} mappings`,
    },
    {
      href: "/admin/warehouses",
      title: "Warehouses",
      desc: "warehouse_product_mapping — dedicated vs shared SQL warehouses.",
      stat: `${warehouses.length} classified`,
    },
    {
      href: "/admin/users",
      title: "Users",
      desc: "user_mapping — runner identity → display name + home desk (AD_HOC attribution).",
      stat: `${users.length} runners`,
    },
    {
      href: "/admin/workspaces",
      title: "Workspaces",
      desc: "workspace_mapping — workspace ID → friendly name.",
      stat: `${workspaces.length} workspaces`,
    },
  ];

  return (
    <div>
      <PageTitle
        title="Reference data"
        subtitle="The write surface of the chargeback system — everything else is derived, read-only logic"
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="block">
            <Card className="h-full transition hover:border-indigo-300 hover:shadow">
              <h2 className="text-sm font-semibold text-slate-900">{i.title}</h2>
              <p className="mt-1 text-xs text-slate-500">{i.desc}</p>
              <p className="mt-3 text-xs font-medium text-indigo-600">{i.stat}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
