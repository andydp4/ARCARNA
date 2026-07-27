/** ARC-T1-003 Order Status Dashboard. */
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { money, int, orDash } from "@/lib/reportBrand";

interface Row {
  orderId: string;
  customer: string | null;
  tier: string | null;
  orderValue: number;
  status: string;
  queuePosition: number | null;
  etaGiven: string | null;
  timeInQueue: number;
  stalled: boolean;
  channel: string;
}

function statusFlag(status: string, stalled: boolean): "red" | "amber" | "blue" | undefined {
  if (status === "DELAYED") return "red";
  if (status === "READY") return "blue";
  if (stalled) return "amber";
  return undefined;
}

export default function OrderStatusReport() {
  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T1-003",
        periodLabel: () => "Live — orders in flight today",
        tableHeading: "Active Orders (VIP first, then queue order)",
        emptyText: "No active orders right now.",
        flagLegend: [
          { level: "red", meaning: "Delayed" },
          { level: "amber", meaning: "> 45 min in queue" },
          { level: "blue", meaning: "Ready for collection" },
        ],
        rowFlag: (r) => statusFlag(r.status, r.stalled),
        kpis: (s) => [
          { label: "Active Orders", value: int(s.active), keyInfo: true },
          { label: "Delayed", value: int(s.delayed), flag: s.delayed ? "red" : undefined },
          { label: "Stalled (>45m)", value: int(s.stalled), flag: s.stalled ? "amber" : undefined },
        ],
        columns: [
          { header: "Order", cell: (r) => r.orderId },
          { header: "Customer", cell: (r) => orDash(r.customer), keyInfo: true },
          { header: "Tier", cell: (r) => orDash(r.tier) },
          { header: "Value", cell: (r) => money(r.orderValue), keyInfo: true, align: "right" },
          { header: "Queue", cell: (r) => (r.queuePosition == null ? "—" : r.queuePosition), keyInfo: true, align: "center" },
          { header: "In Queue", cell: (r) => `${int(r.timeInQueue)}m`, align: "right" },
          {
            header: "Status",
            cell: (r) => {
              const f = statusFlag(r.status, r.stalled);
              return f ? <FlagBadge level={f}>{r.status}</FlagBadge> : r.status;
            },
            align: "center",
          },
        ],
        csvColumns: [
          { header: "Order ID", value: (r) => r.orderId },
          { header: "Customer Name", value: (r) => r.customer ?? "" },
          { header: "Customer Tier", value: (r) => r.tier ?? "" },
          { header: "Order Value GBP", value: (r) => r.orderValue.toFixed(2) },
          { header: "Order Status", value: (r) => r.status },
          { header: "Queue Position", value: (r) => r.queuePosition ?? "" },
          { header: "Time In Queue Mins", value: (r) => r.timeInQueue },
          { header: "Payment Channel", value: (r) => r.channel },
        ],
      }}
    />
  );
}
