/** ARC-T4-001 RFM Customer Segmentation (reports view). */
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { int } from "@/lib/reportBrand";
import type { FlagLevel } from "@/lib/reportBrand";

interface Row {
  customer: string;
  recency: number;
  frequency: number;
  monetary: number;
  combined: number;
  segment: string;
  recommendedAction: string;
}

const SEGMENT_FLAG: Record<string, FlagLevel> = {
  Champions: "green",
  Loyal: "green",
  "New Customer": "blue",
  "At Risk": "amber",
  Hibernating: "amber",
  Lost: "red",
};

export default function RfmReport() {
  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T4-001",
        periodLabel: () => "Recency · Frequency · Monetary scoring",
        tableHeading: "Customers by RFM Score",
        emptyText: "RFM not computed yet — needs order history.",
        flagLegend: [
          { level: "green", meaning: "Champions / Loyal" },
          { level: "amber", meaning: "At risk / hibernating" },
          { level: "red", meaning: "Lost" },
        ],
        kpis: (s) => [
          { label: "Customers", value: int(s.customers), keyInfo: true },
          { label: "Champions", value: int(s.champions), flag: "green" },
          { label: "At Risk", value: int(s.atRisk), flag: s.atRisk ? "amber" : undefined },
        ],
        columns: [
          { header: "Customer", cell: (r) => r.customer },
          { header: "R", cell: (r) => r.recency, keyInfo: true, align: "center" },
          { header: "F", cell: (r) => r.frequency, keyInfo: true, align: "center" },
          { header: "M", cell: (r) => r.monetary, keyInfo: true, align: "center" },
          { header: "Score", cell: (r) => r.combined, keyInfo: true, align: "center" },
          {
            header: "Segment",
            cell: (r) => <FlagBadge level={SEGMENT_FLAG[r.segment] ?? "blue"}>{r.segment}</FlagBadge>,
            align: "center",
          },
          { header: "Action", cell: (r) => r.recommendedAction, keyInfo: true, align: "left" },
        ],
        csvColumns: [
          { header: "Customer Name", value: (r) => r.customer },
          { header: "Recency Score", value: (r) => r.recency },
          { header: "Frequency Score", value: (r) => r.frequency },
          { header: "Monetary Score", value: (r) => r.monetary },
          { header: "RFM Combined Score", value: (r) => r.combined },
          { header: "RFM Segment", value: (r) => r.segment },
          { header: "Recommended Action", value: (r) => r.recommendedAction },
        ],
      }}
    />
  );
}
