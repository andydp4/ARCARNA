/**
 * Staff Performance, Speed (v1.2 Phase 7C, STF-04/STF-05) — the pure maths.
 *
 * Built on the tested timing engine (`orderTiming.ts`): each order is first
 * judged by `deriveOrderTiming`, exactly as the board and the Order Timing
 * page judge it, and only then credited to a person. Who is credited follows
 * who could have changed the outcome:
 *
 * - **Collection on time** goes to the preparer (who marked it ready): a
 *   collection's clock stops at ready.
 * - **Delivery on time** goes to the dispatcher (who sent it out): a
 *   delivery's clock runs to handover.
 * - **First promise kept** is judged against the FIRST time promised
 *   (`original_eta`, else `eta_given`), so declaring a delay cannot move the
 *   goalposts. Credited the same way.
 * - **Stage times** (median and the slowest 10%): received → ready to the
 *   preparer, ready → handover to the completer, out → delivered to the
 *   dispatcher. **Instant counter sales** (a collection completed with nobody
 *   marking it ready) are counted but left out of every median: there was no
 *   stage to time, and a stream of zero-minute sales would flatter anyone who
 *   works the till.
 * - **Customer waiting**: the customer arrived before the order was ready,
 *   charged to whoever prepared it (or was dealing with it).
 * - **Promise length** against target goes to whoever took the order and
 *   gave the promise: how long they promised compared with the prep or
 *   delivery lead in the settings.
 * - **Delays told in advance**: of the delays a person declared, how many had
 *   the customer told before the first promised time passed.
 * - **Alert to acknowledge**: the median minutes from a personal alert to the
 *   person acknowledging it.
 *
 * Orders the engine excludes (backdated, carried over, assumed ready) are
 * left out of every figure here too.
 */
import type { DerivedOrderTiming, OpsTimingSettings } from "./orderTiming";

export interface SpeedOrder {
  fact: DerivedOrderTiming;
  loaderId: string | null;
  preparerId: string | null;
  dispatcherId: string | null;
  assigneeId: string | null;
  completerId: string | null;
  receivedAt: Date;
  readyAt: Date | null;
  handoverAt: Date | null;
  /** `original_eta ?? eta_given`: the first promise made. */
  firstPromiseAt: Date | null;
  /** Delays declared on this order, in order. */
  delays: Array<{ userId: string | null; at: Date; customerTold: boolean }>;
  /** When the customer was last told of a delay (`delay_notification_sent_at`). */
  delayNotifiedAt: Date | null;
  /** Completed at the counter with nobody marking it ready. */
  instant: boolean;
}

export interface AlertAck {
  userId: string;
  minutes: number;
}

export interface StageStat {
  count: number;
  medianMinutes: number | null;
  /** The slowest 10%: the 90th percentile. */
  slowest10Minutes: number | null;
}

export interface SpeedFigures {
  collectionJudged: number;
  collectionOnTime: number;
  collectionOnTimePercent: number | null;
  deliveryJudged: number;
  deliveryOnTime: number;
  deliveryOnTimePercent: number | null;
  firstPromiseJudged: number;
  firstPromiseKept: number;
  firstPromiseKeptPercent: number | null;
  receivedToReady: StageStat;
  readyToHandover: StageStat;
  dispatchToDelivered: StageStat;
  customerWaitingIncidents: number;
  promisesGiven: number;
  promiseMedianMinutes: number | null;
  promisesWithinTarget: number;
  promiseWithinTargetPercent: number | null;
  delaysDeclared: number;
  delaysToldInAdvance: number;
  delaysToldInAdvancePercent: number | null;
  alertsAcknowledged: number;
  alertToAckMedianMinutes: number | null;
  instantCounterSales: number;
}

interface Acc {
  collectionJudged: number;
  collectionOnTime: number;
  deliveryJudged: number;
  deliveryOnTime: number;
  firstPromiseJudged: number;
  firstPromiseKept: number;
  receivedToReady: number[];
  readyToHandover: number[];
  dispatchToDelivered: number[];
  customerWaitingIncidents: number;
  promiseMinutes: number[];
  promisesWithinTarget: number;
  delaysDeclared: number;
  delaysToldInAdvance: number;
  alertMinutes: number[];
  instantCounterSales: number;
}

function emptyAcc(): Acc {
  return {
    collectionJudged: 0,
    collectionOnTime: 0,
    deliveryJudged: 0,
    deliveryOnTime: 0,
    firstPromiseJudged: 0,
    firstPromiseKept: 0,
    receivedToReady: [],
    readyToHandover: [],
    dispatchToDelivered: [],
    customerWaitingIncidents: 0,
    promiseMinutes: [],
    promisesWithinTarget: 0,
    delaysDeclared: 0,
    delaysToldInAdvance: 0,
    alertMinutes: [],
    instantCounterSales: 0,
  };
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

function stage(values: number[]): StageStat {
  return { count: values.length, medianMinutes: percentile(values, 50), slowest10Minutes: percentile(values, 90) };
}

function finish(a: Acc): SpeedFigures {
  return {
    collectionJudged: a.collectionJudged,
    collectionOnTime: a.collectionOnTime,
    collectionOnTimePercent: pct(a.collectionOnTime, a.collectionJudged),
    deliveryJudged: a.deliveryJudged,
    deliveryOnTime: a.deliveryOnTime,
    deliveryOnTimePercent: pct(a.deliveryOnTime, a.deliveryJudged),
    firstPromiseJudged: a.firstPromiseJudged,
    firstPromiseKept: a.firstPromiseKept,
    firstPromiseKeptPercent: pct(a.firstPromiseKept, a.firstPromiseJudged),
    receivedToReady: stage(a.receivedToReady),
    readyToHandover: stage(a.readyToHandover),
    dispatchToDelivered: stage(a.dispatchToDelivered),
    customerWaitingIncidents: a.customerWaitingIncidents,
    promisesGiven: a.promiseMinutes.length,
    promiseMedianMinutes: percentile(a.promiseMinutes, 50),
    promisesWithinTarget: a.promisesWithinTarget,
    promiseWithinTargetPercent: pct(a.promisesWithinTarget, a.promiseMinutes.length),
    delaysDeclared: a.delaysDeclared,
    delaysToldInAdvance: a.delaysToldInAdvance,
    delaysToldInAdvancePercent: pct(a.delaysToldInAdvance, a.delaysDeclared),
    alertsAcknowledged: a.alertMinutes.length,
    alertToAckMedianMinutes: percentile(a.alertMinutes, 50),
    instantCounterSales: a.instantCounterSales,
  };
}

export function emptySpeed(): SpeedFigures {
  return finish(emptyAcc());
}

/**
 * Speed per person. Keys are user ids; `null` collects what nobody is named
 * on, so a team total can be built from the same orders.
 */
export function computeSpeed(
  orders: readonly SpeedOrder[],
  settings: Pick<OpsTimingSettings, "prepSlaMinutes" | "deliveryLeadMinutes">,
  alerts: readonly AlertAck[] = [],
): Map<string | null, SpeedFigures> {
  const accs = new Map<string | null, Acc>();
  const acc = (userId: string | null): Acc => {
    let a = accs.get(userId);
    if (!a) {
      a = emptyAcc();
      accs.set(userId, a);
    }
    return a;
  };

  for (const o of orders) {
    const f = o.fact;
    if (o.instant) {
      acc(o.completerId).instantCounterSales += 1;
    }
    if (f.excluded !== false) continue;

    const isCollection = f.fulfilmentMethod === "collection";
    const judgedBy = isCollection ? o.preparerId : o.dispatcherId;
    if (f.onTime != null && judgedBy) {
      const a = acc(judgedBy);
      if (isCollection) {
        a.collectionJudged += 1;
        if (f.onTime) a.collectionOnTime += 1;
      } else {
        a.deliveryJudged += 1;
        if (f.onTime) a.deliveryOnTime += 1;
      }
    }

    // First promise: the collection clock stops at ready, delivery's at handover.
    const judgementAt = isCollection ? o.readyAt : o.handoverAt;
    if (judgedBy && o.firstPromiseAt && judgementAt) {
      const a = acc(judgedBy);
      a.firstPromiseJudged += 1;
      if (judgementAt.getTime() <= o.firstPromiseAt.getTime()) a.firstPromiseKept += 1;
    }

    if (!o.instant) {
      if (f.receivedToReadyMinutes != null && o.preparerId) acc(o.preparerId).receivedToReady.push(f.receivedToReadyMinutes);
      if (f.readyToHandoverMinutes != null && o.completerId) acc(o.completerId).readyToHandover.push(f.readyToHandoverMinutes);
      if (f.dispatchToDeliveredMinutes != null && o.dispatcherId) acc(o.dispatcherId).dispatchToDelivered.push(f.dispatchToDeliveredMinutes);
    }

    if (f.customerWaitingIncident) acc(o.preparerId ?? o.assigneeId ?? o.completerId).customerWaitingIncidents += 1;

    if (!o.instant && o.firstPromiseAt && o.loaderId) {
      const minutes = minutesBetween(o.receivedAt, o.firstPromiseAt);
      if (minutes > 0) {
        const a = acc(o.loaderId);
        a.promiseMinutes.push(minutes);
        const target = isCollection ? settings.prepSlaMinutes : settings.deliveryLeadMinutes;
        if (minutes <= target) a.promisesWithinTarget += 1;
      }
    }

    for (const d of o.delays) {
      if (!d.userId) continue;
      const a = acc(d.userId);
      a.delaysDeclared += 1;
      // Told in advance: the customer heard before the first promise passed.
      const deadline = o.firstPromiseAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const toldAt = d.customerTold ? d.at : o.delayNotifiedAt;
      if (toldAt && toldAt.getTime() <= deadline) a.delaysToldInAdvance += 1;
    }
  }

  for (const al of alerts) {
    if (al.minutes >= 0) acc(al.userId).alertMinutes.push(al.minutes);
  }

  const out = new Map<string | null, SpeedFigures>();
  for (const [userId, a] of accs) out.set(userId, finish(a));
  return out;
}

/** The team's speed: every order credited to one bucket, so it is the same maths over everything. */
export function teamSpeed(
  orders: readonly SpeedOrder[],
  settings: Pick<OpsTimingSettings, "prepSlaMinutes" | "deliveryLeadMinutes">,
  alerts: readonly AlertAck[] = [],
): SpeedFigures {
  const TEAM = "__team__";
  const all = orders.map((o) => ({
    ...o,
    loaderId: o.loaderId ? TEAM : null,
    preparerId: o.preparerId ? TEAM : null,
    dispatcherId: o.dispatcherId ? TEAM : null,
    assigneeId: TEAM,
    completerId: TEAM,
    delays: o.delays.map((d) => ({ ...d, userId: d.userId ? TEAM : null })),
  }));
  return computeSpeed(all, settings, alerts.map((a) => ({ ...a, userId: TEAM }))).get(TEAM) ?? emptySpeed();
}
