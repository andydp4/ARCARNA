/**
 * ARC-T1-002 Current Stock Levels — per-product stock, par level, status, runway.
 */
import { useRef } from "react";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { ReportFrame } from "@/components/reports/ReportFrame";
import { ReportExportToolbar } from "@/components/reports/ReportExportToolbar";
import { ReportKpi, ReportTable, FlagBadge, type ReportColumn } from "@/components/reports/ReportPrimitives";
import { useReport } from "@/hooks/useReport";
import { reportByRef } from "@/lib/reportCatalog";
import { int, orDash } from "@/lib/reportBrand";
import type { FlagLevel } from "@/lib/reportBrand";
import type { CsvColumn } from "@/lib/reportExport";

const META = reportByRef("ARC-T1-002")!;

interface StockRow {
  product: string;
  sku: string;
  unitsInStock: number;
  parLevel: number;
  status: "CRITICAL" | "RED" | "AMBER" | "GREEN";
  weeksRemaining: number;
}

const STATUS_FLAG: Record<StockRow["status"], FlagLevel> = {
  CRITICAL: "red",
  RED: "red",
  AMBER: "amber",
  GREEN: "green",
};
const STATUS_ACTION: Record<StockRow["status"], string> = {
  CRITICAL: "Stop & Reorder",
  RED: "Reorder Today",
  AMBER: "Reorder This Week",
  GREEN: "Monitor",
};

function weeks(n: number): string {
  if (n >= 999) return "—";
  return `${n.toFixed(1)} wks`;
}

export default function CurrentStockReport() {
  const frameRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, error } = useReport(META.ref);

  const s = data?.summary ?? {};
  const rows = (data?.rows ?? []) as StockRow[];

  const columns: ReportColumn<StockRow>[] = [
    { header: "Product", cell: (r) => r.product },
    { header: "SKU", cell: (r) => orDash(r.sku) },
    { header: "In Stock", cell: (r) => int(r.unitsInStock), keyInfo: true, align: "right" },
    { header: "Par Level", cell: (r) => int(r.parLevel), align: "right" },
    { header: "Weeks Left", cell: (r) => weeks(r.weeksRemaining), keyInfo: true, align: "right" },
    {
      header: "Status",
      cell: (r) => <FlagBadge level={STATUS_FLAG[r.status]}>{STATUS_ACTION[r.status]}</FlagBadge>,
      align: "center",
    },
  ];

  const csv: { rows: StockRow[]; columns: CsvColumn<StockRow>[] } = {
    rows,
    columns: [
      { header: "Product Name", value: (r) => r.product },
      { header: "SKU", value: (r) => r.sku },
      { header: "Units In Stock", value: (r) => r.unitsInStock },
      { header: "Par Level", value: (r) => r.parLevel },
      { header: "Stock Status", value: (r) => r.status },
      { header: "Weeks Remaining", value: (r) => (r.weeksRemaining >= 999 ? "" : r.weeksRemaining.toFixed(1)) },
    ],
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> All reports
        </Link>
      </div>

      <ReportFrame
        ref={frameRef}
        reportRef={META.ref}
        title={META.title}
        tier="Tier 1"
        frequency={META.frequency}
        purpose={META.purpose}
        periodLabel="As of now (real-time)"
        toolbar={<ReportExportToolbar targetRef={frameRef} reportRef={META.ref} csv={csv} />}
        flagLegend={[
          { level: "red", meaning: "At/below par — reorder now" },
          { level: "amber", meaning: "≤ 1.5× par — reorder this week" },
          { level: "green", meaning: "Healthy" },
        ]}
      >
        {error ? (
          <p className="text-sm" style={{ color: "#DC2626" }}>
            {(error as Error).message}.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <ReportKpi label="Products" value={int(Number(s.products) || 0)} keyInfo />
              <ReportKpi label="Critical" value={int(Number(s.critical) || 0)} flag={Number(s.critical) ? "red" : undefined} />
              <ReportKpi label="Reorder Now" value={int(Number(s.red) || 0)} flag={Number(s.red) ? "red" : undefined} />
              <ReportKpi label="Watch" value={int(Number(s.amber) || 0)} flag={Number(s.amber) ? "amber" : undefined} />
              <ReportKpi label="Healthy" value={int(Number(s.green) || 0)} flag="green" />
            </div>

            <div className="mt-5">
              <ReportTable
                columns={columns}
                rows={rows}
                rowFlag={(r) => (r.status === "CRITICAL" || r.status === "RED" ? "red" : undefined)}
                empty={isLoading ? "Loading…" : "No products found. Add products to see stock levels."}
                getRowKey={(r) => r.sku || r.product}
              />
            </div>
          </>
        )}
      </ReportFrame>
    </div>
  );
}
