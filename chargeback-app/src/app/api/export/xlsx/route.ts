import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { atLeast } from "@/lib/rbac";
import { fmtMonth } from "@/lib/format";
import { buildCommentary, getDeskMovement, getProductMovement } from "@/dal/movement";
import { getDeskScorecard } from "@/dal/desks";
import {
  getDashboard,
  getDeskInvoice,
  getDesks,
  getMonthlyRows,
  getPublishedMonths,
} from "@/dal/reports";
import type { ReportMode } from "@/dal/types";

/**
 * XLSX report pack — the whole monthly report as one workbook:
 * Summary / Movement / Breakdown / Coverage / Scorecard / Invoices.
 */

const MONEY = "#,##0.00";
const PCT = "0.0%";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("unauthenticated", { status: 401 });
  if (!atLeast(session.user.role, "viewer")) return new Response("forbidden", { status: 403 });

  const url = new URL(request.url);
  const mode: ReportMode = url.searchParams.get("mode") === "published" ? "published" : "live";
  let month = url.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    const published = await getPublishedMonths();
    month = published[0] ?? new Date().toISOString().slice(0, 7);
  }

  try {
    const [dashboard, rows, deskMovement, productMovement, scorecard, publishedMonths] =
      await Promise.all([
        getDashboard(month, mode),
        getMonthlyRows(month, mode),
        getDeskMovement(month, mode),
        getProductMovement(month, mode),
        getDeskScorecard(month),
        getPublishedMonths(),
      ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Databricks Chargeback";

    // ---- Summary ----
    const summary = wb.addWorksheet("Summary");
    summary.columns = [{ width: 34 }, { width: 22 }];
    summary.addRows([
      ["Databricks chargeback report", ""],
      ["Month", fmtMonth(month)],
      ["Mode", mode === "published" ? "Published snapshot" : "LIVE (unpublished)"],
      [],
      ["Total cost (USD)", dashboard.totalCost],
      ["Previous month (live)", dashboard.prevMonthCost ?? "—"],
      [
        "MoM change",
        dashboard.prevMonthCost == null ? "—" : dashboard.totalCost - dashboard.prevMonthCost,
      ],
      ["TAG coverage", dashboard.tagCoveragePct],
      ["Unallocated cost", dashboard.unallocatedCost],
    ]);
    summary.getCell("A1").font = { bold: true, size: 14 };
    for (const addr of ["B5", "B6", "B7", "B9"]) summary.getCell(addr).numFmt = MONEY;
    summary.getCell("B8").numFmt = PCT;
    summary.addRow([]);
    summary.addRow(["Commentary"]).font = { bold: true };
    for (const c of buildCommentary(deskMovement, productMovement, (v) => `$${Math.round(v).toLocaleString("en-US")}`)) {
      summary.addRow([c.desk, c.text]);
    }
    summary.addRow([]);
    summary.addRow([
      "Limitations: Databricks DBU cost only (Azure infra out of scope); list-price basis less any configured DBU reservation-plan discount; warehouse queries attributed to start hour; per-query detail limited by ~90-day query history retention.",
    ]);

    // ---- Movement ----
    addTable(
      wb.addWorksheet("Movement"),
      ["Desk", "Previous month", "This month", "Delta", "Delta %"],
      deskMovement.map((d) => [d.desk, d.prev_cost, d.cost, d.delta_abs, d.delta_pct]),
      { 2: MONEY, 3: MONEY, 4: MONEY, 5: PCT },
    );

    // ---- Breakdown ----
    addTable(
      wb.addWorksheet("Breakdown"),
      ["Domain", "Product", "Desk", "Category", "Runners", "DBUs", "Cost"],
      rows.map((r) => [
        r.data_domain,
        r.data_product,
        r.desk,
        r.usage_category,
        r.distinct_runners,
        r.total_dbus,
        r.total_cost,
      ]),
      { 6: "#,##0", 7: MONEY },
    );

    // ---- Coverage ----
    addTable(
      wb.addWorksheet("Coverage"),
      ["Attribution method", "Cost", "Share of month"],
      dashboard.coverage
        .slice()
        .sort((a, b) => b.cost - a.cost)
        .map((c) => [c.attribution_method, c.cost, c.pct_of_month]),
      { 2: MONEY, 3: PCT },
    );

    // ---- Scorecard ----
    addTable(
      wb.addWorksheet("Scorecard"),
      ["Desk", "Total cost", "TAG cost", "TAG %", "Unattributed (NONE) cost"],
      scorecard.map((s) => [s.desk, s.total_cost, s.tag_cost, s.tag_pct, s.none_cost]),
      { 2: MONEY, 3: MONEY, 4: PCT, 5: MONEY },
    );

    // ---- Invoices (published months only) ----
    if (publishedMonths.includes(month)) {
      const invoices = wb.addWorksheet("Invoices");
      addHeader(invoices, ["Desk", "Domain", "Product", "DBUs", "Cost", "Desk total"]);
      const desks = await getDesks(month, "published");
      for (const d of desks) {
        for (const r of await getDeskInvoice(month, d.desk)) {
          const row = invoices.addRow([
            r.desk,
            r.data_domain,
            r.data_product,
            r.total_dbus,
            r.total_cost,
            r.desk_month_total,
          ]);
          row.getCell(4).numFmt = "#,##0";
          row.getCell(5).numFmt = MONEY;
          row.getCell(6).numFmt = MONEY;
        }
      }
      autoWidth(invoices);
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="chargeback-report-${month}-${mode}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[export xlsx]", e);
    return new Response("export failed — check server logs", { status: 500 });
  }
}

function addHeader(ws: ExcelJS.Worksheet, headers: string[]) {
  const row = ws.addRow(headers);
  row.font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function addTable(
  ws: ExcelJS.Worksheet,
  headers: string[],
  rows: (string | number | null)[][],
  numFmtByCol: Record<number, string> = {},
) {
  addHeader(ws, headers);
  for (const r of rows) {
    const row = ws.addRow(r.map((v) => v ?? "—"));
    for (const [col, fmt] of Object.entries(numFmtByCol)) {
      const cell = row.getCell(Number(col));
      if (typeof cell.value === "number") cell.numFmt = fmt;
    }
  }
  autoWidth(ws);
}

function autoWidth(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      max = Math.max(max, String(cell.value ?? "").length + 2);
    });
    col.width = Math.min(max, 60);
  });
}
