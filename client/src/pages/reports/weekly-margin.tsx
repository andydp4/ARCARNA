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
  /** Sale lines below the minimum / below cost this week (the price policy). */
  belowMinimumLines?: number;
  belowCostLines?: number;
  policyFlag?: "below_cost" | "below_minimum" | "ok";
}

const NO_COST = "No cost set";

/**
 * The flag follows the price policy (v1.2 Phase 4, owner Q3): a product sold
 * below cost or below its minimum this week is flagged, whatever its margin.
 * The old hard-coded "margin under 20%" rule is gone; margin % is shown, not judged.
 */
function policyFlag(r: Row): FlagLevel {
  if (r.policyFlag === "below_cost") return "red";
  if (r.policyFlag === "below_minimum") return "amber";
  if (r.costPrice == null) return "gold";
  return "green";
}
const flagAction: Record<FlagLevel, string> = {
  green: "Within policy",
  blue: "Within policy",
  amber: "Sold below minimum",
  red: "Sold below cost",
  gold: "Set a cost",
};
function flagText(r: Row): string {
  const level = policyFlag(r);
  if (level === "red") return `${flagAction.red} (${r.belowCostLines ?? 0})`;
  if (level === "amber") return `${flagAction.amber} (${r.belowMinimumLines ?? 0})`;
  return flagAction[level];
}

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
          { level: "green", meaning: "Within your price policy" },
          { level: "amber", meaning: "Sold below the minimum price this week" },
          { level: "red", meaning: "Sold below cost this week" },
          { level: "gold", meaning: "No cost set" },
        ],
        rowFlag: (r) => (policyFlag(r) === "red" ? "red" : policyFlag(r) === "amber" ? "amber" : undefined),
        controls: (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">Week of</label>
            <Input aria-label="Week of"
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
            cell: (r) => <FlagBadge level={policyFlag(r)}>{flagText(r)}</FlagBadge>,
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
          { header: "Lines Below Minimum", value: (r) => r.belowMinimumLines ?? 0 },
          { header: "Lines Below Cost", value: (r) => r.belowCostLines ?? 0 },
        ],
      }}
    />
  );
}
