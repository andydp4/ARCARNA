/** ARC-T2-001 Weekly Margin Summary. */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { ReportScopeFilter, StaffFilterFootnote, type ReportScopeValue } from "@/components/reports/ReportScopeFilter";
import { money, int, pct, screenDate, isoDate } from "@/lib/reportBrand";
import { mondayWeekBounds } from "@/lib/weekBounds";
import type { FlagLevel } from "@/lib/reportBrand";

interface Row {
  product: string;
  unitsSold: number;
  /** Units sold with no cost set: left out of the margin, never costed at £0. */
  costMissingUnits?: number;
  /** Null when no unit sold had a known cost ("No cost set"). */
  costPrice: number | null;
  avgSellPrice: number;
  minSellPrice: number;
  maxSellPrice: number;
  grossMargin: number | null;
  marginPct: number | null;
  totalMargin: number;
}

const NO_COST = "No cost set";

function marginFlag(pctVal: number | null): FlagLevel {
  if (pctVal == null) return "gold";
  if (pctVal >= 45) return "green";
  if (pctVal >= 30) return "blue";
  if (pctVal >= 20) return "amber";
  return "red";
}
const marginAction: Record<FlagLevel, string> = {
  green: "Healthy",
  blue: "Monitor",
  amber: "Review Pricing",
  red: "Reprice Now",
  gold: "Set a cost",
};

export default function WeeklyMarginReport() {
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const bounds = mondayWeekBounds(new Date(anchor));
  const [scope, setScope] = useState<ReportScopeValue>({});

  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T2-001",
        params: { ...bounds, ...scope },
        showRevenueDefinitionNote: true,
        periodLabel: () => `Week ${screenDate(bounds.from)} – ${screenDate(bounds.to)}`,
        tableHeading: "Margin by Product (highest contribution first)",
        emptyText: "No sales this week — no margin to report.",
        flagLegend: [
          { level: "green", meaning: "≥ 45% margin" },
          { level: "blue", meaning: "30–44%" },
          { level: "amber", meaning: "20–29% — review" },
          { level: "red", meaning: "< 20% — reprice" },
        ],
        rowFlag: (r) => (r.marginPct != null && r.marginPct < 20 ? "red" : undefined),
        controls: (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">Week of</label>
            <Input
              type="date"
              value={anchor}
              max={isoDate(new Date())}
              onChange={(e) => setAnchor(e.target.value)}
              className="h-9 w-[160px]"
            />
            <ReportScopeFilter value={scope} onChange={setScope} />
            <div className="basis-full">
              <StaffFilterFootnote value={scope} />
            </div>
          </div>
        ),
        kpis: (s) => [
          { label: "Products Sold", value: int(s.products), keyInfo: true },
          { label: "Total Margin", value: money(s.totalMargin), keyInfo: true },
          { label: "Avg Margin", value: pct(s.avgMarginPct), keyInfo: true },
        ],
        columns: [
          { header: "Product", cell: (r) => r.product },
          {
            header: "Units",
            cell: (r) =>
              r.costMissingUnits ? `${int(r.unitsSold)} (${int(r.costMissingUnits)} cost missing)` : int(r.unitsSold),
            align: "right",
          },
          { header: "Cost", cell: (r) => (r.costPrice == null ? NO_COST : money(r.costPrice)), align: "right" },
          { header: "Avg Sell", cell: (r) => money(r.avgSellPrice), keyInfo: true, align: "right" },
          { header: "Margin/Unit", cell: (r) => (r.grossMargin == null ? "—" : money(r.grossMargin)), keyInfo: true, align: "right" },
          { header: "Margin %", cell: (r) => (r.marginPct == null ? "—" : pct(r.marginPct)), keyInfo: true, align: "right" },
          { header: "Total Margin", cell: (r) => money(r.totalMargin), keyInfo: true, align: "right" },
          {
            header: "Flag",
            cell: (r) => <FlagBadge level={marginFlag(r.marginPct)}>{marginAction[marginFlag(r.marginPct)]}</FlagBadge>,
            align: "center",
          },
        ],
        csvColumns: [
          { header: "Product Name", value: (r) => r.product },
          { header: "Units Sold", value: (r) => r.unitsSold },
          { header: "Units Cost Missing", value: (r) => r.costMissingUnits ?? 0 },
          { header: "Cost Price GBP", value: (r) => (r.costPrice == null ? "" : r.costPrice.toFixed(2)) },
          { header: "Avg Sell Price GBP", value: (r) => r.avgSellPrice.toFixed(2) },
          { header: "Min Sell Price GBP", value: (r) => r.minSellPrice.toFixed(2) },
          { header: "Max Sell Price GBP", value: (r) => r.maxSellPrice.toFixed(2) },
          { header: "Gross Margin Per Unit GBP", value: (r) => (r.grossMargin == null ? "" : r.grossMargin.toFixed(2)) },
          { header: "Margin Pct", value: (r) => (r.marginPct == null ? "" : r.marginPct.toFixed(1)) },
          { header: "Total Margin GBP", value: (r) => r.totalMargin.toFixed(2) },
        ],
      }}
    />
  );
}
