/**
 * Staff targets and "KPIs met" (v1.2 Phase 7C, STF-07/STF-08).
 *
 * Owner decisions (Q16): targets are set by admins only, and every change is
 * logged and versioned — a new version is written, never an edit in place, so
 * any past colour can be explained by the targets in force then. There is no
 * pay link: no £ bonus figure anywhere, and the old £50/£100/£150 tiers are
 * gone. Only rates and percentages can have a target (fairness: a total mostly
 * measures how long someone worked).
 *
 * Colours: green (met), amber (close), red (not close), grey (too little data
 * to say). "KPIs met" = greens ÷ targets that have enough data. For the first
 * four weeks after targets are first set, nothing is shown red — red reads as
 * amber — so people get time to see the measure before it judges them.
 */
import { z } from "zod";
import type { PerformanceFigures } from "./staffPerformance";
import type { SpeedFigures } from "./staffSpeed";
import type { FairnessRates } from "./staffFairness";

export const AMBER_ONLY_DAYS = 28;

export type KpiColour = "green" | "amber" | "red" | "grey";

/** Everything a target can be measured against, for one person. No cost is in it. */
export interface KpiSource {
  figures: Pick<PerformanceFigures, "wrongItemRatePercent" | "picked">;
  speed: SpeedFigures;
  rates: FairnessRates;
  namedCustomerCapturePercent: number | null;
  ordersTaken: number;
}

interface MetricDef {
  label: string;
  better: "higher" | "lower";
  unit: "%" | "min" | "/h" | "£/h" | "/10";
  /** How much data a colour needs by default (orders, hours or alerts). */
  defaultMinData: number;
  value: (s: KpiSource) => number | null;
  data: (s: KpiSource) => number;
}

export const TARGET_METRICS = {
  collectionOnTimePercent: {
    label: "Collections ready on time",
    better: "higher",
    unit: "%",
    defaultMinData: 10,
    value: (s) => s.speed.collectionOnTimePercent,
    data: (s) => s.speed.collectionJudged,
  },
  deliveryOnTimePercent: {
    label: "Deliveries on time",
    better: "higher",
    unit: "%",
    defaultMinData: 10,
    value: (s) => s.speed.deliveryOnTimePercent,
    data: (s) => s.speed.deliveryJudged,
  },
  firstPromiseKeptPercent: {
    label: "First promise kept",
    better: "higher",
    unit: "%",
    defaultMinData: 10,
    value: (s) => s.speed.firstPromiseKeptPercent,
    data: (s) => s.speed.firstPromiseJudged,
  },
  receivedToReadyMedianMinutes: {
    label: "Received to ready (median)",
    better: "lower",
    unit: "min",
    defaultMinData: 10,
    value: (s) => s.speed.receivedToReady.medianMinutes,
    data: (s) => s.speed.receivedToReady.count,
  },
  alertToAckMedianMinutes: {
    label: "Alert to acknowledge (median)",
    better: "lower",
    unit: "min",
    defaultMinData: 5,
    value: (s) => s.speed.alertToAckMedianMinutes,
    data: (s) => s.speed.alertsAcknowledged,
  },
  namedCustomerCapturePercent: {
    label: "Customer named on the sale",
    better: "higher",
    unit: "%",
    defaultMinData: 10,
    value: (s) => s.namedCustomerCapturePercent,
    data: (s) => s.ordersTaken,
  },
  wrongItemRatePercent: {
    label: "Wrong items",
    better: "lower",
    unit: "%",
    defaultMinData: 20,
    value: (s) => s.figures.wrongItemRatePercent,
    data: (s) => s.figures.picked,
  },
  jobsPerActiveHour: {
    label: "Jobs per active hour",
    better: "higher",
    unit: "/h",
    defaultMinData: 4,
    value: (s) => s.rates.jobsPerActiveHour,
    data: (s) => s.rates.activeHours,
  },
  valuePerActiveHour: {
    label: "Value brought in per active hour",
    better: "higher",
    unit: "£/h",
    defaultMinData: 4,
    value: (s) => s.rates.valuePerActiveHour,
    data: (s) => s.rates.activeHours,
  },
  refundsPer10Orders: {
    label: "Refunds per 10 orders",
    better: "lower",
    unit: "/10",
    defaultMinData: 20,
    value: (s) => s.rates.refundsPer10Orders,
    data: (s) => s.rates.ordersHandled,
  },
} satisfies Record<string, MetricDef>;

export type TargetMetric = keyof typeof TARGET_METRICS;
export const TARGET_METRIC_KEYS = Object.keys(TARGET_METRICS) as TargetMetric[];

export interface StaffTarget {
  metric: TargetMetric;
  /** Met at or beyond this (at or above for "higher", at or below for "lower"). */
  green: number;
  /** Close at or beyond this. */
  amber: number;
  /** Data needed before a colour is shown; grey below it. */
  minData?: number;
}

export const staffTargetSchema = z
  .object({
    metric: z.enum(TARGET_METRIC_KEYS as [TargetMetric, ...TargetMetric[]]),
    green: z.number().finite().min(0).max(100000),
    amber: z.number().finite().min(0).max(100000),
    minData: z.number().int().min(1).max(10000).optional(),
  })
  .refine((t) => (TARGET_METRICS[t.metric].better === "higher" ? t.green >= t.amber : t.green <= t.amber), {
    message: "Green must be at least as good as amber.",
    path: ["amber"],
  });

export const staffTargetsSchema = z.object({
  targets: z
    .array(staffTargetSchema)
    .max(TARGET_METRIC_KEYS.length)
    .refine((list) => new Set(list.map((t) => t.metric)).size === list.length, { message: "Each measure can have one target." }),
  note: z.string().trim().max(500).optional(),
});

export type StaffTargetsInput = z.infer<typeof staffTargetsSchema>;

/** Red reads as amber until four weeks after targets were first set. */
export function isAmberOnly(firstSetAt: Date | null, now: Date): boolean {
  if (!firstSetAt) return true;
  return now.getTime() < firstSetAt.getTime() + AMBER_ONLY_DAYS * 86_400_000;
}

export function colourFor(value: number | null, dataCount: number, target: StaffTarget, amberOnly: boolean): KpiColour {
  const def = TARGET_METRICS[target.metric];
  if (value == null || dataCount < (target.minData ?? def.defaultMinData)) return "grey";
  const atLeast = (limit: number) => (def.better === "higher" ? value >= limit : value <= limit);
  if (atLeast(target.green)) return "green";
  if (atLeast(target.amber)) return "amber";
  return amberOnly ? "amber" : "red";
}

export interface KpiResult {
  metric: TargetMetric;
  label: string;
  unit: string;
  better: "higher" | "lower";
  value: number | null;
  data: number;
  green: number;
  amber: number;
  colour: KpiColour;
}

export interface KpiSummary {
  results: KpiResult[];
  /** Greens. */
  met: number;
  /** Targets with enough data (not grey). */
  of: number;
  amberOnly: boolean;
}

export function evaluateKpis(source: KpiSource, targets: readonly StaffTarget[], amberOnly: boolean): KpiSummary {
  const results = targets.map((t): KpiResult => {
    const def = TARGET_METRICS[t.metric];
    const value = def.value(source);
    const data = def.data(source);
    return {
      metric: t.metric,
      label: def.label,
      unit: def.unit,
      better: def.better,
      value,
      data,
      green: t.green,
      amber: t.amber,
      colour: colourFor(value, data, t, amberOnly),
    };
  });
  const scored = results.filter((r) => r.colour !== "grey");
  return { results, met: scored.filter((r) => r.colour === "green").length, of: scored.length, amberOnly };
}

/** "3 of 4 KPIs met", or a plain word when nothing had enough data. */
export function kpisMetLabel(s: Pick<KpiSummary, "met" | "of">): string {
  return s.of === 0 ? "Not enough data yet" : `${s.met} of ${s.of} KPIs met`;
}
