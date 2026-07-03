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
import { PAGE_HELP } from "@/lib/kpi-help";
import { PageTitle } from "@/components/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TablePageSkeleton } from "@/components/loading-skeletons";

export const metadata = { title: "Reference data" };

export default function AdminIndexPage() {
  return (
    <Suspense fallback={<TablePageSkeleton label="Loading reference data from Databricks…" withPicker={false} />}>
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
    {
      href: "/admin/jobs/coverage",
      title: "Job attribution coverage",
      desc: "Read-only: how every job with recent cost was mapped — tag at source, bridge row, or nothing.",
      stat: "trailing 30 days, per-method breakdown",
    },
  ];

  return (
    <div>
      <PageTitle
        title="Reference data"
        subtitle="The write surface of the chargeback system — everything else is derived, read-only logic"
        info={PAGE_HELP.admin}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="block">
            <Card className="h-full transition hover:ring-ring/40 hover:shadow">
              <CardHeader>
                <CardTitle>{i.title}</CardTitle>
                <CardDescription className="text-xs">{i.desc}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs font-medium text-indigo-600">{i.stat}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
