/**
 * Staff Performance (v1.2 Phase 7B, STF-01/STF-02) — the pure maths.
 *
 * Replaces the Staff KPI report, which counted cashier codes nobody has
 * carried since the lazy-shift change. Everything here is keyed by LOGIN (the
 * auth subject on `orders.input_user_id` / `completed_user_id` and on
 * `order_events.user_id`). No I/O and no clock: the server
 * (`server/services/staffPerformance.ts`) reads the rows and hands them in.
 *
 * **What counts.** Completed orders settled in the range, excluding personal
 * use — the same orders, valued the same way (the settlement snapshot), as
 * sales Evidence. So the team rows reconcile: every £ of a counted order
 * lands on exactly one of a person's row, Admin cover or Unattributed, and
 * `staff + adminCover + unattributed = total = gross settled sales`.
 *
 * **Each job counted separately** (owner, Q15). Loaded, Prepared, Completed
 * and Dispatched are four different counts. Taking over someone else's card
 * at handover adds one Completed and nothing else, so it gains nothing on the
 * jobs that person already did.
 *
 * **Value brought in** splits like commission (`orderCommission.ts`): the
 * whole value to the completer when they loaded it too or nobody loaded it
 * ("solo"), otherwise 90% to the completer and 10% to the loader. Split in
 * pennies with the loader's share rounded and the completer taking the rest,
 * so the parts always add back to the order.
 */
import { COMPLETER_SHARE_PERCENT, INPUTTER_SHARE_PERCENT } from "./orderCommission";

export const PERFORMANCE_PROVISIONAL_DAYS = 14;
/** Roles that are "Admin cover": counted in the totals, never listed or ranked (Q15). */
export const ADMIN_COVER_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
/** Roles listed as a row of their own. */
export const PERFORMANCE_ROW_ROLES = ["CASHIER", "MANAGER"] as const;

export interface PerformanceOrder {
  id: string;
  /** The settlement snapshot: `coalesce(settled_total, total)`. */
  value: number;
  fulfilment: "collection" | "delivery";
  channel: string;
  loaderId: string | null;
  completerId: string | null;
  /** Who marked it ready last (the `ready` event). Null for an instant counter sale. */
  preparerId: string | null;
  /** Who sent it out (the `out_for_delivery` event). Delivery only. */
  dispatcherId: string | null;
  assigneeId: string | null;
  items: number;
  lines: number;
  /** A `wrong_item` refund exists against this order. */
  wrongItem: boolean;
}

/** Things a person did in the range that are not "a counted order". */
export interface PerformanceActivity {
  /** Their completions that someone reopened in the range. */
  reopens: number;
  unreadyTaps: number;
  deletes: number;
  refundsProcessed: number;
  refundsValue: number;
  /** Orders they loaded in the range that are still not completed. */
  stillOpen: number;
}

export interface PerformanceFigures extends PerformanceActivity {
  loaded: number;
  prepared: number;
  completed: number;
  collected: number;
  delivered: number;
  dispatched: number;
  solo: number;
  salesCompleted: number;
  valueBroughtIn: number;
  averageOrderValue: number | null;
  itemsPerOrder: number | null;
  linesPerOrder: number | null;
  /** Orders this person picked (prepared, or completed with nobody preparing) — the wrong-item denominator. */
  picked: number;
  wrongItemOrders: number;
  wrongItemRatePercent: number | null;
  completedOthers: number;
}

export interface PerformancePerson {
  name: string;
  role: string;
}

export interface PerformanceRow extends PerformanceFigures {
  userId: string;
  name: string;
  role: string;
}

export interface PerformanceResult {
  rows: PerformanceRow[];
  adminCover: PerformanceFigures;
  unattributed: PerformanceFigures;
  total: PerformanceFigures;
  /** Sum of `value` over every counted order — what `total.salesCompleted` must equal. */
  grossSettledSales: number;
  /**
   * Admin cover + Unattributed + the people the viewer may see (Q14). Equals
   * `total` when nobody is hidden. A viewer who cannot see everyone gets this
   * as their Total: the whole-team figure minus the listed rows would
   * otherwise be exactly the hidden people's figures.
   */
  visibleTotal: PerformanceFigures;
  /** Person rows the viewer may not see (left out of `visibleTotal`). */
  hiddenPeople: number;
}

export type PerformanceBucket = { kind: "person"; userId: string } | { kind: "admin" } | { kind: "unattributed" };

function emptyActivity(): PerformanceActivity {
  return { reopens: 0, unreadyTaps: 0, deletes: 0, refundsProcessed: 0, refundsValue: 0, stillOpen: 0 };
}

/** Raw counters; the ratios are filled in by {@link finish}. */
interface Acc extends PerformanceActivity {
  loaded: number;
  prepared: number;
  completed: number;
  collected: number;
  delivered: number;
  dispatched: number;
  solo: number;
  salesPence: number;
  valuePence: number;
  items: number;
  lines: number;
  picked: number;
  wrongItemOrders: number;
  completedOthers: number;
}

function emptyAcc(): Acc {
  return {
    ...emptyActivity(),
    loaded: 0,
    prepared: 0,
    completed: 0,
    collected: 0,
    delivered: 0,
    dispatched: 0,
    solo: 0,
    salesPence: 0,
    valuePence: 0,
    items: 0,
    lines: 0,
    picked: 0,
    wrongItemOrders: 0,
    completedOthers: 0,
  };
}

function addAcc(into: Acc, from: Acc): void {
  for (const key of Object.keys(into) as (keyof Acc)[]) into[key] += from[key];
}

const toPence = (pounds: number) => Math.round(pounds * 100);
const fromPence = (pence: number) => pence / 100;
const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

function finish(acc: Acc): PerformanceFigures {
  return {
    loaded: acc.loaded,
    prepared: acc.prepared,
    completed: acc.completed,
    collected: acc.collected,
    delivered: acc.delivered,
    dispatched: acc.dispatched,
    solo: acc.solo,
    stillOpen: acc.stillOpen,
    salesCompleted: fromPence(acc.salesPence),
    valueBroughtIn: fromPence(acc.valuePence),
    averageOrderValue: acc.completed > 0 ? fromPence(Math.round(acc.salesPence / acc.completed)) : null,
    itemsPerOrder: ratio(acc.items, acc.completed),
    linesPerOrder: ratio(acc.lines, acc.completed),
    picked: acc.picked,
    wrongItemOrders: acc.wrongItemOrders,
    wrongItemRatePercent: acc.picked > 0 ? (acc.wrongItemOrders / acc.picked) * 100 : null,
    reopens: acc.reopens,
    unreadyTaps: acc.unreadyTaps,
    refundsProcessed: acc.refundsProcessed,
    refundsValue: Math.round(acc.refundsValue * 100) / 100,
    deletes: acc.deletes,
    completedOthers: acc.completedOthers,
  };
}

/**
 * Splits one order's value between completer and loader, in pence. Solo (the
 * same person, or nobody loaded it) keeps 100%; otherwise the loader takes
 * 10% rounded and the completer the remainder, so the two always sum to the
 * whole.
 */
export function splitValueBroughtIn(
  valuePence: number,
  completerId: string | null,
  loaderId: string | null,
): { completerPence: number; loaderPence: number; solo: boolean } {
  const solo = !loaderId || loaderId === completerId;
  if (solo || !completerId) return { completerPence: valuePence, loaderPence: 0, solo };
  const loaderPence = Math.round((valuePence * INPUTTER_SHARE_PERCENT) / (COMPLETER_SHARE_PERCENT + INPUTTER_SHARE_PERCENT));
  return { completerPence: valuePence - loaderPence, loaderPence, solo };
}

/**
 * Builds every row. `people` is the org's logins by user id; anyone not in it
 * (a deleted account, a system actor) and every "nobody" lands on
 * Unattributed, and ADMIN / SUPER_ADMIN land on Admin cover, so the three
 * team rows plus the person rows always cover every counted £.
 */
export function computeStaffPerformance(
  orders: readonly PerformanceOrder[],
  people: ReadonlyMap<string, PerformancePerson>,
  activity: ReadonlyMap<string, Partial<PerformanceActivity>> = new Map(),
  /** Who the viewer may see; everyone when omitted. */
  isVisible: (userId: string, person: PerformancePerson) => boolean = () => true,
): PerformanceResult {
  const byPerson = new Map<string, Acc>();
  const admin = emptyAcc();
  const unattributed = emptyAcc();

  const bucketOf = (userId: string | null): Acc => {
    if (!userId) return unattributed;
    const person = people.get(userId);
    if (!person) return unattributed;
    if ((ADMIN_COVER_ROLES as readonly string[]).includes(person.role)) return admin;
    let acc = byPerson.get(userId);
    if (!acc) {
      acc = emptyAcc();
      byPerson.set(userId, acc);
    }
    return acc;
  };

  let grossPence = 0;
  for (const o of orders) {
    const valuePence = toPence(o.value);
    grossPence += valuePence;

    // Jobs. A job nobody did (a web order has no loader, a counter sale no
    // preparer) is simply not counted: there is no one to credit.
    if (o.loaderId) bucketOf(o.loaderId).loaded += 1;
    if (o.preparerId) bucketOf(o.preparerId).prepared += 1;
    if (o.fulfilment === "delivery" && o.dispatcherId) bucketOf(o.dispatcherId).dispatched += 1;

    // Completion always lands somewhere — Unattributed when nobody is named —
    // because the money has to.
    const completer = bucketOf(o.completerId);
    completer.completed += 1;
    if (o.fulfilment === "delivery") completer.delivered += 1;
    else completer.collected += 1;
    completer.salesPence += valuePence;
    completer.items += o.items;
    completer.lines += o.lines;
    if (o.completerId && o.assigneeId && o.assigneeId !== o.completerId) completer.completedOthers += 1;

    const split = splitValueBroughtIn(valuePence, o.completerId, o.loaderId);
    completer.valuePence += split.completerPence;
    if (split.loaderPence) bucketOf(o.loaderId).valuePence += split.loaderPence;
    if (split.solo && o.completerId) completer.solo += 1;

    // Whoever picked the goods answers for a wrong item: the preparer, or the
    // completer on a sale nobody prepared separately.
    const picker = bucketOf(o.preparerId ?? o.completerId);
    picker.picked += 1;
    if (o.wrongItem) picker.wrongItemOrders += 1;
  }

  for (const [userId, act] of activity) {
    const acc = bucketOf(userId);
    acc.reopens += act.reopens ?? 0;
    acc.unreadyTaps += act.unreadyTaps ?? 0;
    acc.deletes += act.deletes ?? 0;
    acc.refundsProcessed += act.refundsProcessed ?? 0;
    acc.refundsValue += act.refundsValue ?? 0;
    acc.stillOpen += act.stillOpen ?? 0;
  }

  const total = emptyAcc();
  addAcc(total, admin);
  addAcc(total, unattributed);
  const visibleTotal = emptyAcc();
  addAcc(visibleTotal, admin);
  addAcc(visibleTotal, unattributed);
  let hiddenPeople = 0;
  const rows: PerformanceRow[] = [];
  for (const [userId, acc] of byPerson) {
    addAcc(total, acc);
    const person = people.get(userId)!;
    if (isVisible(userId, person)) addAcc(visibleTotal, acc);
    else hiddenPeople += 1;
    rows.push({ userId, name: person.name, role: person.role, ...finish(acc) });
  }
  rows.sort((a, b) => b.valueBroughtIn - a.valueBroughtIn || a.name.localeCompare(b.name));

  return {
    rows,
    adminCover: finish(admin),
    unattributed: finish(unattributed),
    total: finish(total),
    grossSettledSales: fromPence(grossPence),
    visibleTotal: finish(visibleTotal),
    hiddenPeople,
  };
}

/** Change against the previous period, as a percentage. Null when there was nothing to compare with. */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Whether per-person figures are still provisional (owner: the team figures
 * are checked for two weeks first). `since` is when the org started
 * recording them (`organizations.staff_performance_since`).
 */
export function isPerformanceProvisional(since: Date, now: Date): boolean {
  return now.getTime() < since.getTime() + PERFORMANCE_PROVISIONAL_DAYS * 86_400_000;
}

export function provisionalUntil(since: Date): Date {
  return new Date(since.getTime() + PERFORMANCE_PROVISIONAL_DAYS * 86_400_000);
}

// ------------------------------------------------------------ range presets

export const PERFORMANCE_PRESETS = ["today", "yesterday", "this-week", "last-week", "last-4-weeks", "this-month", "last-month"] as const;
export type PerformancePreset = (typeof PERFORMANCE_PRESETS)[number];

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days between two ISO dates, inclusive. */
export function daysInclusive(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * A preset's trading days, given today's trading day. Weeks run Monday to
 * Sunday, the same week the Monday close and the Weekly Sales Evidence use.
 */
export function presetRange(preset: PerformancePreset, today: string): { from: string; to: string } {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = shiftDays(today, -dow);
  const firstOfMonth = `${today.slice(0, 8)}01`;
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: shiftDays(today, -1), to: shiftDays(today, -1) };
    case "this-week":
      return { from: monday, to: today };
    case "last-week":
      return { from: shiftDays(monday, -7), to: shiftDays(monday, -1) };
    case "last-4-weeks":
      return { from: shiftDays(monday, -28), to: shiftDays(monday, -1) };
    case "this-month":
      return { from: firstOfMonth, to: today };
    case "last-month": {
      const lastOfPrev = shiftDays(firstOfMonth, -1);
      return { from: `${lastOfPrev.slice(0, 8)}01`, to: lastOfPrev };
    }
  }
}

/** The period of the same length immediately before `[from, to]`. */
export function previousPeriod(fromIso: string, toIso: string): { from: string; to: string } {
  const days = daysInclusive(fromIso, toIso);
  return { from: shiftDays(fromIso, -days), to: shiftDays(fromIso, -1) };
}
