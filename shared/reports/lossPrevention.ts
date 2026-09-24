/**
 * Loss-prevention flags (v1.2 Phase 7C, STF-09): patterns worth a look.
 *
 * Each week, after the Monday close, a small set of measures is compared for
 * every cashier and manager against their own recent weeks and against
 * everyone's. A flag is raised into Needs a look only when BOTH:
 *
 *  1. there were **3 or more events** that week, and
 *  2. the week is **at least twice the person's 8-week baseline** (the mean of
 *     the weeks they worked in the 8 before), **or** it is in the **top 5%**
 *     of every person-week in the window (with at least 20 person-weeks to
 *     compare, so a small team does not flag its busiest person every week).
 *
 * A flag is a question, not a finding: most have a simple reason (a busy
 * week, a new starter, a promotion). The wording says what was counted and
 * what is usual, and nothing about intent.
 *
 * Routing is Needs a look's own rule (`shared/review/exceptions.ts`): flags
 * about cashiers reach managers and admins; flags about managers reach admins
 * only; nobody sees their own.
 */

export const LP_MIN_EVENTS = 3;
export const LP_BASELINE_WEEKS = 8;
export const LP_BASELINE_MULTIPLE = 2;
export const LP_TOP_PERCENT = 5;
/** Below this many person-weeks, "top 5%" is not a meaningful comparison. */
export const LP_TOP_MIN_SAMPLES = 20;

export const LP_METRICS = {
  refunds: { label: "Refunds processed", unit: "count" },
  cashRefunds: { label: "Cash refunds", unit: "count" },
  wrongItemRefunds: { label: "Wrong-item refunds on orders they picked", unit: "count" },
  deletes: { label: "Orders deleted", unit: "count" },
  reopens: { label: "Orders reopened", unit: "count" },
  unreadyTaps: { label: "Unready taps", unit: "count" },
  personalUse: { label: "Personal-use sales", unit: "count" },
  discountPercent: { label: "Discount on their sales", unit: "percent" },
  priceExceptions: { label: "Sales below the minimum or cost", unit: "count" },
  completedOthers: { label: "Orders completed that someone else was dealing with", unit: "count" },
  duplicateCustomers: { label: "Customer records added that look like duplicates", unit: "count" },
  afterSaleEdits: { label: "Edits to orders after the sale", unit: "count" },
  minLoweredThenSold: { label: "Sales at a minimum price they had just lowered", unit: "count" },
  selfConfirmedCommission: { label: "Commission payments confirmed to themselves", unit: "count" },
  settingChanges: { label: "Pay or on-time setting changes", unit: "count" },
} as const;

export type LpMetric = keyof typeof LP_METRICS;
export const LP_METRIC_KEYS = Object.keys(LP_METRICS) as LpMetric[];

/** One person's week for one measure. `value` is the count, or the percentage for a rate measure. */
export interface LpWeek {
  events: number;
  value: number;
}

export interface LpDecision {
  flagged: boolean;
  reason: "baseline" | "top" | null;
  baseline: number | null;
  topThreshold: number | null;
}

function percentileAtLeast(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/**
 * The threshold for "top 5%" of a measure: the 95th percentile of every
 * person-week in the window. Null when there are too few to compare.
 */
export function topThreshold(personWeekValues: readonly number[]): number | null {
  if (personWeekValues.length < LP_TOP_MIN_SAMPLES) return null;
  return percentileAtLeast(personWeekValues, 100 - LP_TOP_PERCENT);
}

/**
 * The rule. `previous` is the person's weeks worked in the 8 before this one
 * (weeks they did not work are left out, so a part-timer's baseline is their
 * working weeks). With no previous working week there is no baseline to be
 * twice of, and only the top-5% test applies.
 */
export function decideFlag(week: LpWeek, previous: readonly LpWeek[], top: number | null): LpDecision {
  const baseline = previous.length > 0 ? previous.reduce((s, w) => s + w.value, 0) / previous.length : null;
  if (week.events < LP_MIN_EVENTS) return { flagged: false, reason: null, baseline, topThreshold: top };
  if (baseline != null && week.value >= LP_BASELINE_MULTIPLE * baseline) {
    return { flagged: true, reason: "baseline", baseline, topThreshold: top };
  }
  if (top != null && week.value > 0 && week.value >= top) return { flagged: true, reason: "top", baseline, topThreshold: top };
  return { flagged: false, reason: null, baseline, topThreshold: top };
}

function fmt(metric: LpMetric, v: number): string {
  if (LP_METRICS[metric].unit === "percent") return `${(Math.round(v * 10) / 10).toFixed(1)}%`;
  return String(Math.round(v * 10) / 10);
}

/**
 * Neutral wording for the Needs a look row. Says what was counted and what is
 * usual; never why, and never a word like "suspicious".
 */
export function flagSummary(metric: LpMetric, weekLabel: string, week: LpWeek, decision: LpDecision): string {
  const label = LP_METRICS[metric].label;
  const now = fmt(metric, week.value);
  const usual =
    decision.baseline != null
      ? `usually about ${fmt(metric, decision.baseline)} a week`
      : "no earlier weeks to compare with";
  const how = decision.reason === "top" ? "among the highest weeks across the team" : "at least twice their usual";
  return `${label}: ${now} in the week of ${weekLabel} (${usual}; ${how}). Worth a look — there is often a simple reason.`;
}
