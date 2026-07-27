/** ARC-T2-002 Staff KPI Performance Report. */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { money, int, pct, screenDate, isoDate } from "@/lib/reportBrand";
import type { FlagLevel } from "@/lib/reportBrand";

interface Row {
  staff: string;
  ordersHandled: number;
  orderAccuracyRate: number | null;
  satisfactionScore: number | null;
  kpisAtTarget: number;
  kpisMeasured: number;
  bonusTier: "PLATINUM" | "GOLD" | "SILVER" | "BELOW STANDARD";
  bonusPayable: number;
}

const TIER_FLAG: Record<Row["bonusTier"], FlagLevel> = {
  PLATINUM: "gold",
  GOLD: "green",
  SILVER: "blue",
  "BELOW STANDARD": "red",
};

function weekBounds(d: Date): { from: string; to: string } {
  const start = new Date(d);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: isoDate(start), to: isoDate(end) };
}

export default function StaffKpiReport() {
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const bounds = weekBounds(new Date(anchor));

  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T2-002",
        params: bounds,
        periodLabel: () => `Week ${screenDate(bounds.from)} – ${screenDate(bounds.to)}`,
        tableHeading: "Staff Performance",
        emptyText: "No active staff / no activity this week.",
        flagLegend: [
          { level: "gold", meaning: "Platinum bonus" },
          { level: "red", meaning: "Below standard — review" },
        ],
        rowFlag: (r) => (r.bonusTier === "BELOW STANDARD" ? "red" : undefined),
        controls: (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Week of</label>
            <Input type="date" value={anchor} max={isoDate(new Date())} onChange={(e) => setAnchor(e.target.value)} className="h-9 w-[160px]" />
          </div>
        ),
        kpis: (s) => [
          { label: "Staff", value: int(s.staff), keyInfo: true },
          { label: "Platinum", value: int(s.platinum), flag: s.platinum ? "green" : undefined },
          { label: "Below Standard", value: int(s.belowStandard), flag: s.belowStandard ? "red" : undefined },
          { label: "Total Bonus", value: money(s.totalBonus), keyInfo: true },
        ],
        columns: [
          { header: "Staff", cell: (r) => r.staff, keyInfo: true },
          { header: "Orders", cell: (r) => int(r.ordersHandled), align: "right" },
          { header: "Accuracy", cell: (r) => (r.orderAccuracyRate == null ? "—" : pct(r.orderAccuracyRate)), keyInfo: true, align: "right" },
          { header: "Satisfaction", cell: (r) => (r.satisfactionScore == null ? "—" : r.satisfactionScore.toFixed(2)), keyInfo: true, align: "right" },
          { header: "KPIs Hit", cell: (r) => `${r.kpisAtTarget}/${r.kpisMeasured}`, align: "center" },
          {
            header: "Bonus Tier",
            cell: (r) => <FlagBadge level={TIER_FLAG[r.bonusTier]}>{r.bonusTier}</FlagBadge>,
            align: "center",
          },
          { header: "Bonus", cell: (r) => money(r.bonusPayable), keyInfo: true, align: "right" },
        ],
        csvColumns: [
          { header: "Staff Member", value: (r) => r.staff },
          { header: "Orders Handled", value: (r) => r.ordersHandled },
          { header: "Order Accuracy Rate Pct", value: (r) => (r.orderAccuracyRate == null ? "" : r.orderAccuracyRate.toFixed(1)) },
          { header: "Satisfaction Score Avg", value: (r) => (r.satisfactionScore == null ? "" : r.satisfactionScore.toFixed(2)) },
          { header: "KPIs At Target", value: (r) => r.kpisAtTarget },
          { header: "KPIs Measured", value: (r) => r.kpisMeasured },
          { header: "Bonus Tier", value: (r) => r.bonusTier },
          { header: "Bonus Payable GBP", value: (r) => r.bonusPayable.toFixed(2) },
        ],
      }}
    />
  );
}
