/** ARC-T2-001 Weekly Margin Summary. */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { money, int, pct, screenDate, isoDate } from "@/lib/reportBrand";
import type { FlagLevel } from "@/lib/reportBrand";

interface Row {
  product: string;
  unitsSold: number;
  costPrice: number;
  avgSellPrice: number;
  minSellPrice: number;
  maxSellPrice: number;
  grossMargin: number;
  marginPct: number;
  totalMargin: number;
}

function marginFlag(pctVal: number): FlagLevel {
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
  gold: "Review",
};

function weekBounds(d: Date): { from: string; to: string } {
  const start = new Date(d);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: isoDate(start), to: isoDate(end) };
}

export default function WeeklyMarginReport() {
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const bounds = weekBounds(new Date(anchor));

  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T2-001",
        params: bounds,
        periodLabel: () => `Week ${screenDate(bounds.from)} – ${screenDate(bounds.to)}`,
        tableHeading: "Margin by Product (highest contribution first)",
        emptyText: "No sales this week — no margin to report.",
        flagLegend: [
          { level: "green", meaning: "≥ 45% margin" },
          { level: "blue", meaning: "30–44%" },
          { level: "amber", meaning: "20–29% — review" },
          { level: "red", meaning: "< 20% — reprice" },
        ],
        rowFlag: (r) => (r.marginPct < 20 ? "red" : undefined),
        controls: (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Week of</label>
            <Input
              type="date"
              value={anchor}
              max={isoDate(new Date())}
              onChange={(e) => setAnchor(e.target.value)}
              className="h-9 w-[160px]"
            />
          </div>
        ),
        kpis: (s) => [
          { label: "Products Sold", value: int(s.products), keyInfo: true },
          { label: "Total Margin", value: money(s.totalMargin), keyInfo: true },
          { label: "Avg Margin", value: pct(s.avgMarginPct), keyInfo: true },
        ],
        columns: [
          { header: "Product", cell: (r) => r.product },
          { header: "Units", cell: (r) => int(r.unitsSold), align: "right" },
          { header: "Cost", cell: (r) => money(r.costPrice), align: "right" },
          { header: "Avg Sell", cell: (r) => money(r.avgSellPrice), keyInfo: true, align: "right" },
          { header: "Margin/Unit", cell: (r) => money(r.grossMargin), keyInfo: true, align: "right" },
          { header: "Margin %", cell: (r) => pct(r.marginPct), keyInfo: true, align: "right" },
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
          { header: "Cost Price GBP", value: (r) => r.costPrice.toFixed(2) },
          { header: "Avg Sell Price GBP", value: (r) => r.avgSellPrice.toFixed(2) },
          { header: "Min Sell Price GBP", value: (r) => r.minSellPrice.toFixed(2) },
          { header: "Max Sell Price GBP", value: (r) => r.maxSellPrice.toFixed(2) },
          { header: "Gross Margin Per Unit GBP", value: (r) => r.grossMargin.toFixed(2) },
          { header: "Margin Pct", value: (r) => r.marginPct.toFixed(1) },
          { header: "Total Margin GBP", value: (r) => r.totalMargin.toFixed(2) },
        ],
      }}
    />
  );
}
