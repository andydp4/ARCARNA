/** ARC-T3-003 Stock Runway & Demand Forecast. */
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { int, screenDate } from "@/lib/reportBrand";
import type { FlagLevel } from "@/lib/reportBrand";

interface Row {
  product: string;
  currentStock: number;
  avgWeeklySales: number;
  weeksRemaining: number;
  reorderBy: string | null;
  leadTimeDays: number;
  reorderQty: number;
  urgency: "ORDER NOW" | "ORDER THIS WEEK" | "MONITOR" | "STOCK OK";
}

const URGENCY_FLAG: Record<Row["urgency"], FlagLevel | undefined> = {
  "ORDER NOW": "red",
  "ORDER THIS WEEK": "amber",
  MONITOR: "blue",
  "STOCK OK": undefined,
};

const weeks = (n: number) => (n >= 999 ? "—" : `${n.toFixed(1)} wks`);

export default function StockRunwayReport() {
  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T3-003",
        periodLabel: () => "Forecast at current 4-week sales velocity",
        tableHeading: "Reorder Forecast (most urgent first)",
        emptyText: "No products to forecast.",
        flagLegend: [
          { level: "red", meaning: "Order now" },
          { level: "amber", meaning: "Order this week" },
          { level: "blue", meaning: "Monitor" },
        ],
        rowFlag: (r) => (r.urgency === "ORDER NOW" ? "red" : undefined),
        kpis: (s) => [
          { label: "Products", value: int(s.products), keyInfo: true },
          { label: "Order Now", value: int(s.orderNow), flag: s.orderNow ? "red" : undefined },
          { label: "Order This Week", value: int(s.orderThisWeek), flag: s.orderThisWeek ? "amber" : undefined },
        ],
        columns: [
          { header: "Product", cell: (r) => r.product },
          { header: "Stock", cell: (r) => int(r.currentStock), align: "right" },
          { header: "Weekly Sales", cell: (r) => r.avgWeeklySales.toFixed(1), align: "right" },
          { header: "Weeks Left", cell: (r) => weeks(r.weeksRemaining), keyInfo: true, align: "right" },
          { header: "Reorder By", cell: (r) => (r.reorderBy ? screenDate(r.reorderBy) : "—"), keyInfo: true, align: "right" },
          { header: "Reorder Qty", cell: (r) => int(r.reorderQty), align: "right" },
          {
            header: "Urgency",
            cell: (r) =>
              URGENCY_FLAG[r.urgency] ? (
                <FlagBadge level={URGENCY_FLAG[r.urgency]!}>{r.urgency}</FlagBadge>
              ) : (
                r.urgency
              ),
            align: "center",
          },
        ],
        csvColumns: [
          { header: "Product Name", value: (r) => r.product },
          { header: "Current Stock", value: (r) => r.currentStock },
          { header: "Avg Weekly Sales", value: (r) => r.avgWeeklySales.toFixed(2) },
          { header: "Weeks Of Stock Remaining", value: (r) => (r.weeksRemaining >= 999 ? "" : r.weeksRemaining.toFixed(1)) },
          { header: "Reorder Recommended By", value: (r) => (r.reorderBy ? screenDate(r.reorderBy) : "") },
          { header: "Supplier Lead Time Days", value: (r) => r.leadTimeDays },
          { header: "Recommended Reorder Qty", value: (r) => r.reorderQty },
          { header: "Urgency", value: (r) => r.urgency },
        ],
      }}
    />
  );
}
