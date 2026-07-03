import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import {
  listCatalogue,
  listJobMappings,
  listRunnerRules,
  listTagRules,
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
  const [catalogue, jobs, warehouses, users, workspaces, tagRules, runnerRules] =
    await Promise.all([
      listCatalogue(),
      listJobMappings(),
      listWarehouseMappings(),
      listUsers(),
      listWorkspaces(),
      listTagRules(),
      listRunnerRules(),
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
      title: "Job attribution",
      desc: "Bridge rows, tag rules and runner rules for jobs not tagged at source, plus a 30-day coverage audit of how every job actually attributed. Job spend never defaults to the runner's desk.",
      stat: `${jobs.length} bridge rows · ${tagRules.length} tag rules · ${runnerRules.length} runner rules`,
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
