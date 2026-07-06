import { Suspense } from "react";
import Link from "next/link";
import { requirePageRole } from "@/lib/guards";
import {
  listCatalogue,
  listEndpointMappings,
  listJobMappings,
  listRunnerRules,
  listTagRules,
  listUsers,
  listWarehouseMappings,
  listWorkspaces,
} from "@/dal/mappings";
import {
  listAzureResourceMappings,
  listAzureRgRules,
  listAzureSubscriptionRules,
  listAzureTagRules,
} from "@/dal/azure";
import { listDbuDiscounts } from "@/dal/discounts";
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
  const [
    catalogue,
    jobs,
    warehouses,
    endpoints,
    users,
    workspaces,
    tagRules,
    runnerRules,
    azureResources,
    azureTagRules,
    azureRgRules,
    azureSubRules,
    dbuDiscounts,
  ] = await Promise.all([
    listCatalogue(),
    listJobMappings(),
    listWarehouseMappings(),
    listEndpointMappings(),
    listUsers(),
    listWorkspaces(),
    listTagRules(),
    listRunnerRules(),
    listAzureResourceMappings(),
    listAzureTagRules(),
    listAzureRgRules(),
    listAzureSubscriptionRules(),
    listDbuDiscounts(),
  ]);
  const activeProducts = new Set(
    catalogue.filter((r) => r.valid_to == null).map((r) => r.data_product),
  ).size;
  const today = new Date().toISOString().slice(0, 10);
  const activeDiscount = dbuDiscounts.find((d) => d.valid_from <= today && d.valid_to >= today);

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
      href: "/admin/azure",
      title: "Azure attribution",
      desc: "Resource bridge, tag rules, resource-group and subscription rules routing Azure spend to the same product catalogue, plus a 30-day coverage audit. Only matched cost reaches a desk.",
      stat: `${azureResources.length} bridge rows · ${azureTagRules.length} tag rules · ${azureRgRules.length + azureSubRules.length} scope rules`,
    },
    {
      href: "/admin/discounts",
      title: "DBU discounts",
      desc: "dbu_discount_plan — reservation-plan windows billing Databricks DBU spend at list price × (1 − discount). Applied at pricing time; never touches Azure cost.",
      stat: `${dbuDiscounts.length} ${dbuDiscounts.length === 1 ? "window" : "windows"} · ${activeDiscount ? `${Math.round(activeDiscount.discount_pct * 1000) / 10}% active today` : "none active today"}`,
    },
    {
      href: "/admin/warehouses",
      title: "Warehouses",
      desc: "warehouse_product_mapping — dedicated vs shared SQL warehouses.",
      stat: `${warehouses.length} classified`,
    },
    {
      href: "/admin/endpoints",
      title: "AI endpoints",
      desc: "endpoint_product_mapping — dedicated model-serving endpoints (realtime + ai_query batch inference) routed to one product. Rule 4b, the serving analogue of a dedicated warehouse.",
      stat: `${endpoints.length} mapped`,
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
