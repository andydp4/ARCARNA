/**
 * Staff Performance (ARC-T2-002, v1.2 Phase 7B) — replaces Staff KPI.
 *
 * One row per login for any dates, with the change against the period before.
 * What counts is completed orders settled in the range, less personal use —
 * the same orders as sales Evidence — so Total = the people's rows + Admin
 * cover + Unattributed = gross settled sales. The server does the maths and
 * cuts the rows (Q14: a manager sees cashiers and themselves); this page only
 * lays them out: a table on a desktop, cards with tabs on a phone. There is no
 * bonus and no pay figure anywhere (Q16).
 *
 * 7C adds Benefit (£, headline Net benefit — never "profit"), Speed and
 * Fairness tabs. Only rates carry a colour, from the admin-set targets; KPIs
 * met is greens over targets with enough data. There is no ranking column.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { getJson } from "@/lib/queryClient";
import { PERFORMANCE_PRESETS, presetRange, type PerformanceFigures, type PerformancePreset } from "@shared/reports/staffPerformance";
import { PRESET_LABEL, todayIso } from "./order-timing";
import {
  KpiChip,
  KpisMet,
  SettingsInForceNote,
  mins,
  pct,
  type BenefitFigures,
  type EarnedBadge,
  type FairnessRates,
  type KpiSummary,
  type SettingsInForce,
  type SpeedFigures,
} from "@/components/performance/PeopleFigures";
import type { KpiColour, TargetMetric } from "@shared/reports/staffTargets";

type Headline = { completed: number; salesCompleted: number; valueBroughtIn: number; loaded: number; prepared: number };
type Change = Record<keyof Headline, number | null>;
type People = {
  benefit: BenefitFigures;
  speed: SpeedFigures;
  fairness: FairnessRates;
  kpis: KpiSummary;
  badges: EarnedBadge[];
  satisfaction: { average: number; count: number } | null;
};
type Row = PerformanceFigures & People & { userId: string; name: string; role: string; previous: Headline; change: Change };

export type StaffPerformanceResponse = {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  provisional: boolean;
  provisionalUntil: string;
  rows: Row[];
  hiddenPeople: number;
  team: {
    total: PerformanceFigures & { previous: Headline; change: Change };
    adminCover: PerformanceFigures | null;
    unattributed: PerformanceFigures;
    benefit: BenefitFigures;
    speed: SpeedFigures;
  };
  grossSettledSales: number;
  channels: string[];
  targets: { version: number; setAt: string; amberOnly: boolean } | null;
  settingsInForce: SettingsInForce;
};

type LocationOption = { id: string; name: string };
type Section = "volume" | "value" | "quality" | "benefit" | "speed" | "fairness";
type FigureSection = "volume" | "value" | "quality";
type PeopleSection = "benefit" | "speed" | "fairness";
const PEOPLE_SECTIONS: readonly Section[] = ["benefit", "speed", "fairness"];

export function money(n: number | null | undefined): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n ?? 0);
}
const num1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));

function ChangeBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-xs text-muted-foreground">new</span>;
  const rounded = Math.round(value);
  if (rounded === 0) return <span className="text-xs text-muted-foreground">±0%</span>;
  // Change is information, not a verdict: neutral colour, arrow for direction.
  return <span className="text-xs text-muted-foreground">{rounded > 0 ? `▲ ${rounded}%` : `▼ ${Math.abs(rounded)}%`}</span>;
}

type Column = { key: string; label: string; render: (f: PerformanceFigures, change?: Change) => ReactNode };

const COLUMNS: Record<FigureSection, Column[]> = {
  volume: [
    { key: "loaded", label: "Loaded", render: (f, c) => <>{f.loaded} {c && <ChangeBadge value={c.loaded} />}</> },
    { key: "prepared", label: "Prepared", render: (f, c) => <>{f.prepared} {c && <ChangeBadge value={c.prepared} />}</> },
    { key: "completed", label: "Completed", render: (f, c) => <>{f.completed} {c && <ChangeBadge value={c.completed} />}</> },
    { key: "collected", label: "Collected", render: (f) => f.collected },
    { key: "delivered", label: "Delivered", render: (f) => f.delivered },
    { key: "dispatched", label: "Dispatched", render: (f) => f.dispatched },
    { key: "solo", label: "Solo", render: (f) => f.solo },
    { key: "stillOpen", label: "Still open", render: (f) => f.stillOpen },
  ],
  value: [
    { key: "salesCompleted", label: "Sales completed", render: (f, c) => <>{money(f.salesCompleted)} {c && <ChangeBadge value={c.salesCompleted} />}</> },
    { key: "valueBroughtIn", label: "Value brought in", render: (f, c) => <>{money(f.valueBroughtIn)} {c && <ChangeBadge value={c.valueBroughtIn} />}</> },
    { key: "aov", label: "Average order", render: (f) => (f.averageOrderValue == null ? "—" : money(f.averageOrderValue)) },
    { key: "items", label: "Items / order", render: (f) => num1(f.itemsPerOrder) },
    { key: "lines", label: "Lines / order", render: (f) => num1(f.linesPerOrder) },
  ],
  quality: [
    { key: "wrong", label: "Wrong item", render: (f) => `${pct(f.wrongItemRatePercent)} (${f.wrongItemOrders})` },
    { key: "reopens", label: "Reopens", render: (f) => f.reopens },
    { key: "unready", label: "Unready taps", render: (f) => f.unreadyTaps },
    { key: "refunds", label: "Refunds processed", render: (f) => `${f.refundsProcessed} · ${money(f.refundsValue)}` },
    { key: "deletes", label: "Deletes", render: (f) => f.deletes },
    { key: "others", label: "Completed others'", render: (f) => f.completedOthers },
  ],
};

/** A rate, coloured by its target when one is set; plain otherwise. Totals are never coloured. */
function Rated({ row, metric, children }: { row: Row; metric: TargetMetric; children: ReactNode }) {
  const colour: KpiColour | undefined = row.kpis.results.find((r) => r.metric === metric)?.colour;
  if (!colour) return <>{children}</>;
  return <KpiChip colour={colour}>{children}</KpiChip>;
}

type PeopleColumn = { key: string; label: string; render: (r: Row) => ReactNode; total?: (d: StaffPerformanceResponse) => ReactNode };

const PEOPLE_COLUMNS: Record<PeopleSection, PeopleColumn[]> = {
  benefit: [
    { key: "net", label: "Net benefit", render: (r) => <span className="font-semibold">{money(r.benefit.netBenefit)}</span>, total: (d) => money(d.team.benefit.netBenefit) },
    { key: "margin", label: "Margin", render: (r) => money(r.benefit.marginContributed), total: (d) => money(d.team.benefit.marginContributed) },
    { key: "discount", label: "Discount", render: (r) => money(r.benefit.discountGiven), total: (d) => money(d.team.benefit.discountGiven) },
    { key: "exceptions", label: "Exception cost", render: (r) => money(r.benefit.priceExceptionCost), total: (d) => money(d.team.benefit.priceExceptionCost) },
    { key: "personal", label: "Personal use", render: (r) => money(r.benefit.personalUseCost), total: (d) => money(d.team.benefit.personalUseCost) },
    { key: "named", label: "Customer named", render: (r) => <Rated row={r} metric="namedCustomerCapturePercent">{pct(r.benefit.namedCustomerCapturePercent)}</Rated>, total: (d) => pct(d.team.benefit.namedCustomerCapturePercent) },
    { key: "newCustomers", label: "New customers", render: (r) => r.benefit.newCustomers, total: (d) => d.team.benefit.newCustomers },
    { key: "recovered", label: "Credit recovered", render: (r) => money(r.benefit.creditRecovered), total: (d) => money(d.team.benefit.creditRecovered) },
    { key: "badDebt", label: "Bad debt", render: (r) => money(r.benefit.badDebtOriginated), total: (d) => money(d.team.benefit.badDebtOriginated) },
    { key: "refundCost", label: "Refund cost", render: (r) => money(r.benefit.refundCost), total: (d) => money(d.team.benefit.refundCost) },
  ],
  speed: [
    { key: "collection", label: "Collection on time", render: (r) => <Rated row={r} metric="collectionOnTimePercent">{pct(r.speed.collectionOnTimePercent)}</Rated>, total: (d) => pct(d.team.speed.collectionOnTimePercent) },
    { key: "delivery", label: "Delivery on time", render: (r) => <Rated row={r} metric="deliveryOnTimePercent">{pct(r.speed.deliveryOnTimePercent)}</Rated>, total: (d) => pct(d.team.speed.deliveryOnTimePercent) },
    { key: "firstPromise", label: "First promise kept", render: (r) => <Rated row={r} metric="firstPromiseKeptPercent">{pct(r.speed.firstPromiseKeptPercent)}</Rated>, total: (d) => pct(d.team.speed.firstPromiseKeptPercent) },
    { key: "toReady", label: "Received → ready", render: (r) => <Rated row={r} metric="receivedToReadyMedianMinutes">{`${mins(r.speed.receivedToReady.medianMinutes)} / ${mins(r.speed.receivedToReady.slowest10Minutes)}`}</Rated>, total: (d) => `${mins(d.team.speed.receivedToReady.medianMinutes)} / ${mins(d.team.speed.receivedToReady.slowest10Minutes)}` },
    { key: "handover", label: "Ready → handed over", render: (r) => `${mins(r.speed.readyToHandover.medianMinutes)} / ${mins(r.speed.readyToHandover.slowest10Minutes)}`, total: (d) => `${mins(d.team.speed.readyToHandover.medianMinutes)} / ${mins(d.team.speed.readyToHandover.slowest10Minutes)}` },
    { key: "waiting", label: "Customer waiting", render: (r) => r.speed.customerWaitingIncidents, total: (d) => d.team.speed.customerWaitingIncidents },
    { key: "promise", label: "Promise within target", render: (r) => pct(r.speed.promiseWithinTargetPercent), total: (d) => pct(d.team.speed.promiseWithinTargetPercent) },
    { key: "told", label: "Delays told early", render: (r) => `${r.speed.delaysToldInAdvance}/${r.speed.delaysDeclared}`, total: (d) => `${d.team.speed.delaysToldInAdvance}/${d.team.speed.delaysDeclared}` },
    { key: "ack", label: "Alert → ack", render: (r) => <Rated row={r} metric="alertToAckMedianMinutes">{mins(r.speed.alertToAckMedianMinutes)}</Rated>, total: (d) => mins(d.team.speed.alertToAckMedianMinutes) },
    { key: "instant", label: "Counter sales", render: (r) => r.speed.instantCounterSales, total: (d) => d.team.speed.instantCounterSales },
  ],
  fairness: [
    { key: "hours", label: "Active hours", render: (r) => num1(r.fairness.activeHours) },
    { key: "days", label: "Days", render: (r) => r.fairness.daysWorked },
    { key: "jobsHour", label: "Jobs / hour", render: (r) => <Rated row={r} metric="jobsPerActiveHour">{num1(r.fairness.jobsPerActiveHour)}</Rated> },
    { key: "valueHour", label: "Value / hour", render: (r) => <Rated row={r} metric="valuePerActiveHour">{r.fairness.valuePerActiveHour == null ? "—" : money(r.fairness.valuePerActiveHour)}</Rated> },
    { key: "valueDay", label: "Value / day", render: (r) => (r.fairness.valuePerDay == null ? "—" : money(r.fairness.valuePerDay)) },
    { key: "refunds10", label: "Refunds / 10 orders", render: (r) => <Rated row={r} metric="refundsPer10Orders">{num1(r.fairness.refundsPer10Orders)}</Rated> },
    { key: "wrong10", label: "Wrong items / 10", render: (r) => <Rated row={r} metric="wrongItemRatePercent">{num1(r.fairness.wrongItemsPer10Orders)}</Rated> },
    { key: "kpis", label: "KPIs met", render: (r) => <KpisMet kpis={r.kpis} /> },
    { key: "badges", label: "Badges", render: (r) => (r.badges.length ? r.badges.map((b) => b.label).join(", ") : "—") },
  ],
};

function PeopleTable({ data, section, onOpen }: { data: StaffPerformanceResponse; section: PeopleSection; onOpen: (id: string) => void }) {
  const cols = PEOPLE_COLUMNS[section];
  return (
    <div className="overflow-x-auto">
      <Table data-testid={`table-performance-${section}`}>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            {cols.map((c) => <TableHead key={c.key} className="text-right">{c.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.userId} className="cursor-pointer" onClick={() => onOpen(r.userId)} data-testid={`row-${section}-${r.userId}`}>
              <TableCell>
                <span className="font-medium underline-offset-2 hover:underline">{r.name}</span>
                <span className="block text-xs text-muted-foreground">{r.role === "MANAGER" ? "Manager" : "Cashier"}</span>
              </TableCell>
              {cols.map((c) => <TableCell key={c.key} className="text-right whitespace-nowrap">{c.render(r)}</TableCell>)}
            </TableRow>
          ))}
          {cols.some((c) => c.total) && (
            <TableRow className="font-semibold" data-testid={`row-${section}-total`}>
              <TableCell><TeamLabel name="Total" note="Everyone, including admin cover and unattributed." /></TableCell>
              {cols.map((c) => <TableCell key={c.key} className="text-right whitespace-nowrap">{c.total ? c.total(data) : ""}</TableCell>)}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function PeopleCards({ data, section, onOpen }: { data: StaffPerformanceResponse; section: PeopleSection; onOpen: (id: string) => void }) {
  const cols = PEOPLE_COLUMNS[section];
  return (
    <div className="space-y-3">
      {data.rows.map((r) => (
        <Card key={r.userId} className="lm-card border-0 shadow-none cursor-pointer" onClick={() => onOpen(r.userId)} data-testid={`card-${section}-${r.userId}`}>
          <CardContent className="pt-4">
            <div className="mb-2 font-medium">{r.name}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {cols.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-muted-foreground">{c.label}</dt>
                  <dd className="text-right">{c.render(r)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const SECTION_HELP: Record<Section, string> = {
  volume:
    "Each job is counted on its own: loading, preparing, completing and dispatching. Taking over a card at handover adds one Completed and nothing else. Solo is an order the same person loaded and completed. Still open is what they loaded in these dates that is not completed yet.",
  value:
    "Sales completed is the value of the orders they completed. Value brought in is split like commission: all of it when solo, otherwise 90% to whoever completed it and 10% to whoever loaded it.",
  quality:
    "Wrong item is wrong-item refunds against orders they picked. Reopens are their completions someone reopened. Refunds processed, deletes and unready taps are things they did. Completed others' is completing an order claimed by someone else.",
  benefit:
    "Net benefit is margin contributed less discount given, price-exception cost and personal use. It is not profit: wages, overheads and refunds are not in it. Margin is split like commission (100% solo, else 90/10) and each order's margin counts from zero, so a sale below cost shows as exception cost instead.",
  speed:
    "Collection on time is credited to whoever marked it ready; delivery on time to whoever sent it out. First promise kept is against the first time promised, so declaring a delay does not move it. Stage times show the median and the slowest 10%. Counter sales are counted but left out of the medians.",
  fairness:
    "Rates put part-timers on the same footing: active hours are first to last action each day plus 10 minutes, at most 12 hours. Only rates are coloured, against the targets an admin set. KPIs met is greens over targets with enough data. Badges are earned against fixed bars; there is no ranking.",
};

function TeamLabel({ name, note }: { name: string; note: string }) {
  return (
    <span>
      <span className="font-medium">{name}</span>
      <span className="block text-xs text-muted-foreground">{note}</span>
    </span>
  );
}

function PerformanceTable({ data, section, onOpen }: { data: StaffPerformanceResponse; section: FigureSection; onOpen: (id: string) => void }) {
  const cols = COLUMNS[section];
  return (
    <div className="overflow-x-auto">
      <Table data-testid={`table-performance-${section}`}>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            {cols.map((c) => (
              <TableHead key={c.key} className="text-right">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((r) => (
            <TableRow key={r.userId} className="cursor-pointer" onClick={() => onOpen(r.userId)} data-testid={`row-performance-${r.userId}`}>
              <TableCell>
                <span className="font-medium underline-offset-2 hover:underline">{r.name}</span>
                <span className="block text-xs text-muted-foreground">{r.role === "MANAGER" ? "Manager" : "Cashier"}</span>
              </TableCell>
              {cols.map((c) => (
                <TableCell key={c.key} className="text-right whitespace-nowrap">
                  {c.render(r, r.change)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {data.team.adminCover && (
            <TableRow className="bg-muted/40" data-testid="row-performance-admin-cover">
              <TableCell><TeamLabel name="Admin cover" note="Admins and the owner. Counted, never ranked." /></TableCell>
              {cols.map((c) => <TableCell key={c.key} className="text-right whitespace-nowrap">{c.render(data.team.adminCover!)}</TableCell>)}
            </TableRow>
          )}
          <TableRow className="bg-muted/40" data-testid="row-performance-unattributed">
            <TableCell><TeamLabel name="Unattributed" note="Nobody named, or an account since removed." /></TableCell>
            {cols.map((c) => <TableCell key={c.key} className="text-right whitespace-nowrap">{c.render(data.team.unattributed)}</TableCell>)}
          </TableRow>
          <TableRow className="font-semibold" data-testid="row-performance-total">
            <TableCell><TeamLabel name="Total" note="Everyone, including people not listed here." /></TableCell>
            {cols.map((c) => <TableCell key={c.key} className="text-right whitespace-nowrap">{c.render(data.team.total, data.team.total.change)}</TableCell>)}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function PerformanceCards({ data, section, onOpen }: { data: StaffPerformanceResponse; section: FigureSection; onOpen: (id: string) => void }) {
  const cols = COLUMNS[section];
  const card = (key: string, title: ReactNode, f: PerformanceFigures, change?: Change, open?: () => void) => (
    <Card key={key} className={`lm-card border-0 shadow-none ${open ? "cursor-pointer" : ""}`} onClick={open} data-testid={`card-performance-${key}`}>
      <CardContent className="pt-4">
        <div className="mb-2">{title}</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {cols.map((c) => (
            <div key={c.key} className="contents">
              <dt className="text-muted-foreground">{c.label}</dt>
              <dd className="text-right">{c.render(f, change)}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
  return (
    <div className="space-y-3">
      {data.rows.map((r) => card(r.userId, <span className="font-medium">{r.name}</span>, r, r.change, () => onOpen(r.userId)))}
      {data.team.adminCover && card("admin-cover", <TeamLabel name="Admin cover" note="Counted, never ranked." />, data.team.adminCover)}
      {card("unattributed", <TeamLabel name="Unattributed" note="Nobody named." />, data.team.unattributed)}
      {card("total", <TeamLabel name="Total" note="Everyone." />, data.team.total, data.team.total.change)}
    </div>
  );
}

export function ProvisionalNote({ until }: { until: string }) {
  return (
    <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="text-performance-provisional">
      <Badge variant="secondary" className="mr-2">Provisional</Badge>
      Figures per person are new. They are being checked against the team totals until{" "}
      {new Date(until).toLocaleDateString("en-GB")}. Do not act on them before then.
    </p>
  );
}

export default function StaffPerformanceReport() {
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const today = useMemo(todayIso, []);
  const [preset, setPreset] = useState<PerformancePreset | "custom">("last-week");
  const initial = presetRange("last-week", today);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [locationId, setLocationId] = useState("all");
  const [role, setRole] = useState("all");
  const [fulfilment, setFulfilment] = useState("all");
  const [channel, setChannel] = useState("all");
  const [adminCover, setAdminCover] = useState(true);
  const [section, setSection] = useState<Section>("volume");

  const { data: locations = [] } = useQuery<LocationOption[]>({ queryKey: ["/api/locations"] });

  const choosePreset = (p: string) => {
    setPreset(p as PerformancePreset | "custom");
    if (p !== "custom") {
      const r = presetRange(p as PerformancePreset, today);
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const query = new URLSearchParams({ from, to, adminCover: adminCover ? "1" : "0" });
  if (locationId !== "all") query.set("locationId", locationId);
  if (role !== "all") query.set("role", role);
  if (fulfilment !== "all") query.set("fulfilment", fulfilment);
  if (channel !== "all") query.set("channel", channel);
  const params = query.toString();

  const { data, isLoading, isError } = useQuery<StaffPerformanceResponse>({
    queryKey: ["/api/evidence/staff-performance", params],
    queryFn: () => getJson(`/api/evidence/staff-performance?${params}`),
  });

  const open = (userId: string) => navigate(`/reports/staff-performance/${encodeURIComponent(userId)}?${params}`);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> All Evidence
      </Link>
      <PageHeader
        icon={UserCheck}
        title="Staff Performance"
        question="Who did what, and what did it bring in?"
        explanation="Completed orders settled in these dates, less personal use: the same orders as sales Evidence, so the rows add up to the sales you took. Pick a person to see their 8-week trend and orders."
      />

      <Card className="lm-card border-0 shadow-none">
        <CardContent className="pt-6 flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label>Dates</Label>
            <Select value={preset} onValueChange={choosePreset}>
              <SelectTrigger className="min-h-[44px] w-44" data-testid="select-performance-preset"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERFORMANCE_PRESETS.map((p) => <SelectItem key={p} value={p}>{PRESET_LABEL[p]}</SelectItem>)}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sp-from">From</Label>
            <Input id="sp-from" type="date" value={from} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} className="min-h-[44px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sp-to">To</Label>
            <Input id="sp-to" type="date" value={to} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} className="min-h-[44px]" />
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="min-h-[44px] w-44" data-testid="select-performance-location"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="min-h-[44px] w-36" data-testid="select-performance-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                <SelectItem value="CASHIER">Cashiers</SelectItem>
                <SelectItem value="MANAGER">Managers</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Fulfilment</Label>
            <Select value={fulfilment} onValueChange={setFulfilment}>
              <SelectTrigger className="min-h-[44px] w-36" data-testid="select-performance-fulfilment"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Both</SelectItem>
                <SelectItem value="collection">Collection</SelectItem>
                <SelectItem value="delivery">Delivery</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="min-h-[44px] w-36" data-testid="select-performance-channel"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {(data?.channels ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-h-[44px] items-center gap-2">
            <Switch id="sp-admin-cover" checked={adminCover} onCheckedChange={setAdminCover} data-testid="switch-performance-admin-cover" />
            <Label htmlFor="sp-admin-cover">Show admin cover</Label>
          </div>
        </CardContent>
      </Card>

      {isError && <p className="text-sm text-destructive">Could not load Staff Performance. Try again.</p>}
      {data?.provisional && <ProvisionalNote until={data.provisionalUntil} />}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Gross settled sales</p><p className="text-2xl font-semibold" data-testid="text-performance-gross">{money(data.grossSettledSales)}</p><ChangeBadge value={data.team.total.change.salesCompleted} /></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Orders completed</p><p className="text-2xl font-semibold">{data.team.total.completed}</p><ChangeBadge value={data.team.total.change.completed} /></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Average order</p><p className="text-2xl font-semibold">{data.team.total.averageOrderValue == null ? "—" : money(data.team.total.averageOrderValue)}</p></CardContent></Card>
          <Card className="lm-card border-0 shadow-none"><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Compared with</p><p className="text-base font-semibold">{data.previousPeriod.from} to {data.previousPeriod.to}</p></CardContent></Card>
        </div>
      )}

      <Card className="lm-card border-0 shadow-none">
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            {SECTION_HELP[section]}
            {data && data.hiddenPeople > 0 && ` ${data.hiddenPeople} people above your role are in the Total but not listed.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={section} onValueChange={(v) => setSection(v as Section)}>
            <TabsList className="mb-4">
              <TabsTrigger value="volume" data-testid="tab-performance-volume">Volume</TabsTrigger>
              <TabsTrigger value="value" data-testid="tab-performance-value">Value</TabsTrigger>
              <TabsTrigger value="quality" data-testid="tab-performance-quality">Quality</TabsTrigger>
              <TabsTrigger value="benefit" data-testid="tab-performance-benefit">Benefit</TabsTrigger>
              <TabsTrigger value="speed" data-testid="tab-performance-speed">Speed</TabsTrigger>
              <TabsTrigger value="fairness" data-testid="tab-performance-fairness">Fairness</TabsTrigger>
            </TabsList>
            {(["volume", "value", "quality", "benefit", "speed", "fairness"] as const).map((s) => (
              <TabsContent key={s} value={s}>
                {isLoading || !data ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : PEOPLE_SECTIONS.includes(s) ? (
                  isMobile ? (
                    <PeopleCards data={data} section={s as PeopleSection} onOpen={open} />
                  ) : (
                    <PeopleTable data={data} section={s as PeopleSection} onOpen={open} />
                  )
                ) : isMobile ? (
                  <PerformanceCards data={data} section={s as FigureSection} onOpen={open} />
                ) : (
                  <PerformanceTable data={data} section={s as FigureSection} onOpen={open} />
                )}
              </TabsContent>
            ))}
            {data && (section === "speed" || section === "fairness") && (
              <div className="mt-4 space-y-1">
                <SettingsInForceNote settings={data.settingsInForce} />
                <p className="text-xs text-muted-foreground">
                  {data.targets
                    ? `Targets version ${data.targets.version}, set ${new Date(data.targets.setAt).toLocaleDateString("en-GB")}${data.targets.amberOnly ? " — first four weeks, nothing shows red" : ""}. `
                    : "No targets set yet. "}
                  <Link href="/reports/staff-targets" className="underline">Staff targets</Link>
                </p>
              </div>
            )}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
