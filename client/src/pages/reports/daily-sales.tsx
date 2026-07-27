/**
 * ARC-T1-001 Daily Sales Summary — revenue by payment channel for a trading day.
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
import { money, moneyDelta, pct, int, screenDate, isoDate } from "@/lib/reportBrand";
import type { CsvColumn } from "@/lib/reportExport";

const META = reportByRef("ARC-T1-001")!;

interface ChannelRow {
  channel: string;
  revenue: number;
  share: number;
}

export default function DailySalesReport() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [day, setDay] = useState(() => isoDate(new Date()));
  const { data, isLoading, error } = useReport(META.ref, { from: day, to: day });

  const s = data?.summary ?? {};
  const rows = (data?.rows ?? []) as ChannelRow[];

  const columns: ReportColumn<ChannelRow>[] = [
    { header: "Payment Channel", cell: (r) => r.channel },
    { header: "Revenue", cell: (r) => money(r.revenue), keyInfo: true, align: "right" },
    { header: "Share", cell: (r) => pct(r.share), align: "right" },
  ];

  const csv: { rows: ChannelRow[]; columns: CsvColumn<ChannelRow>[] } = {
    rows,
    columns: [
      { header: "Report Date", value: () => day },
      { header: "Payment Channel", value: (r) => r.channel },
      { header: "Revenue GBP", value: (r) => r.revenue.toFixed(2) },
      { header: "Share Pct", value: (r) => r.share.toFixed(1) },
    ],
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> All reports
        </Link>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Trading day</label>
          <Input type="date" value={day} max={isoDate(new Date())} onChange={(e) => setDay(e.target.value)} className="h-9 w-[160px]" />
        </div>
      </div>

      <ReportFrame
        ref={frameRef}
        reportRef={META.ref}
        title={META.title}
        tier="Tier 1"
        frequency={META.frequency}
        purpose={META.purpose}
        periodLabel={`Trading day: ${screenDate(day)}`}
        toolbar={<ReportExportToolbar targetRef={frameRef} reportRef={META.ref} csv={csv} />}
        flagLegend={[
          { level: "red", meaning: "Revenue < 50% of 4-week daily avg" },
          { level: "amber", meaning: "50–80% of average" },
          { level: "green", meaning: "≥ 100% of average" },
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
              <ReportKpi label="Orders Processed" value={int(Number(s.ordersProcessed) || 0)} keyInfo />
              <ReportKpi label="Avg Order Value" value={money(Number(s.avgOrderValue) || 0)} />
              <ReportKpi
                label="vs Yesterday"
                value={moneyDelta(Number(s.vsYesterday) || 0)}
                sub={`vs same day last week ${moneyDelta(Number(s.vsLastWeek) || 0)}`}
              />
            </div>

            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold" style={{ color: "#1E3A8A" }}>
                Revenue by Channel
              </h3>
              <ReportTable
                columns={columns}
                rows={rows}
                empty={isLoading ? "Loading…" : "No sales data for this period. Check date range."}
                getRowKey={(r) => r.channel}
              />
            </div>
          </>
        )}
      </ReportFrame>
    </div>
  );
}
