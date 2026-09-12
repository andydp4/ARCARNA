/**
 * Order Timing & Service Levels (ARC-T2-005) — the pure maths.
 *
 * Phase N, N7 "maths + engine" round (docs/briefs/PHASE_N_OPERATIONS_CENTRE.md,
 * "Reporting"). This module does no I/O and never reads a clock: every date it
 * touches arrives as a field on the order the caller already fetched, exactly
 * the convention `shared/time/tradingDay.ts` and `shared/orders/opsState.ts`
 * set (see `docs/testing/FAKE_TIME.md`). `server/services/reportsEngine.ts`
 * (the "engine" half) is the only caller: it reads `orders` and `order_events`
 * from the database, assembles one `TimingOrderInput` per order, and hands the
 * array here.
 *
 * **Consistency with the board.** Per-order due/received/handover facts are
 * derived by calling `deriveCardState` (`shared/orders/opsState.ts`) rather
 * than recomputing them — a report that disagreed with the board about
 * whether an order was on time would be worse than no report at all. The
 * `now` `deriveCardState` takes is irrelevant to the fields this module reads
 * off it (`receivedAt`, `dueAt`, `dueEffective`, `handoverAt` are all resolved
 * before `now` enters the calculation at all) — an arbitrary anchor after the
 * order settled is supplied so nothing downstream depends on it.
 *
 * **Exclusions** (brief, "Reporting"): a `date_kind='backdated'` order was
 * deliberately entered for a day already gone and was never going to be
 * timely by construction, exactly the same reason `deriveCardState` never
 * marks one late; a "carried-over completion" — received on one trading day,
 * settled on a later one — would otherwise let one long-open order's ancient
 * received time corrupt every day it happened to still be open on; and a
 * `ready` event stamped `meta.assumed:true` by migration 065's backfill
 * records a real column value with no real moment behind it, so it counts as
 * "entered afterwards" (present in the order count) but contributes no
 * ready-touching duration or on-time verdict. All three are counted and
 * reported (`OrderTimingSummary.excluded`) rather than silently dropped.
 *
 * **Re-settlement.** `orderCompletion.ts` (N3b) writes a SECOND `completed`
 * event for a reopened-then-recompleted order, carrying `meta.resettled:true`
 * — the row's own `settled_at` / `completed_user_id` are already rewritten in
 * place, so the order still has exactly one current settlement. This module
 * takes one `TimingOrderInput` per order for exactly that reason: as long as
 * the caller assembles one input row per order (from the CURRENT `orders`
 * row, not one row per `order_events` hit), a resettled order is counted
 * once, using its final settlement, by construction — there is no dedupe step
 * to get right here because there is nothing to dedupe. The danger the N3b
 * review flagged is entirely on the query side: a caller that instead counted
 * completions by scanning `order_events` for `kind='completed'` rows would
 * see two per resettled order (the original, and the `resettled:true` one)
 * and must collapse them to the most recent per `orderId` — which is exactly
 * what `server/services/reportsEngine.ts`'s `orderTimingReport` does, and
 * `server/__tests__/orderTimingReport.test.ts` proves it with a real reopen +
 * re-complete against a live database.
 */
import {
  deriveCardState,
  type DateKind,
  type FulfilmentMethod,
  type OpsOrderInput,
  type OpsTimingSettings,
} from "../orders/opsState";
import { tradingDayFor } from "../time/tradingDay";

// --------------------------------------------------------------- input shape

/**
 * One order's timing-relevant facts, as the engine assembles them from
 * `orders` plus `order_events`. Extends `OpsOrderInput` (the same shape
 * `deriveCardState` and the board already take) with the handful of extra
 * facts only a report needs — who was involved, whether it was ever delayed,
 * how long it spent held, and the two Migration-065-era exclusion flags.
 */
export interface TimingOrderInput extends OpsOrderInput {
  id: string;
  channel: string;
  /** The auth subject of the FIRST `assigned` event, or null if never claimed. */
  claimedAt: string | Date | null;
  /** Had at least one `delayed` event at any point in its life. */
  wasDelayed: boolean;
  /**
   * `revised_eta` as it stood at the moment of the most recent `delayed`
   * event — the promise staff actually made after moving it, which is what
   * "revised-promise accuracy" measures the order against. Null when never
   * delayed, or when a `delayed` event was written with no revised time.
   */
  revisedPromiseAtDelay: string | Date | null;
  /** Sum of every `unheld.meta.heldSeconds` across the order's life. */
  heldSeconds: number;
  assignedUserId: string | null;
  completedUserId: string | null;
  inputUserId: string | null;
  /** The assignee's `ops_staff.station` at read time — null if unassigned, unstaffed, or "All". */
  station: string | null;
  /**
   * `true` when the order's `ready` event carries `meta.assumed:true` — the
   * migration 065 backfill (`WHERE o.ready_at IS NULL AND o.status =
   * 'awaiting-customer'`), which stamped a real column from `updated_at` with
   * no real "someone marked it ready" moment behind it. Counted, not timed.
   */
  readyAssumed: boolean;
}

// -------------------------------------------------------------- derived shape

export interface DerivedOrderTiming {
  id: string;
  fulfilmentMethod: FulfilmentMethod;
  channel: string;
  assignedUserId: string | null;
  completedUserId: string | null;
  inputUserId: string | null;
  station: string | null;
  /** The trading day `receivedAt` falls on, in the org timezone — the "day" and "hour of trading day" grouping key. */
  tradingDay: string;
  /** Local hour (0–23) `receivedAt` falls on, per `hourOfTradingDay`. */
  hourOfTradingDay: number;
  /** `false` when this order counts toward every figure below; a reason otherwise. */
  excluded: false | "backdated" | "carried-over" | "assumed-ready";
  hasPromise: boolean;
  /** Collection: `readyAt ≤ dueEffective`. Delivery: `handoverAt ≤ dueEffective`. Null while not yet judged (not backdated: see brief "Collection vs delivery"). */
  onTime: boolean | null;
  /** As `onTime`, but against the real promise (`dueAt`) only — null when there was no promise. */
  promiseKept: boolean | null;
  /** Minutes late (positive) or early (negative) against `dueEffective`, at the moment `onTime` was judged. Null when `onTime` is null. */
  latenessMinutes: number | null;
  receivedToClaimedMinutes: number | null;
  receivedToReadyMinutes: number | null;
  readyToHandoverMinutes: number | null;
  arrivedToHandoverMinutes: number | null;
  dispatchToDeliveredMinutes: number | null;
  receivedToCompletedMinutes: number | null;
  wasDelayed: boolean;
  /** Among delayed orders with a revised promise: was the revised promise itself kept? Null when not applicable. */
  revisedPromiseKept: boolean | null;
  /** The customer arrived before the order was ready (collection only; brief state 5, "customer-waiting"). */
  customerWaitingIncident: boolean;
  heldSeconds: number;
  /** Never claimed before completion (or, for a still-open order, at all). */
  everUnassigned: boolean;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function diffMinutes(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}

/**
 * Local hour (0–23) an instant falls on in a timezone — the "hour of trading
 * day" grouping. Deliberately NOT `shared/time/tradingDay.ts`'s 06:00-cut
 * hour (that module answers "which day", this answers "which hour of the
 * clock a customer would recognise") — a small, independent computation, not
 * a reimplementation of the day-boundary maths that module owns.
 */
export function localHour(instant: Date, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const hour = formatted.find((p) => p.type === "hour")?.value ?? "0";
  return Number(hour);
}

/**
 * Derives one order's report-ready timing facts. Pure: `timezone` and
 * `settings` are the only "environment" this reads, both supplied by the
 * caller (never the clock, never a fetch) per this codebase's convention.
 */
export function deriveOrderTiming(order: TimingOrderInput, settings: OpsTimingSettings): DerivedOrderTiming {
  // `deriveCardState`'s `now` only affects the classified `state` and the
  // urgency/pulse flags this module never reads — `receivedAt`, `dueAt`,
  // `dueEffective` and `handoverAt` are resolved before `now` is used at all,
  // so any fixed anchor after the order settled is an inert placeholder here.
  const anchor = toDate(order.settledAt) ?? toDate(order.readyAt) ?? toDate(order.enteredAt) ?? new Date(order.createdAt);
  const derived = deriveCardState(order, anchor, settings);

  const receivedAt = derived.receivedAt;
  const dueAt = derived.dueAt;
  const dueEffective = derived.dueEffective;
  const handoverAt = derived.handoverAt;
  const claimedAt = toDate(order.claimedAt);
  const readyAt = toDate(order.readyAt);
  const customerArrivedAt = toDate(order.customerArrivedAt);
  const outForDeliveryAt = toDate(order.outForDeliveryAt);
  const revisedPromiseAtDelay = toDate(order.revisedPromiseAtDelay);

  const backdated = order.dateKind === "backdated";
  const carriedOver =
    !backdated && handoverAt != null && tradingDayFor(receivedAt, settings.timezone) !== tradingDayFor(handoverAt, settings.timezone);
  const excluded: DerivedOrderTiming["excluded"] = backdated
    ? "backdated"
    : order.readyAssumed
      ? "assumed-ready"
      : carriedOver
        ? "carried-over"
        : false;

  // Collection lateness (and therefore its timing judgement) stops at
  // `ready_at`; delivery runs to handover — the same split `deriveCardState`
  // draws for "late" (brief, "Collection vs delivery").
  const judgementAt: Date | null = order.fulfilmentMethod === "collection" ? readyAt : handoverAt;
  const onTime = excluded || judgementAt == null ? null : judgementAt.getTime() <= dueEffective.getTime();
  const promiseKept = excluded || dueAt == null || judgementAt == null ? null : judgementAt.getTime() <= dueAt.getTime();
  const latenessMinutes = excluded || judgementAt == null ? null : diffMinutes(dueEffective, judgementAt);

  const revisedPromiseKept =
    excluded || !order.wasDelayed || revisedPromiseAtDelay == null || judgementAt == null
      ? null
      : judgementAt.getTime() <= revisedPromiseAtDelay.getTime();

  const customerWaitingIncident =
    !excluded &&
    order.fulfilmentMethod === "collection" &&
    customerArrivedAt != null &&
    (readyAt == null || customerArrivedAt.getTime() < readyAt.getTime());

  return {
    id: order.id,
    fulfilmentMethod: order.fulfilmentMethod,
    channel: order.channel,
    assignedUserId: order.assignedUserId,
    completedUserId: order.completedUserId,
    inputUserId: order.inputUserId,
    station: order.station,
    tradingDay: tradingDayFor(receivedAt, settings.timezone),
    hourOfTradingDay: localHour(receivedAt, settings.timezone),
    excluded,
    hasPromise: dueAt != null,
    onTime,
    promiseKept,
    latenessMinutes,
    receivedToClaimedMinutes: excluded || claimedAt == null ? null : diffMinutes(receivedAt, claimedAt),
    receivedToReadyMinutes: excluded || readyAt == null ? null : diffMinutes(receivedAt, readyAt),
    readyToHandoverMinutes: excluded || readyAt == null || handoverAt == null ? null : diffMinutes(readyAt, handoverAt),
    arrivedToHandoverMinutes:
      excluded || customerArrivedAt == null || handoverAt == null ? null : diffMinutes(customerArrivedAt, handoverAt),
    dispatchToDeliveredMinutes:
      excluded || order.fulfilmentMethod !== "delivery" || outForDeliveryAt == null || handoverAt == null
        ? null
        : diffMinutes(outForDeliveryAt, handoverAt),
    receivedToCompletedMinutes: excluded || handoverAt == null ? null : diffMinutes(receivedAt, handoverAt),
    wasDelayed: order.wasDelayed,
    revisedPromiseKept,
    customerWaitingIncident,
    heldSeconds: order.heldSeconds,
    everUnassigned: claimedAt == null,
  };
}

// ------------------------------------------------------------------ summary

export interface DurationStats {
  receivedToClaimedMinutes: number | null;
  receivedToReadyMinutes: number | null;
  readyToHandoverMinutes: number | null;
  arrivedToHandoverMinutes: number | null;
  dispatchToDeliveredMinutes: number | null;
  receivedToCompletedMinutes: number | null;
}

export interface OrderTimingSummary {
  ordersConsidered: number;
  ordersExcluded: number;
  excludedBackdated: number;
  excludedCarriedOver: number;
  excludedAssumedReady: number;
  withPromisePercent: number | null;
  onTimePercent: number | null;
  collectionOnTimePercent: number | null;
  deliveryOnTimePercent: number | null;
  /** p90 of `receivedToCompletedMinutes` for delivery orders only — what the "Delivery p90 over 60 min" red flag reads. */
  deliveryP90ReceivedToCompletedMinutes: number | null;
  promiseKeptPercent: number | null;
  averageLatenessMinutes: number | null;
  medians: DurationStats;
  p90s: DurationStats;
  delayedCount: number;
  revisedPromiseAccuracyPercent: number | null;
  customerWaitingIncidents: number;
  heldOrdersCount: number;
  averageHeldMinutes: number | null;
  unassignedOrdersCount: number;
  averageUnassignedMinutes: number | null;
  /**
   * Alert → ack and alert → ready medians (brief: `COALESCE(acked_at,
   * resolved_at)` and alert → ready). `ops_alerts` does not exist until
   * migration 066 (N5a, sequenced AFTER this package by the brief's own
   * delivery order) — always null this round, kept as named fields so N5a's
   * PR fills them in rather than reshaping this type.
   */
  alertToAckMedianMinutes: number | null;
  alertToReadyMedianMinutes: number | null;
}

function percentileOf(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(Math.max(rank, 0), sortedAsc.length - 1)];
}

function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  return percentileOf(sorted, 50);
}

function p90(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  return percentileOf(sorted, 90);
}

function average(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

function percentOf(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}

const DURATION_KEYS: (keyof DurationStats)[] = [
  "receivedToClaimedMinutes",
  "receivedToReadyMinutes",
  "readyToHandoverMinutes",
  "arrivedToHandoverMinutes",
  "dispatchToDeliveredMinutes",
  "receivedToCompletedMinutes",
];

function durationStats(facts: DerivedOrderTiming[], fn: (values: (number | null)[]) => number | null): DurationStats {
  const stats = {} as DurationStats;
  for (const key of DURATION_KEYS) {
    stats[key] = fn(facts.map((f) => f[key]));
  }
  return stats;
}

/**
 * Aggregates a batch of already-derived per-order facts into the report's
 * headline figures. Excluded orders (see `DerivedOrderTiming.excluded`) are
 * counted in `ordersExcluded` / the `excluded*` breakdown and contribute to
 * NOTHING else — every other figure below is computed only from the
 * remaining, included orders.
 */
export function summarizeOrderTiming(facts: DerivedOrderTiming[]): OrderTimingSummary {
  const included = facts.filter((f) => f.excluded === false);
  const excludedBackdated = facts.filter((f) => f.excluded === "backdated").length;
  const excludedCarriedOver = facts.filter((f) => f.excluded === "carried-over").length;
  const excludedAssumedReady = facts.filter((f) => f.excluded === "assumed-ready").length;

  const withPromise = included.filter((f) => f.hasPromise);
  const judged = included.filter((f) => f.onTime != null);
  const onTimeJudged = judged.filter((f) => f.onTime === true);
  const promiseJudged = included.filter((f) => f.promiseKept != null);
  const promiseKeptTrue = promiseJudged.filter((f) => f.promiseKept === true);

  const byFulfilment = (method: FulfilmentMethod) => included.filter((f) => f.fulfilmentMethod === method);
  const onTimePercentFor = (method: FulfilmentMethod) => {
    const rows = byFulfilment(method).filter((f) => f.onTime != null);
    return percentOf(rows.filter((f) => f.onTime === true).length, rows.length);
  };

  const delayed = included.filter((f) => f.wasDelayed);
  const revisedJudged = delayed.filter((f) => f.revisedPromiseKept != null);

  const held = included.filter((f) => f.heldSeconds > 0);
  const unassigned = included.filter((f) => f.everUnassigned);

  return {
    ordersConsidered: included.length,
    ordersExcluded: excludedBackdated + excludedCarriedOver + excludedAssumedReady,
    excludedBackdated,
    excludedCarriedOver,
    excludedAssumedReady,
    withPromisePercent: percentOf(withPromise.length, included.length),
    onTimePercent: percentOf(onTimeJudged.length, judged.length),
    collectionOnTimePercent: onTimePercentFor("collection"),
    deliveryOnTimePercent: onTimePercentFor("delivery"),
    deliveryP90ReceivedToCompletedMinutes: p90(byFulfilment("delivery").map((f) => f.receivedToCompletedMinutes)),
    promiseKeptPercent: percentOf(promiseKeptTrue.length, promiseJudged.length),
    averageLatenessMinutes: average(judged.map((f) => f.latenessMinutes)),
    medians: durationStats(included, median),
    p90s: durationStats(included, p90),
    delayedCount: delayed.length,
    revisedPromiseAccuracyPercent: percentOf(revisedJudged.filter((f) => f.revisedPromiseKept === true).length, revisedJudged.length),
    customerWaitingIncidents: included.filter((f) => f.customerWaitingIncident).length,
    heldOrdersCount: held.length,
    averageHeldMinutes: held.length ? held.reduce((sum, f) => sum + f.heldSeconds / 60, 0) / held.length : null,
    unassignedOrdersCount: unassigned.length,
    averageUnassignedMinutes: average(included.map((f) => f.receivedToClaimedMinutes)),
    alertToAckMedianMinutes: null,
    alertToReadyMedianMinutes: null,
  };
}

// ------------------------------------------------------------------ grouping

export type TimingGroupKey = "fulfilment" | "assignee" | "completer" | "loader" | "station" | "channel" | "day" | "hourOfTradingDay";

function keyFor(fact: DerivedOrderTiming, groupBy: TimingGroupKey): string {
  switch (groupBy) {
    case "fulfilment":
      return fact.fulfilmentMethod;
    case "assignee":
      return fact.assignedUserId ?? "(unassigned)";
    case "completer":
      return fact.completedUserId ?? "(not yet completed)";
    case "loader":
      return fact.inputUserId ?? "(no loader recorded)";
    case "station":
      return fact.station ?? "(no station)";
    case "channel":
      return fact.channel;
    case "day":
      return fact.tradingDay;
    case "hourOfTradingDay":
      return String(fact.hourOfTradingDay).padStart(2, "0");
  }
}

/**
 * Buckets already-derived facts by one of the brief's groupings (brief,
 * "ARC-T2-005": "fulfilment, assignee / completer / loader, station, hour of
 * trading day, channel, day") and summarises each bucket with the same
 * `summarizeOrderTiming` the whole-report figure uses, so a group's numbers
 * are computed by the identical rule as the headline ones.
 */
export function groupOrderTiming(
  facts: DerivedOrderTiming[],
  groupBy: TimingGroupKey,
): Array<{ key: string; summary: OrderTimingSummary }> {
  const buckets = new Map<string, DerivedOrderTiming[]>();
  for (const fact of facts) {
    const key = keyFor(fact, groupBy);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(fact);
    else buckets.set(key, [fact]);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, groupFacts]) => ({ key, summary: summarizeOrderTiming(groupFacts) }));
}

// ----------------------------------------------------------------- red flags

/** Thresholds named verbatim in the brief's "Reporting" section. */
const COLLECTION_ON_TIME_FLOOR_PERCENT = 80;
const DELIVERY_P90_CEILING_MINUTES = 60;

/** The two named red flags (brief, "Reporting"), evaluated against the whole-report summary. */
export function orderTimingRedFlags(summary: OrderTimingSummary): string[] {
  const flags: string[] = [];
  if (summary.collectionOnTimePercent != null && summary.collectionOnTimePercent < COLLECTION_ON_TIME_FLOOR_PERCENT) {
    flags.push(`Collection on-time is ${summary.collectionOnTimePercent.toFixed(1)}% — below the 80% floor.`);
  }
  if (
    summary.deliveryP90ReceivedToCompletedMinutes != null &&
    summary.deliveryP90ReceivedToCompletedMinutes > DELIVERY_P90_CEILING_MINUTES
  ) {
    flags.push(
      `Delivery p90 received→completed is ${summary.deliveryP90ReceivedToCompletedMinutes.toFixed(0)} min — over the 60 min ceiling.`,
    );
  }
  return flags;
}

export type { DateKind, FulfilmentMethod, OpsTimingSettings };
