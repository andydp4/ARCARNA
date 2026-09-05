import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ZReportView } from "@/components/ZReport";
import type { ZReportData } from "@shared/reports/zReport";
import { cn } from "@/lib/utils";
import { UserRound } from "lucide-react";

interface ShiftRow {
  id: string;
  userId: string;
  /** Resolved server-side: full name, else email, else the id. */
  userName: string;
  locationId: string;
  locationName: string | null;
  status: string;
  openingFloat: string;
  closingCount: string | null;
  expectedCash: string | null;
  variance: string | null;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
}

/**
 * How far back the list looks. 48 hours is the default because the question
 * this page answers — who was on — is usually asked about last night, and a
 * "today" window answers it with an empty table any time after midnight.
 */
const WINDOWS = [
  { value: "24", label: "Last 24 hours" },
  { value: "48", label: "Last 48 hours" },
  { value: "168", label: "Last 7 days" },
] as const;

const DEFAULT_WINDOW = "48";

function money(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = parseFloat(value);
  return Number.isFinite(n) ? `£${n.toFixed(2)}` : "—";
}

/** "4h 20m" — long enough to be read at a glance, short enough for a cell. */
function duration(fromIso: string, toIso: string | null): string {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "—";
  const minutes = Math.floor((to - from) / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

/**
 * A variance is a number an owner acts on, so it carries a sign and a word.
 * Colour repeats that; it never has to carry it alone.
 */
function VarianceCell({ value }: { value: string | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return <span className="text-muted-foreground">—</span>;
  if (Math.abs(n) < 0.005) return <span className="tabular-nums">Balanced</span>;
  return (
    <span className={cn("tabular-nums", n < 0 ? "text-red-400" : "text-amber-400")}>
      {n < 0 ? `£${Math.abs(n).toFixed(2)} short` : `£${n.toFixed(2)} over`}
    </span>
  );
}

export default function ShiftsPage() {
  const [reportShiftId, setReportShiftId] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState<string>(DEFAULT_WINDOW);

  const { data: shifts = [], isLoading } = useQuery<ShiftRow[]>({
    queryKey: ["/api/shifts", { hours: windowHours }],
    queryFn: async () => {
      const res = await apiFetch(`/api/shifts?hours=${windowHours}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load shifts");
      return res.json();
    },
    // Someone is on the till right now; a stale "on now" panel is worse than none.
    refetchInterval: 60_000,
  });

  const openShifts = useMemo(
    () => shifts.filter((shift) => shift.status === "open"),
    [shifts],
  );

  const { data: reportData } = useQuery<{ report: ZReportData }>({
    queryKey: ["/api/shifts", reportShiftId, "report"],
    queryFn: async () => {
      const res = await apiFetch(`/api/shifts/${reportShiftId}/report`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
    enabled: !!reportShiftId,
  });

  const windowLabel =
    WINDOWS.find((w) => w.value === windowHours)?.label.toLowerCase() ?? "window";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shifts"
        question="Who was on, and did the till balance?"
        explanation="Who is on now, who was on recently, and how each till counted."
        action={
          <Select value={windowHours} onValueChange={setWindowHours}>
            <SelectTrigger
              className="min-h-[44px] w-full sm:w-[12rem]"
              aria-label="How far back to show shifts"
              data-testid="select-shift-window"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  data-testid={`shift-window-${option.value}`}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* On now is the first thing asked and was the one thing the page never
          said. Open shifts are listed here whatever the window, because someone
          who started before it began is still on. */}
      <Card data-testid="card-on-now">
        <CardHeader>
          <CardTitle className="text-base">On now</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : openShifts.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-nobody-on">
              Nobody is on. No till is open.
            </p>
          ) : (
            <ul className="space-y-2">
              {openShifts.map((shift) => (
                <li
                  key={shift.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                  data-testid={`on-now-${shift.id}`}
                >
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{shift.userName}</span>
                  {shift.locationName && (
                    <span className="text-muted-foreground">{shift.locationName}</span>
                  )}
                  <span className="text-muted-foreground">
                    on since {when(shift.openedAt)} · {duration(shift.openedAt, null)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {WINDOWS.find((w) => w.value === windowHours)?.label ?? "Recent shifts"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : shifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shifts in the {windowLabel}. Try a longer window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Who</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>On for</TableHead>
                  <TableHead className="text-right">Float</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((shift) => (
                  <TableRow key={shift.id} data-testid={`shift-row-${shift.id}`}>
                    <TableCell className="font-medium">{shift.userName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {shift.locationName ?? "—"}
                    </TableCell>
                    <TableCell>{when(shift.openedAt)}</TableCell>
                    <TableCell>{when(shift.closedAt)}</TableCell>
                    <TableCell className="tabular-nums">
                      {duration(shift.openedAt, shift.closedAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(shift.openingFloat)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(shift.closingCount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <VarianceCell value={shift.variance} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={shift.status === "open" ? "default" : "secondary"}>
                        {shift.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-[44px]"
                        onClick={() => setReportShiftId(shift.id)}
                        aria-label={`Z-report for ${shift.userName}'s shift opened ${when(shift.openedAt)}`}
                      >
                        Z-report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reportShiftId} onOpenChange={(v) => !v && setReportShiftId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Z-Report</DialogTitle>
          </DialogHeader>
          {reportData?.report ? (
            <ZReportView report={reportData.report} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading report…</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
