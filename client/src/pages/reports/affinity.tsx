/** ARC-T4-003 Product Affinity & Cross-Sell Report. */
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { int, pct } from "@/lib/reportBrand";

interface Row {
  productA: string;
  productB: string;
  coPurchaseRate: number;
  recommendationScore: number;
}

export default function AffinityReport() {
  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T4-003",
        periodLabel: () => "Products frequently bought together (≥ 15% affinity)",
        tableHeading: "Product Pairs by Co-Purchase Rate",
        emptyText: "Not enough order history to detect product affinities yet.",
        flagLegend: [
          { level: "blue", meaning: "Strong pair (≥ 40%) — bundle candidate" },
          { level: "green", meaning: "Good signal (20–39%)" },
        ],
        rowFlag: (r) => (r.coPurchaseRate >= 40 ? "blue" : r.coPurchaseRate >= 20 ? "green" : undefined),
        kpis: (s) => [
          { label: "Product Pairs", value: int(s.pairs), keyInfo: true },
          { label: "Strong Pairs (≥40%)", value: int(s.strongPairs), flag: s.strongPairs ? "blue" : undefined },
        ],
        columns: [
          { header: "Product A", cell: (r) => r.productA },
          { header: "Product B", cell: (r) => r.productB, keyInfo: true },
          { header: "Co-Purchase Rate", cell: (r) => pct(r.coPurchaseRate), keyInfo: true, align: "right" },
          {
            header: "Signal",
            cell: (r) =>
              r.coPurchaseRate >= 40 ? (
                <FlagBadge level="blue">Bundle</FlagBadge>
              ) : r.coPurchaseRate >= 20 ? (
                <FlagBadge level="green">Cross-sell</FlagBadge>
              ) : (
                "—"
              ),
            align: "center",
          },
        ],
        csvColumns: [
          { header: "Product A", value: (r) => r.productA },
          { header: "Product B", value: (r) => r.productB },
          { header: "Co-Purchase Rate Pct", value: (r) => r.coPurchaseRate.toFixed(1) },
          { header: "Recommendation Score", value: (r) => r.recommendationScore.toFixed(1) },
        ],
      }}
    />
  );
}
