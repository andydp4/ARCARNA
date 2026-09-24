/**
 * The 7C pieces of Staff Performance (v1.2 Phase 7C), shared by the Evidence
 * table, the drill-down and My performance: KPI colours, badges, speed,
 * fairness rates, benefit and the on-time settings in force.
 *
 * Only rates carry a colour (a target); totals stay plain. Colours come with
 * a word as well, never colour alone. Benefit is only ever passed in by the
 * Evidence pages: My performance never receives it (cost is never sent to a
 * cashier).
 */
import { Award } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BenefitFigures } from "@shared/reports/staffBenefit";
import type { SpeedFigures, StageStat } from "@shared/reports/staffSpeed";
import type { FairnessRates } from "@shared/reports/staffFairness";
import type { KpiColour, KpiResult, KpiSummary } from "@shared/reports/staffTargets";
import type { Badge as EarnedBadge } from "@shared/reports/staffBadges";

export type { BenefitFigures, SpeedFigures, FairnessRates, KpiSummary, EarnedBadge };

export function money(n: number | null | undefined): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n ?? 0);
}
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
export const mins = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)} min`);
export const num1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

const COLOUR_CLASS: Record<KpiColour, string> = {
  green: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  red: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  grey: "bg-muted text-muted-foreground",
};
const COLOUR_WORD: Record<KpiColour, string> = { green: "Met", amber: "Close", red: "Not met", grey: "Too little data" };

function formatValue(r: Pick<KpiResult, "value" | "unit">): string {
  if (r.value == null) return "—";
  switch (r.unit) {
    case "%":
      return pct(r.value);
    case "min":
      return mins(r.value);
    case "£/h":
      return `${money(r.value)}/h`;
    case "/h":
      return `${r.value.toFixed(1)}/h`;
    default:
      return r.value.toFixed(1);
  }
}

export function KpiChip({ colour, children, testId }: { colour: KpiColour; children?: React.ReactNode; testId?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", COLOUR_CLASS[colour])} data-testid={testId} data-colour={colour}>
      {children ?? COLOUR_WORD[colour]}
    </span>
  );
}

/** "3 of 4 KPIs met", coloured by how many. */
export function KpisMet({ kpis }: { kpis: KpiSummary }) {
  if (kpis.results.length === 0) return <span className="text-xs text-muted-foreground">No targets set</span>;
  if (kpis.of === 0) return <KpiChip colour="grey">Not enough data</KpiChip>;
  const colour: KpiColour = kpis.met === kpis.of ? "green" : kpis.met === 0 && !kpis.amberOnly ? "red" : "amber";
  return <KpiChip colour={colour}>{`${kpis.met} of ${kpis.of} met`}</KpiChip>;
}

export function KpiList({ kpis }: { kpis: KpiSummary }) {
  if (kpis.results.length === 0) {
    return <p className="text-sm text-muted-foreground">No targets are set yet. An admin sets them under Staff targets.</p>;
  }
  return (
    <div className="space-y-2" data-testid="list-kpis">
      {kpis.amberOnly && (
        <p className="text-xs text-muted-foreground">Targets are new: for the first four weeks nothing shows red.</p>
      )}
      <ul className="space-y-1">
        {kpis.results.map((r) => (
          <li key={r.metric} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid={`kpi-${r.metric}`}>
            <span>{r.label}</span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{formatValue(r)}</span>
              <span className="text-xs text-muted-foreground">
                target {formatValue({ value: r.green, unit: r.unit })}
              </span>
              <KpiChip colour={r.colour} testId={`kpi-colour-${r.metric}`} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BadgeList({ badges }: { badges: EarnedBadge[] }) {
  if (badges.length === 0) return <p className="text-sm text-muted-foreground">No badges this time.</p>;
  return (
    <ul className="flex flex-wrap gap-2" data-testid="list-badges">
      {badges.map((b) => (
        <li key={b.key}>
          <Badge variant="secondary" title={b.why} className="gap-1">
            <Award className="h-3 w-3" aria-hidden /> {b.label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground" title={hint}>{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

const stage = (s: StageStat) => (s.count === 0 ? "—" : `${mins(s.medianMinutes)} · slowest 10% ${mins(s.slowest10Minutes)}`);

export function SpeedList({ speed }: { speed: SpeedFigures }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="list-speed">
      <Row label="Collections ready on time" value={`${pct(speed.collectionOnTimePercent)} (${speed.collectionJudged})`} hint="Credited to whoever marked it ready." />
      <Row label="Deliveries on time" value={`${pct(speed.deliveryOnTimePercent)} (${speed.deliveryJudged})`} hint="Credited to whoever sent it out." />
      <Row label="First promise kept" value={`${pct(speed.firstPromiseKeptPercent)} (${speed.firstPromiseJudged})`} hint="Against the first time promised, so a declared delay does not move it." />
      <Row label="Received → ready" value={stage(speed.receivedToReady)} />
      <Row label="Ready → handed over" value={stage(speed.readyToHandover)} />
      <Row label="Out → delivered" value={stage(speed.dispatchToDelivered)} />
      <Row label="Customer waiting" value={speed.customerWaitingIncidents} hint="The customer arrived before the order was ready." />
      <Row label="Promise length" value={`${mins(speed.promiseMedianMinutes)} · ${pct(speed.promiseWithinTargetPercent)} within target`} />
      <Row label="Delays told in advance" value={`${speed.delaysToldInAdvance} of ${speed.delaysDeclared}`} />
      <Row label="Alert to acknowledge" value={`${mins(speed.alertToAckMedianMinutes)} (${speed.alertsAcknowledged})`} />
      <Row label="Instant counter sales" value={speed.instantCounterSales} hint="Counted, but left out of the medians." />
    </dl>
  );
}

export function FairnessList({ rates }: { rates: FairnessRates }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="list-fairness">
      <Row label="Active hours" value={num1(rates.activeHours)} hint="First to last action each day, plus 10 minutes, at most 12 hours." />
      <Row label="Days worked" value={rates.daysWorked} />
      <Row label="Jobs per active hour" value={num1(rates.jobsPerActiveHour)} />
      <Row label="Value per active hour" value={rates.valuePerActiveHour == null ? "—" : money(rates.valuePerActiveHour)} />
      <Row label="Jobs per day" value={num1(rates.jobsPerDay)} />
      <Row label="Value per day" value={rates.valuePerDay == null ? "—" : money(rates.valuePerDay)} />
      <Row label="Refunds per 10 orders" value={num1(rates.refundsPer10Orders)} />
      <Row label="Wrong items per 10 orders" value={num1(rates.wrongItemsPer10Orders)} />
      <Row label="Reopens per 10 orders" value={num1(rates.reopensPer10Orders)} />
      <Row label="Deletes per 10 orders" value={num1(rates.deletesPer10Orders)} />
    </dl>
  );
}

export function BenefitList({ benefit }: { benefit: BenefitFigures }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="list-benefit">
      <Row label="Net benefit" value={<span className="font-semibold">{money(benefit.netBenefit)}</span>} hint="Margin less discount, price-exception cost and personal use. Not profit." />
      <Row label="Margin contributed" value={money(benefit.marginContributed)} hint="Split like commission: 100% solo, else 90/10." />
      <Row label="Discount given" value={money(benefit.discountGiven)} />
      <Row label="Price-exception cost" value={money(benefit.priceExceptionCost)} />
      <Row label="Personal use" value={money(benefit.personalUseCost)} />
      <Row label="Customer named" value={`${pct(benefit.namedCustomerCapturePercent)} of ${benefit.ordersTaken}`} />
      <Row label="New customers" value={benefit.newCustomers} />
      <Row label="Credit recovered" value={money(benefit.creditRecovered)} />
      <Row label="Bad debt originated" value={money(benefit.badDebtOriginated)} />
      <Row label="Refund cost" value={money(benefit.refundCost)} />
      {benefit.costMissingLines > 0 && <Row label="Lines with no cost" value={benefit.costMissingLines} hint="Left out of the margin." />}
    </dl>
  );
}

export type SettingsInForce = {
  now: { prepSlaMinutes: number; deliveryLeadMinutes: number; lateGraceMinutes: number };
  changes: Array<{ setting: string; from: unknown; to: unknown; at: string }>;
};

const SETTING_LABEL: Record<string, string> = {
  opsPrepSlaMinutes: "prep time",
  opsDeliveryLeadMinutes: "delivery lead",
  opsLateGraceMinutes: "late grace",
  opsDueSoonLeadMinutes: "due-soon warning",
};

export function SettingsInForceNote({ settings }: { settings: SettingsInForce }) {
  return (
    <p className="text-xs text-muted-foreground" data-testid="text-settings-in-force">
      On time means ready within {settings.now.prepSlaMinutes} min for a collection and handed over within{" "}
      {settings.now.deliveryLeadMinutes} min for a delivery when no time was promised, with {settings.now.lateGraceMinutes} min grace.
      {settings.changes.length > 0 &&
        ` Changed since the start of these dates: ${settings.changes
          .map((c) => `${SETTING_LABEL[c.setting] ?? c.setting} ${String(c.from)} → ${String(c.to)} on ${new Date(c.at).toLocaleDateString("en-GB")}`)
          .join("; ")}.`}
    </p>
  );
}
