/**
 * ARC-T1-004 Weekly Sales Summary — week revenue, orders, channel mix, top 5 products.
 */
import { useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportFrame } from "@/components/reports/ReportFrame";
import { ReportExportToolbar } from "@/components/reports/ReportExportToolbar";
import { ReportKpi, ReportTable, type ReportColumn } from "@/components/reports/ReportPrimitives";
import { useReport } from "@/hooks/useReport";
import { reportByRef } from "@/lib/reportCatalog";
import { money, moneyDelta, int, screenDate, isoDate, orDash } from "@/lib/reportBrand";
import type { CsvColumn } from "@/lib/reportExport";

const META = reportByRef("ARC-T1-004")!;

interface ProductRow {
  rank: number;
  product: string;
  units: number;
  revenue: number;
}

/** Monday→Sunday week containing `d` (returns ISO start/end). */
function weekBounds(d: Date): { from: string; to: string } {
  const start = new Date(d);
  const day = (start.getDay() + 6) % 7; // 0 = Monday
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: isoDate(start), to: isoDate(end) };
}

export default function WeeklySalesReport() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const bounds = weekBounds(new Date(anchor));
  const { data, isLoading, error } = useReport(META.ref, bounds);

  const s = data?.summary ?? {};
  const rows = (data?.rows ?? []) as ProductRow[];

  const columns: ReportColumn<ProductRow>[] = [
    { header: "#", cell: (r) => r.rank, align: "center" },
    { header: "Product", cell: (r) => r.product },
    { header: "Units", cell: (r) => int(r.units), align: "right" },
    { header: "Revenue", cell: (r) => money(r.revenue), keyInfo: true, align: "right" },
  ];

  const csv: { rows: ProductRow[]; columns: CsvColumn<ProductRow>[] } = {
    rows,
    columns: [
      { header: "Week Ending", value: () => bounds.to },
      { header: "Rank", value: (r) => r.rank },
      { header: "Product", value: (r) => r.product },
      { header: "Units Sold", value: (r) => r.units },
      { header: "Revenue GBP", value: (r) => r.revenue.toFixed(2) },
    ],
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> All reports
        </Link>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Week of</label>
          <Input type="date" value={anchor} max={isoDate(new Date())} onChange={(e) => setAnchor(e.target.value)} className="h-9 w-[160px]" />
        </div>
      </div>

      <ReportFrame
        ref={frameRef}
        reportRef={META.ref}
        title={META.title}
        tier="Tier 1"
        frequency={META.frequency}
        purpose={META.purpose}
        periodLabel={`Week ${screenDate(bounds.from)} – ${screenDate(bounds.to)}`}
        toolbar={<ReportExportToolbar targetRef={frameRef} reportRef={META.ref} csv={csv} />}
        flagLegend={[
          { level: "red", meaning: "Revenue < 70% of 4-week avg" },
          { level: "green", meaning: "≥ 120% of average" },
        ]}
      >
        {error ? (
          <p className="text-sm" style={{ color: "#DC2626" }}>
            {(error as Error).message}. Check the date range.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ReportKpi label="Total Revenue" value={money(Number(s.totalRevenue) || 0)} keyInfo />
              <ReportKpi label="Total Orders" value={int(Number(s.totalOrders) || 0)} keyInfo />
              <ReportKpi label="Avg Order Value" value={money(Number(s.avgOrderValue) || 0)} keyInfo />
              <ReportKpi
                label="vs Previous Week"
                value={moneyDelta(Number(s.vsPrevWeek) || 0)}
                sub={`Peak day: ${orDash(s.peakTradingDay as string)}`}
              />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ReportKpi label="Cash" value={money(Number(s.cashRevenue) || 0)} />
              <ReportKpi label="Card" value={money(Number(s.cardRevenue) || 0)} />
              <ReportKpi label="Website" value={money(Number(s.websiteRevenue) || 0)} />
              <ReportKpi label="Reseller" value={money(Number(s.resellerRevenue) || 0)} />
            </div>

            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold" style={{ color: "#1E3A8A" }}>
                Top 5 Products
              </h3>
              <ReportTable
                columns={columns}
                rows={rows}
                empty={isLoading ? "Loading…" : "No sales data for this week. Check date range."}
                getRowKey={(r) => String(r.rank)}
              />
            </div>
          </>
        )}
      </ReportFrame>
    </div>
  );
}
