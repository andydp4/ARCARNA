/** ARC-T2-003 Customer Satisfaction Report. */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { REPORT_COLORS } from "@/lib/reportBrand";
import { int, pct, screenDate, isoDate, orDash } from "@/lib/reportBrand";
import { mondayWeekBounds } from "@/lib/weekBounds";

interface Row {
  customer: string | null;
  orderId: string | null;
  score: number;
  scoreDate: string | null;
}

/**
 * ARC-045: the 1-5 score histogram was computed server-side
 * (reportsEngine.ts's `dist`) but never actually rendered anywhere on the
 * client — only squashed into a one-line "Distribution 1:0 2:1 …" string
 * under the Average Score tile. Real bars, brand colours, no charting
 * library needed for five bars.
 */
function SatisfactionHistogram({ summary }: { summary: Record<string, any> }) {
  const counts = [1, 2, 3, 4, 5].map((n) => Number(summary[`dist${n}`]) || 0);
  const max = Math.max(1, ...counts);
  const barColor = (score: number) => (score <= 2 ? REPORT_COLORS.red : score === 3 ? REPORT_COLORS.amber : REPORT_COLORS.green);
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-sm font-semibold" style={{ color: REPORT_COLORS.truthBlueDark }}>
        Score Distribution
      </h3>
      <div className="flex items-end gap-3 rounded-lg border p-4" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
        {counts.map((count, i) => {
          const score = i + 1;
          const heightPct = (count / max) * 100;
          return (
            <div key={score} className="flex flex-1 flex-col items-center gap-1">
              <div className="text-xs font-medium" style={{ color: REPORT_COLORS.steelGrey }}>
                {count}
              </div>
              <div className="flex h-24 w-full items-end">
                <div
                  className="w-full rounded-t"
                  style={{ height: `${Math.max(heightPct, count > 0 ? 4 : 0)}%`, backgroundColor: barColor(score) }}
                />
              </div>
              <div className="text-[11px]" style={{ color: REPORT_COLORS.smoke }}>
                {score}★
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SatisfactionReport() {
  const [anchor, setAnchor] = useState(() => isoDate(new Date()));
  const bounds = mondayWeekBounds(new Date(anchor));

  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T2-003",
        params: bounds,
        showRevenueDefinitionNote: true,
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
            <Input aria-label="Week of" type="date" value={anchor} max={isoDate(new Date())} onChange={(e) => setAnchor(e.target.value)} className="h-9 w-[160px]" />
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
        belowKpis: (s) => <SatisfactionHistogram summary={s} />,
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
