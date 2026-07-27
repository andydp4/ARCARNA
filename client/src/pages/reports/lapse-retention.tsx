/** ARC-T3-001 Customer Lapse & Retention Report. */
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { money, int, screenDate, orDash } from "@/lib/reportBrand";
import type { FlagLevel } from "@/lib/reportBrand";

interface Row {
  customer: string;
  tier: string;
  lastOrderDate: string | null;
  daysSinceLastOrder: number;
  lapseStatus: "AT RISK" | "LAPSED" | "LOST";
  lifetimeOrders: number;
  lifetimeValue: number;
}

const STATUS_FLAG: Record<Row["lapseStatus"], FlagLevel> = {
  "AT RISK": "amber",
  LAPSED: "amber",
  LOST: "red",
};
const STATUS_ACTION: Record<Row["lapseStatus"], string> = {
  "AT RISK": "Monitor",
  LAPSED: "Reactivate",
  LOST: "Win-Back",
};

export default function LapseRetentionReport() {
  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T3-001",
        periodLabel: () => "Customers not active in the last 14+ days",
        tableHeading: "Lapsing Customers (by lifetime value)",
        emptyText: "No lapsing customers — everyone's active.",
        flagLegend: [
          { level: "amber", meaning: "At risk / lapsed" },
          { level: "red", meaning: "Lost (60+ days) or VIP lapsing" },
        ],
        rowFlag: (r) => STATUS_FLAG[r.lapseStatus],
        kpis: (s) => [
          { label: "At Risk", value: int(s.atRisk), flag: s.atRisk ? "amber" : undefined },
          { label: "Lapsed", value: int(s.lapsed), flag: s.lapsed ? "amber" : undefined },
          { label: "Lost", value: int(s.lost), flag: s.lost ? "red" : undefined },
          { label: "Value at Risk", value: money(s.valueAtRisk), keyInfo: true },
        ],
        columns: [
          { header: "Customer", cell: (r) => r.customer, keyInfo: true },
          { header: "Tier", cell: (r) => orDash(r.tier) },
          { header: "Last Order", cell: (r) => (r.lastOrderDate ? screenDate(r.lastOrderDate) : "—") },
          { header: "Days Since", cell: (r) => int(r.daysSinceLastOrder), keyInfo: true, align: "right" },
          { header: "Orders", cell: (r) => int(r.lifetimeOrders), align: "right" },
          { header: "Lifetime £", cell: (r) => money(r.lifetimeValue), keyInfo: true, align: "right" },
          {
            header: "Action",
            cell: (r) => <FlagBadge level={STATUS_FLAG[r.lapseStatus]}>{STATUS_ACTION[r.lapseStatus]}</FlagBadge>,
            align: "center",
          },
        ],
        csvColumns: [
          { header: "Customer Name", value: (r) => r.customer },
          { header: "Customer Tier", value: (r) => r.tier },
          { header: "Last Order Date", value: (r) => (r.lastOrderDate ? screenDate(r.lastOrderDate) : "") },
          { header: "Days Since Last Order", value: (r) => r.daysSinceLastOrder },
          { header: "Lapse Status", value: (r) => r.lapseStatus },
          { header: "Total Lifetime Orders", value: (r) => r.lifetimeOrders },
          { header: "Lifetime Value GBP", value: (r) => r.lifetimeValue.toFixed(2) },
        ],
      }}
    />
  );
}
