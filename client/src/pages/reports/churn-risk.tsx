/** ARC-T4-002 Churn Risk Score. */
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { money, int, orDash } from "@/lib/reportBrand";
import type { FlagLevel } from "@/lib/reportBrand";

interface Row {
  customer: string;
  tier: string;
  churnScore: number;
  daysSinceLastOrder: number;
  revenueAtRisk: number;
  recommendedAction: string;
}

function riskFlag(score: number): FlagLevel {
  if (score >= 80) return "red";
  if (score >= 50) return "amber";
  return "green";
}

export default function ChurnRiskReport() {
  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T4-002",
        periodLabel: () => "Early-warning churn scoring (0–100)",
        tableHeading: "Customers at Churn Risk",
        emptyText: "No customers currently above the risk threshold.",
        flagLegend: [
          { level: "red", meaning: "High risk (80+)" },
          { level: "amber", meaning: "Moderate (50–79)" },
        ],
        rowFlag: (r) => (r.churnScore >= 80 ? "red" : undefined),
        kpis: (s) => [
          { label: "At Risk", value: int(s.atRisk), keyInfo: true },
          { label: "High Risk (80+)", value: int(s.highRisk), flag: s.highRisk ? "red" : undefined },
          { label: "Revenue at Risk / mo", value: money(s.revenueAtRisk), keyInfo: true },
        ],
        columns: [
          { header: "Customer", cell: (r) => r.customer, keyInfo: true },
          { header: "Tier", cell: (r) => orDash(r.tier) },
          {
            header: "Risk",
            cell: (r) => <FlagBadge level={riskFlag(r.churnScore)}>{r.churnScore}</FlagBadge>,
            align: "center",
          },
          { header: "Days Since", cell: (r) => int(r.daysSinceLastOrder), align: "right" },
          { header: "£ at Risk/mo", cell: (r) => money(r.revenueAtRisk), keyInfo: true, align: "right" },
          { header: "Action", cell: (r) => r.recommendedAction, align: "left" },
        ],
        csvColumns: [
          { header: "Customer Name", value: (r) => r.customer },
          { header: "Churn Risk Score", value: (r) => r.churnScore },
          { header: "Days Since Last Order", value: (r) => r.daysSinceLastOrder },
          { header: "Revenue At Risk GBP", value: (r) => r.revenueAtRisk.toFixed(2) },
          { header: "Recommended Action", value: (r) => r.recommendedAction },
        ],
      }}
    />
  );
}
