/**
 * My performance (v1.2 Phase 7C, STF-10): every role's own page.
 *
 * Builds on the till's "My shift so far": the person's own figures,
 * commission, override count, speed, fairness rates, KPIs and badges, for any
 * dates. Never anyone else's — the server answers with the caller's own
 * figures only, and adds a team median only when 4 or more people worked.
 * There is no cost or margin on it (cashiers never receive cost). Today's
 * figures are provisional; nothing here is kept on the device (the server
 * sends no-store and the query is dropped as soon as the page closes).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getJson } from "@/lib/queryClient";
import { presetRange, type PerformanceFigures, type PerformancePreset } from "@shared/reports/staffPerformance";
import {
  BadgeList,
  FairnessList,
  KpiList,
  KpisMet,
  SettingsInForceNote,
  SpeedList,
  money,
  num1,
  pct,
  type EarnedBadge,
  type FairnessRates,
  type KpiSummary,
  type SettingsInForce,
  type SpeedFigures,
} from "@/components/performance/PeopleFigures";
import { PRESET_LABEL, todayIso } from "./reports/order-timing";

export type MyPerformance = {
  person: { userId: string; name: string; role: string };
  period: { from: string; to: string };
  includesToday: boolean;
  provisional: boolean;
  provisionalUntil: string;
  figures: PerformanceFigures;
  speed: SpeedFigures;
  fairness: FairnessRates;
  namedCustomerCapturePercent: number | null;
  newCustomers: number;
  kpis: KpiSummary;
  kpisMet: string;
  badges: EarnedBadge[];
  satisfaction: { average: number; count: number } | null;
  commission: number;
  overrideCount: number;
  teamMedian: {
    people: number;
    completed: number | null;
    valueBroughtIn: number | null;
    jobsPerActiveHour: number | null;
    collectionOnTimePercent: number | null;
    namedCustomerCapturePercent: number | null;
  } | null;
  targets: { version: number; setAt: string; amberOnly: boolean } | null;
  settingsInForce: SettingsInForce;
};

type Digest = {
  week: { from: string; to: string };
  own: { completed: number; valueBroughtIn: number; kpisMet: string; badges: string[] } | null;
  commission: number;
  rows: Array<{ userId: string; name: string; role: string; completed: number; valueBroughtIn: number; jobsPerActiveHour: number | null; kpisMet: string; badges: string[] }>;
  teamMedian: MyPerformance["teamMedian"];
};

const MY_PRESETS: PerformancePreset[] = ["today", "yesterday", "this-week", "last-week", "last-4-weeks", "this-month"];

/** Never kept: dropped from memory as soon as nothing is showing it. */
const NO_KEEP = { staleTime: 0, gcTime: 0, refetchOnWindowFocus: true } as const;

function Stat({ label, value, median, testId }: { label: string; value: string; median?: string | null; testId?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums" data-testid={testId}>{value}</p>
      {median != null && <p className="text-xs text-muted-foreground">Team median {median}</p>}
    </div>
  );
}

export function ProvisionalToday() {
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="text-my-performance-today">
      <Badge variant="secondary" className="mr-2">Provisional</Badge>
      Today has not closed yet, so today's figures will still move.
    </p>
  );
}

function DigestCard() {
  const { data, isError } = useQuery<Digest>({
    queryKey: ["/api/my-performance/digest"],
    queryFn: () => getJson("/api/my-performance/digest"),
    ...NO_KEEP,
  });
  if (isError || !data) return null;
  return (
    <Card className="lm-card border-0 shadow-none" data-testid="card-my-digest">
      <CardHeader>
        <CardTitle>Last week's digest</CardTitle>
        <CardDescription>
          {data.week.from} to {data.week.to}. Built for you when you open it; nothing in it is stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {data.own ? (
          <p>
            You completed <b>{data.own.completed}</b> orders and brought in <b>{money(data.own.valueBroughtIn)}</b>. {data.own.kpisMet}.
            {data.own.badges.length > 0 && ` Badges: ${data.own.badges.join(", ")}.`}
          </p>
        ) : (
          <p>No completed orders for you last week.</p>
        )}
        <p>Commission accrued: {money(data.commission)}</p>
        {data.rows.length > 0 && (
          <div className="overflow-x-auto">
            <Table data-testid="table-my-digest">
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Value brought in</TableHead>
                  <TableHead className="text-right">Jobs / hour</TableHead>
                  <TableHead>KPIs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.userId}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right">{r.completed}</TableCell>
                    <TableCell className="text-right">{money(r.valueBroughtIn)}</TableCell>
                    <TableCell className="text-right">{num1(r.jobsPerActiveHour)}</TableCell>
                    <TableCell>{r.kpisMet}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MyPerformancePage() {
  const today = useMemo(todayIso, []);
  const [preset, setPreset] = useState<PerformancePreset>("today");
  const range = presetRange(preset, today);
  const params = new URLSearchParams({ from: range.from, to: range.to }).toString();
  const { data, isLoading, isError } = useQuery<MyPerformance>({
    queryKey: ["/api/my-performance", params],
    queryFn: () => getJson(`/api/my-performance?${params}`),
    ...NO_KEEP,
  });
  const f = data?.figures;
  const m = data?.teamMedian;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <PageHeader
        icon={Gauge}
        title="My performance"
        question="How is my work going?"
        explanation="Your own figures only. Nobody else's are shown here, and there is no ranking. These figures are a guide: no pay decision is made from them alone."
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label>Dates</Label>
          <Select value={preset} onValueChange={(v) => setPreset(v as PerformancePreset)}>
            <SelectTrigger aria-label="Dates" className="min-h-[44px] w-44" data-testid="select-my-performance-preset"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MY_PRESETS.map((p) => <SelectItem key={p} value={p}>{PRESET_LABEL[p]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p className="pb-3 text-sm text-muted-foreground">{range.from === range.to ? range.from : `${range.from} to ${range.to}`}</p>
      </div>

      {isError && <p className="text-sm text-destructive">Could not load your figures. Try again.</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data?.includesToday && <ProvisionalToday />}

      {data && f && (
        <>
          <Card className="lm-card border-0 shadow-none">
            <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
              <Stat label="Completed" value={String(f.completed)} median={m?.completed != null ? String(m.completed) : null} testId="text-my-completed" />
              <Stat label="Value brought in" value={money(f.valueBroughtIn)} median={m?.valueBroughtIn != null ? money(m.valueBroughtIn) : null} />
              <Stat label="Commission" value={money(data.commission)} />
              <Stat label="Price overrides" value={String(data.overrideCount)} />
              <Stat label="Loaded · Prepared · Dispatched" value={`${f.loaded} · ${f.prepared} · ${f.dispatched}`} />
              <Stat label="Jobs per active hour" value={num1(data.fairness.jobsPerActiveHour)} median={m?.jobsPerActiveHour != null ? num1(m.jobsPerActiveHour) : null} />
              <Stat label="Customer named" value={pct(data.namedCustomerCapturePercent)} median={m?.namedCustomerCapturePercent != null ? pct(m.namedCustomerCapturePercent) : null} />
              <Stat label="Collections on time" value={pct(data.speed.collectionOnTimePercent)} median={m?.collectionOnTimePercent != null ? pct(m.collectionOnTimePercent) : null} />
            </CardContent>
          </Card>
          {!m && <p className="text-xs text-muted-foreground" data-testid="text-no-team-median">A team median shows when 4 or more people worked in these dates.</p>}

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="lm-card border-0 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  KPIs <KpisMet kpis={data.kpis} />
                </CardTitle>
                <CardDescription>Against the targets an admin set. Grey means too little data yet.</CardDescription>
              </CardHeader>
              <CardContent><KpiList kpis={data.kpis} /></CardContent>
            </Card>
            <Card className="lm-card border-0 shadow-none">
              <CardHeader>
                <CardTitle>Badges</CardTitle>
                <CardDescription>Earned against fixed bars. Anyone can earn any of them.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <BadgeList badges={data.badges} />
                {data.satisfaction && (
                  <p className="text-sm text-muted-foreground">
                    Customer stars on your completions: {data.satisfaction.average.toFixed(1)} from {data.satisfaction.count} (information only).
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="lm-card border-0 shadow-none">
              <CardHeader><CardTitle>Speed</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <SpeedList speed={data.speed} />
                <SettingsInForceNote settings={data.settingsInForce} />
              </CardContent>
            </Card>
            <Card className="lm-card border-0 shadow-none">
              <CardHeader><CardTitle>Fairness</CardTitle></CardHeader>
              <CardContent><FairnessList rates={data.fairness} /></CardContent>
            </Card>
          </div>
        </>
      )}

      <DigestCard />
    </div>
  );
}
