/**
 * Order Timing (ARC-T2-005, v1.2 Phase 7A).
 *
 * The tested timing engine, grouped by fulfilment, assignee, completer,
 * loader, hour, day or channel, with names. The server does all the maths and
 * cuts the person groups to what this viewer may see (Q14); this page lays it
 * out. Person groupings are marked provisional for the first two weeks while
 * the owner checks the team figures.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Clock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getJson } from "@/lib/queryClient";
import { ORDER_TIMING_PAGE_GROUPS, type OrderTimingPageGroup, type OrderTimingSummary } from "@shared/reports/orderTiming";
import { PERFORMANCE_PRESETS, presetRange, type PerformancePreset } from "@shared/reports/staffPerformance";

type Response = {
  period: { from: string; to: string };
  groupBy: OrderTimingPageGroup;
  summary: OrderTimingSummary;
  groups: Array<{ key: string; label: string; role: string | null; summary: OrderTimingSummary }>;
  hiddenGroups: number;
  redFlags: string[];
  provisional: boolean;
  provisionalUntil: string;
  settings: { prepSlaMinutes: number; deliveryLeadMinutes: number; lateGraceMinutes: number; timezone: string };
};

const GROUP_LABEL: Record<OrderTimingPageGroup, string> = {
  fulfilment: "Fulfilment",
  assignee: "Assignee (who claimed it)",
  completer: "Completer",
  loader: "Loader (who keyed it in)",
  hour: "Hour received",
  day: "Day",
  channel: "Channel",
};

export const PRESET_LABEL: Record<PerformancePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
  "last-4-weeks": "Last 4 weeks",
  "this-month": "This month",
  "last-month": "Last month",
};

export function todayIso(): string {
  const d = new Date();
  // Before 06:00 the trading day is still yesterday's (shared/time/tradingDay.ts).
  if (d.getHours() < 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const mins = (v: number | null) => (v == null ? "—" : `${Math.round(v)} min`);

function Tile({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Card className="lm-card border-0 shadow-none">
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold" data-testid={testId}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export default function OrderTimingReport() {
  const today = useMemo(todayIso, []);
  const [preset, setPreset] = useState<PerformancePreset | "custom">("last-week");
  const initial = presetRange("last-week", today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [groupBy, setGroupBy] = useState<OrderTimingPageGroup>("fulfilment");

  const choosePreset = (p: string) => {
    setPreset(p as PerformancePreset | "custom");
    if (p !== "custom") {
      const r = presetRange(p as PerformancePreset, today);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const params = new URLSearchParams({ from, to, groupBy }).toString();
  const { data, isLoading, isError } = useQuery<Response>({
    queryKey: ["/api/evidence/order-timing", params],
    queryFn: () => getJson(`/api/evidence/order-timing?${params}`),
  });
  const s = data?.summary;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> All Evidence
      </Link>
      <PageHeader
        icon={Clock}
        title="Order Timing"
        question="How fast do orders move, and where do they wait?"
        explanation="On time means ready (collection) or handed over (delivery) by the promise plus the grace. Backdated, carried-over and assumed-ready orders are counted but not timed."
      />

      <Card className="lm-card border-0 shadow-none">
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label>Dates</Label>
            <Select value={preset} onValueChange={choosePreset}>
              <SelectTrigger className="min-h-[44px] w-44" data-testid="select-timing-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERFORMANCE_PRESETS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRESET_LABEL[p]}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ot-from">From</Label>
            <Input id="ot-from" type="date" value={from} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} className="min-h-[44px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ot-to">To</Label>
            <Input id="ot-to" type="date" value={to} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} className="min-h-[44px]" />
          </div>
          <div className="space-y-2">
            <Label>Group by</Label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as OrderTimingPageGroup)}>
              <SelectTrigger className="min-h-[44px] w-56" data-testid="select-timing-group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_TIMING_PAGE_GROUPS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {GROUP_LABEL[g]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isError && <p className="text-sm text-destructive">Could not load Order Timing. Try again.</p>}

      {data?.redFlags.map((f) => (
        <p key={f} className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {f}
        </p>
      ))}

      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Orders timed" value={String(s.ordersConsidered)} testId="text-timing-orders" />
          <Tile label="On time" value={pct(s.onTimePercent)} />
          <Tile label="Promise kept" value={pct(s.promiseKeptPercent)} />
          <Tile label="Median received → completed" value={mins(s.medians.receivedToCompletedMinutes)} />
          <Tile label="Collection on time" value={pct(s.collectionOnTimePercent)} />
          <Tile label="Delivery on time" value={pct(s.deliveryOnTimePercent)} />
          <Tile label="Customer waiting" value={String(s.customerWaitingIncidents)} />
          <Tile label="Counted, not timed" value={String(s.ordersExcluded)} />
        </div>
      )}

      <Card className="lm-card border-0 shadow-none">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            By {GROUP_LABEL[groupBy].toLowerCase()}
            {data?.provisional && (
              <Badge variant="secondary" data-testid="badge-timing-provisional">
                Provisional until {new Date(data.provisionalUntil).toLocaleDateString("en-GB")}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {data?.settings &&
              `On-time settings now: collection ${data.settings.prepSlaMinutes} min when no time was promised, delivery ${data.settings.deliveryLeadMinutes} min, ${data.settings.lateGraceMinutes} min grace.`}
            {data && data.hiddenGroups > 0 && ` ${data.hiddenGroups} people above your role are in the totals but not listed.`}
            {" "}Station comparisons start once enough recorded stations exist.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !data || data.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-timing-groups">
                <TableHeader>
                  <TableRow>
                    <TableHead>{GROUP_LABEL[groupBy]}</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">On time</TableHead>
                    <TableHead className="text-right">Promise kept</TableHead>
                    <TableHead className="text-right">Median to claim</TableHead>
                    <TableHead className="text-right">Median to ready</TableHead>
                    <TableHead className="text-right">Median to complete</TableHead>
                    <TableHead className="text-right">Slowest 10%</TableHead>
                    <TableHead className="text-right">Delayed</TableHead>
                    <TableHead className="text-right">Customer waiting</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.groups.map((g) => (
                    <TableRow key={g.key} data-testid={`row-timing-${g.key}`}>
                      <TableCell className="font-medium">{g.label}</TableCell>
                      <TableCell className="text-right">{g.summary.ordersConsidered}</TableCell>
                      <TableCell className="text-right">{pct(g.summary.onTimePercent)}</TableCell>
                      <TableCell className="text-right">{pct(g.summary.promiseKeptPercent)}</TableCell>
                      <TableCell className="text-right">{mins(g.summary.medians.receivedToClaimedMinutes)}</TableCell>
                      <TableCell className="text-right">{mins(g.summary.medians.receivedToReadyMinutes)}</TableCell>
                      <TableCell className="text-right">{mins(g.summary.medians.receivedToCompletedMinutes)}</TableCell>
                      <TableCell className="text-right">{mins(g.summary.p90s.receivedToCompletedMinutes)}</TableCell>
                      <TableCell className="text-right">{g.summary.delayedCount}</TableCell>
                      <TableCell className="text-right">{g.summary.customerWaitingIncidents}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
