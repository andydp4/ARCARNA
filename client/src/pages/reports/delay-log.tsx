/** ARC-T1-005 Delay Log. */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ReportView } from "@/components/reports/ReportView";
import { FlagBadge } from "@/components/reports/ReportPrimitives";
import { int, screenDate, isoDate, orDash } from "@/lib/reportBrand";

interface Row {
  orderId: string;
  customer: string | null;
  tier: string | null;
  originalEta: string | null;
  revisedEta: string | null;
  delayDuration: number;
  delayCause: string | null;
  proactiveComms: boolean;
  resolution: string | null;
}

function timeOf(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function DelayLogReport() {
  const [day, setDay] = useState(() => isoDate(new Date()));

  return (
    <ReportView<Row>
      config={{
        reportRef: "ARC-T1-005",
        params: { from: day, to: day },
        periodLabel: () => `Delays on ${screenDate(day)}`,
        tableHeading: "Delays Today",
        emptyText: "No delays logged for this day.",
        flagLegend: [
          { level: "red", meaning: "No proactive comms / > 60 min" },
          { level: "amber", meaning: "VIP affected" },
        ],
        rowFlag: (r) => (!r.proactiveComms || r.delayDuration > 60 ? "red" : undefined),
        controls: (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Day</label>
            <Input type="date" value={day} max={isoDate(new Date())} onChange={(e) => setDay(e.target.value)} className="h-9 w-[160px]" />
          </div>
        ),
        kpis: (s) => [
          { label: "Delays", value: int(s.delays), keyInfo: true },
          { label: "No Proactive Comms", value: int(s.noProactiveComms), flag: s.noProactiveComms ? "red" : undefined },
          { label: "Over 60 min", value: int(s.over60min), flag: s.over60min ? "red" : undefined },
        ],
        columns: [
          { header: "Order", cell: (r) => r.orderId },
          { header: "Customer", cell: (r) => orDash(r.customer), keyInfo: true },
          { header: "Tier", cell: (r) => orDash(r.tier) },
          { header: "Original ETA", cell: (r) => timeOf(r.originalEta), align: "right" },
          { header: "Revised ETA", cell: (r) => timeOf(r.revisedEta), align: "right" },
          { header: "Delay", cell: (r) => `${int(r.delayDuration)}m`, keyInfo: true, align: "right" },
          { header: "Cause", cell: (r) => orDash(r.delayCause) },
          {
            header: "Comms",
            cell: (r) =>
              r.proactiveComms ? <FlagBadge level="green">Proactive</FlagBadge> : <FlagBadge level="red">Missed</FlagBadge>,
            align: "center",
          },
        ],
        csvColumns: [
          { header: "Order ID", value: (r) => r.orderId },
          { header: "Customer Name", value: (r) => r.customer ?? "" },
          { header: "Customer Tier", value: (r) => r.tier ?? "" },
          { header: "Original ETA", value: (r) => r.originalEta ?? "" },
          { header: "Revised ETA", value: (r) => r.revisedEta ?? "" },
          { header: "Delay Duration Mins", value: (r) => r.delayDuration },
          { header: "Delay Cause", value: (r) => r.delayCause ?? "" },
          { header: "Proactive Comms Sent", value: (r) => (r.proactiveComms ? "Yes" : "No") },
          { header: "Resolution", value: (r) => r.resolution ?? "" },
        ],
      }}
    />
  );
}
