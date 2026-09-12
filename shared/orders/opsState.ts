/**
 * The Operations Centre's card-state rule.
 *
 * One function decides what colour, chip and clock a card gets, and it is
 * the ONLY place that decision is made: the board, the alert sweep and the
 * timing report all call `deriveCardState` so a card can never show "on
 * time" while an alert says "late". See docs/briefs/PHASE_N_OPERATIONS_CENTRE.md
 * "Order lifecycle & timing model" for the table this implements, and
 * "Colour resolution" for why "ready" is a second, lighter blue rather than
 * a literal dark blue (a dark-blue band measures 2.42:1 on the real card
 * surface and is invisible; see shared/ui/contrast.ts).
 *
 * Pure and synchronous: `now` and `settings` are always passed in, never
 * read from the clock or the network, so every row of the table below has an
 * exact, repeatable test (see opsState.spec.ts) and the same function runs
 * equally well in the browser, in a server-side report, and inside the
 * worker that sweeps for due-soon and late alerts.
 */

/** The ten states a card can be in. First match in this order wins. */
export const CARD_STATES = [
  "completed",
  "carried-over",
  "scheduled",
  "held",
  "customer-waiting",
  "late",
  "delayed",
  "ready",
  "due-soon",
  "on-time",
] as const;

export type CardState = (typeof CARD_STATES)[number];

export type FulfilmentMethod = "collection" | "delivery";

/** `dateKind` as stamped by shared/orders/orderDate.ts. */
export type DateKind = "live" | "backdated" | "preorder";

/**
 * The subset of a board order `deriveCardState` needs. Deliberately a
 * subset of the `BoardOrder` shape the board endpoint returns (see the API
 * section of the brief) rather than the whole row, so the function can be
 * called with a bare order fixture in a test and with the real payload in
 * the app without adapting either.
 */
export interface OpsOrderInput {
  status: string;
  fulfilmentMethod: FulfilmentMethod;
  dateKind: DateKind;
  /** ISO string or Date. The day the sale is FOR — see shared/orders/orderDate.ts. */
  createdAt: string | Date;
  /** When it was actually keyed in; null on historic rows (falls back to createdAt). */
  enteredAt: string | Date | null;
  etaGiven: string | Date | null;
  revisedEta: string | Date | null;
  delayFlag: boolean;
  heldAt: string | Date | null;
  readyAt: string | Date | null;
  customerArrivedAt: string | Date | null;
  outForDeliveryAt: string | Date | null;
  settledAt: string | Date | null;
  /**
   * The completion event's `meta.actualAt` when a driver reported a later
   * delivered time, else `settledAt`. Optional: callers that have not
   * resolved it yet may omit it and get the `settledAt` fallback for free.
   */
  handoverAt?: string | Date | null;
}

/** The org settings `deriveCardState` needs, all in minutes, plus the timezone for trading-day maths. */
export interface OpsTimingSettings {
  timezone: string;
  prepSlaMinutes: number;
  deliveryLeadMinutes: number;
  dueSoonLeadMinutes: number;
  lateGraceMinutes: number;
}

export interface DerivedCardState {
  state: CardState;
  /** `entered_at ?? created_at`, as a Date. */
  receivedAt: Date;
  /** `revised_eta ?? eta_given`, or null when nobody has promised a time. */
  dueAt: Date | null;
  /** Whether `dueAt` is a real promise or the org's SLA is standing in for one. */
  dueSource: "promise" | "sla";
  /** `dueAt`, or `receivedAt + prepSla/deliveryLead` when there is no promise. */
  dueEffective: Date;
  /** `handoverAt ?? settledAt`, as a Date, or null while still open. */
  handoverAt: Date | null;
  /** Delivery only: `outForDeliveryAt` is set and the order is not yet completed. */
  onTheRoad: boolean;
  /** The order is flagged urgent. A priority badge and sort key, never a colour (brief, "Colour resolution"). */
  urgent: boolean;
  /** A missed day's sale keyed in afterwards — carries its own badge, never treated as late. */
  backdated: boolean;
  /**
   * True while the card is in a state whose primary colour is `held` or
   * `ready` AND a secondary fact (past its due time, or the customer has
   * arrived) is also true — the brief's "chips when true" on top of the
   * primary band. Never changes `state` itself.
   */
  pastDueWhileHeldOrReady: boolean;
  customerHere: boolean;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Which trading day an instant falls on, as an ISO date, without importing
 * the whole tradingDay module's dependency surface into every caller — kept
 * tiny and local because this is the one comparison `deriveCardState` needs
 * (see shared/time/tradingDay.ts for the canonical, tested implementation
 * this mirrors exactly: 06:00 local is the cut).
 */
function tradingDayKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour"));
  const key = `${year}-${month}-${day}`;
  if (hour >= 6) return key;
  // Before 06:00 local, still yesterday's trading day.
  const asUtcMidnight = new Date(`${key}T00:00:00.000Z`);
  asUtcMidnight.setUTCDate(asUtcMidnight.getUTCDate() - 1);
  return asUtcMidnight.toISOString().slice(0, 10);
}

/**
 * Derive everything a card, an alert or a report needs from one order and
 * one instant. See CARD_STATES for the precedence and the brief's "Order
 * lifecycle & timing model" for the rule each row encodes.
 */
export function deriveCardState(
  order: OpsOrderInput,
  now: Date,
  settings: OpsTimingSettings,
): DerivedCardState {
  const receivedAt = toDate(order.enteredAt) ?? toDate(order.createdAt) ?? now;
  const dueAt = toDate(order.revisedEta) ?? toDate(order.etaGiven);
  const dueSource: "promise" | "sla" = dueAt ? "promise" : "sla";
  const leadMinutes = order.fulfilmentMethod === "delivery" ? settings.deliveryLeadMinutes : settings.prepSlaMinutes;
  const dueEffective = dueAt ?? addMinutes(receivedAt, leadMinutes);
  const handoverAt = toDate(order.handoverAt) ?? toDate(order.settledAt);
  const urgent = order.status === "urgent";
  const backdated = order.dateKind === "backdated";
  const onTheRoad = order.fulfilmentMethod === "delivery" && toDate(order.outForDeliveryAt) != null && order.status !== "completed";
  const customerHere = toDate(order.customerArrivedAt) != null && toDate(order.readyAt) == null && order.status !== "completed";
  const pastDue = now.getTime() > dueEffective.getTime() + settings.lateGraceMinutes * 60_000;

  let state: CardState;

  if (order.status === "completed") {
    state = "completed";
  } else if (tradingDayKey(receivedAt, settings.timezone) < tradingDayKey(now, settings.timezone)) {
    // Carried over from an earlier trading day — the 06:00 cut already passed
    // while this order was still open. Never late, never scheduled: it is
    // simply yesterday's, and gets its own strip (brief, "Carried-over").
    state = "carried-over";
  } else if (order.dateKind === "preorder" && tradingDayKey(toDate(order.createdAt) ?? now, settings.timezone) > tradingDayKey(now, settings.timezone)) {
    state = "scheduled";
  } else if (order.status === "on-hold") {
    state = "held";
  } else if (order.fulfilmentMethod === "collection" && toDate(order.customerArrivedAt) != null && toDate(order.readyAt) == null) {
    state = "customer-waiting";
  } else if (
    pastDue &&
    (order.fulfilmentMethod === "collection" ? toDate(order.readyAt) == null : true)
  ) {
    state = "late";
  } else if (order.delayFlag && toDate(order.revisedEta) != null && (toDate(order.revisedEta) as Date).getTime() > now.getTime()) {
    state = "delayed";
  } else if (toDate(order.readyAt) != null) {
    state = "ready";
  } else if (dueSource === "promise" && dueEffective.getTime() - now.getTime() <= settings.dueSoonLeadMinutes * 60_000) {
    state = "due-soon";
  } else {
    state = "on-time";
  }

  const pastDueWhileHeldOrReady =
    (state === "held" || state === "ready") &&
    now.getTime() > dueEffective.getTime() + settings.lateGraceMinutes * 60_000;

  return {
    state,
    receivedAt,
    dueAt,
    dueSource,
    dueEffective,
    handoverAt,
    onTheRoad,
    urgent,
    backdated,
    pastDueWhileHeldOrReady,
    customerHere: state === "ready" ? toDate(order.customerArrivedAt) != null : customerHere,
  };
}
