/** ARC-T2-003 Customer Satisfaction Report. */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { int, pct, screenDate, isoDate, orDash } from "@/lib/reportBrand";

interface Row {
  customer: string | null;
  orderId: string | null;
  score: number;
  scoreDate: string | null;
}

function weekBounds(d: Date): { from: string; to: string } {
  const start = new Date(d);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: isoDate(start), to: isoDate(end) };
}

export default function SatisfactionReport() {
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const bounds = weekBounds(new Date(anchor));

  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T2-003",
        params: bounds,
        periodLabel: () => `Week ${screenDate(bounds.from)} – ${screenDate(bounds.to)}`,
        tableHeading: "Low Scores (3 or below) — follow up",
        emptyText: "No low scores this week. 👍",
        flagLegend: [
          { level: "red", meaning: "Score 1–2 — same-day follow-up" },
          { level: "amber", meaning: "Score 3 — follow up in 24h" },
        ],
        rowFlag: (r) => (r.score <= 2 ? "red" : "amber"),
        controls: (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Week of</label>
            <Input type="date" value={anchor} max={isoDate(new Date())} onChange={(e) => setAnchor(e.target.value)} className="h-9 w-[160px]" />
          </div>
        ),
        kpis: (s) => [
          { label: "Scores Collected", value: int(s.scoresCollected), keyInfo: true },
          { label: "Response Rate", value: pct(s.responseRate), keyInfo: true },
          {
            label: "Average Score",
            value: Number(s.averageScore || 0).toFixed(2),
            keyInfo: true,
            flag: Number(s.averageScore) && Number(s.averageScore) < 4.5 ? "red" : undefined,
            sub: `Distribution ${orDash(s.distribution)}`,
          },
          { label: "Scores ≤ 3", value: int(s.scoresOf3OrBelow), flag: Number(s.scoresOf3OrBelow) ? "amber" : undefined },
        ],
        columns: [
          { header: "Customer", cell: (r) => orDash(r.customer), keyInfo: true },
          { header: "Order", cell: (r) => orDash(r.orderId) },
          {
            header: "Score",
            cell: (r) => <FlagBadge level={r.score <= 2 ? "red" : "amber"}>{r.score}/5</FlagBadge>,
            align: "center",
          },
          { header: "Date", cell: (r) => (r.scoreDate ? screenDate(r.scoreDate) : "—"), align: "right" },
        ],
        csvColumns: [
          { header: "Customer Name", value: (r) => r.customer ?? "" },
          { header: "Order ID", value: (r) => r.orderId ?? "" },
          { header: "Score", value: (r) => r.score },
          { header: "Score Date", value: (r) => (r.scoreDate ? screenDate(r.scoreDate) : "") },
        ],
      }}
    />
  );
}
