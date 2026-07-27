/** ARC-T3-002 Customer Lifetime Value (CLV) Report. */
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { money, int, screenDate, orDash } from "@/lib/reportBrand";

interface Row {
  customer: string;
  tier: string;
  lifetimeSpend: number;
  totalOrders: number;
  avgOrderValue: number;
  firstOrderDate: string | null;
  tenureMonths: number;
  monthlySpendRate: number;
  clvRank: number;
  tierChangeFlag: string;
}

export default function ClvReport() {
  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T3-002",
        periodLabel: () => "All customers, ranked by lifetime spend",
        tableHeading: "Customers by Lifetime Value",
        emptyText: "No completed orders yet.",
        flagLegend: [{ level: "green", meaning: "Promote to VIP" }, { level: "blue", meaning: "Top 10 CLV" }],
        rowFlag: (r) => (r.tierChangeFlag ? "green" : undefined),
        kpis: (s) => [
          { label: "Customers", value: int(s.customers), keyInfo: true },
          { label: "Total Lifetime Spend", value: money(s.totalLifetimeSpend), keyInfo: true },
          { label: "Promote Candidates", value: int(s.promoteCandidates), flag: s.promoteCandidates ? "green" : undefined },
        ],
        columns: [
          { header: "Rank", cell: (r) => r.clvRank, keyInfo: true, align: "center" },
          { header: "Customer", cell: (r) => r.customer },
          { header: "Tier", cell: (r) => orDash(r.tier) },
          { header: "Lifetime Spend", cell: (r) => money(r.lifetimeSpend), keyInfo: true, align: "right" },
          { header: "Orders", cell: (r) => int(r.totalOrders), align: "right" },
          { header: "Avg Order", cell: (r) => money(r.avgOrderValue), align: "right" },
          { header: "£/Month", cell: (r) => money(r.monthlySpendRate), keyInfo: true, align: "right" },
          {
            header: "Flag",
            cell: (r) => (r.tierChangeFlag ? <FlagBadge level="green">{r.tierChangeFlag}</FlagBadge> : "—"),
            align: "center",
          },
        ],
        csvColumns: [
          { header: "CLV Rank", value: (r) => r.clvRank },
          { header: "Customer Name", value: (r) => r.customer },
          { header: "Current Tier", value: (r) => r.tier },
          { header: "Total Lifetime Spend GBP", value: (r) => r.lifetimeSpend.toFixed(2) },
          { header: "Total Orders", value: (r) => r.totalOrders },
          { header: "Avg Order Value GBP", value: (r) => r.avgOrderValue.toFixed(2) },
          { header: "First Order Date", value: (r) => (r.firstOrderDate ? screenDate(r.firstOrderDate) : "") },
          { header: "Tenure Months", value: (r) => r.tenureMonths },
          { header: "Monthly Spend Rate GBP", value: (r) => r.monthlySpendRate.toFixed(2) },
          { header: "Tier Change Flag", value: (r) => r.tierChangeFlag },
        ],
      }}
    />
  );
}
