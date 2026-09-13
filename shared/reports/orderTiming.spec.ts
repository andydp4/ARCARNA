/**
 * Order Timing & Service Levels (ARC-T2-005) — pure maths.
 *
 * One test group per figure the brief names in "Reporting", plus the explicit
 * DoD items: a BST/GMT boundary case, and assumed-ready / carried-over rows
 * excluded. See shared/reports/orderTiming.ts's module doc for why
 * re-settlement needs no dedupe step in THIS module (it is a one-row-per-order
 * contract) — the dedupe itself is proven against a real database in
 * server/__tests__/orderTimingReport.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  deriveOrderTiming,
  groupOrderTiming,
  orderTimingRedFlags,
  summarizeOrderTiming,
  type DerivedOrderTiming,
  type TimingOrderInput,
} from "./orderTiming";
import type { OpsTimingSettings } from "../orders/opsState";

const LONDON = "Europe/London";
const NOW = new Date("2026-01-12T14:00:00.000Z"); // 14:00 UTC = 14:00 London (GMT, no DST in January)

const SETTINGS: OpsTimingSettings = {
  timezone: LONDON,
  prepSlaMinutes: 20,
  deliveryLeadMinutes: 45,
  dueSoonLeadMinutes: 10,
  lateGraceMinutes: 5,
};

function minutesAgo(mins: number, from: Date = NOW): string {
  return new Date(from.getTime() - mins * 60_000).toISOString();
}

/** A completed collection order with a kept promise, otherwise unremarkable. */
function baseOrder(overrides: Partial<TimingOrderInput> = {}): TimingOrderInput {
  return {
    id: "order-1",
    status: "completed",
    fulfilmentMethod: "collection",
    dateKind: "live",
    channel: "pos",
    createdAt: minutesAgo(30),
    enteredAt: minutesAgo(30),
    etaGiven: minutesAgo(5), // due 5 min ago
    revisedEta: null,
    delayFlag: false,
    heldAt: null,
    readyAt: minutesAgo(10), // ready before the promise — on time
    customerArrivedAt: null,
    outForDeliveryAt: null,
    settledAt: minutesAgo(2),
    handoverAt: undefined,
    claimedAt: minutesAgo(28),
    wasDelayed: false,
    revisedPromiseAtDelay: null,
    heldSeconds: 0,
    assignedUserId: "sam",
    completedUserId: "sam",
    inputUserId: "ana",
    station: "collection",
    readyAssumed: false,
    ...overrides,
  };
}

function derive(overrides: Partial<TimingOrderInput> = {}): DerivedOrderTiming {
  return deriveOrderTiming(baseOrder(overrides), SETTINGS);
}

describe("on-time — collection stops at ready, delivery runs to handover", () => {
  it("a collection order is on time when ready_at beats the promise, even if handed over later", () => {
    const fact = derive({
      etaGiven: minutesAgo(5),
      readyAt: minutesAgo(6), // ready before the 5-min-ago promise
      settledAt: minutesAgo(1), // handed over after the promise — irrelevant for collection
    });
    expect(fact.onTime).toBe(true);
  });

  it("a collection order is late when ready_at itself misses the promise", () => {
    const fact = derive({ etaGiven: minutesAgo(10), readyAt: minutesAgo(5) });
    expect(fact.onTime).toBe(false);
  });

  it("a collection order not yet ready is not judged (null), not counted late", () => {
    const fact = derive({ status: "pending", readyAt: null, settledAt: null });
    expect(fact.onTime).toBeNull();
  });

  it("a delivery order is judged at handover, not at ready", () => {
    const lateAtReadyButOnTimeAtHandover = derive({
      fulfilmentMethod: "delivery",
      etaGiven: minutesAgo(1),
      readyAt: minutesAgo(2), // "late" if judged here
      settledAt: minutesAgo(5), // but handed over well before the promise
    });
    expect(lateAtReadyButOnTimeAtHandover.onTime).toBe(true);
  });

  it("a delivery order still on the road is not judged", () => {
    const fact = derive({ fulfilmentMethod: "delivery", status: "pending", outForDeliveryAt: minutesAgo(5), settledAt: null });
    expect(fact.onTime).toBeNull();
  });
});

describe("promise-kept vs on-time", () => {
  it("is null when there was never a real promise (SLA fallback only)", () => {
    const fact = derive({ etaGiven: null, readyAt: minutesAgo(1) });
    expect(fact.hasPromise).toBe(false);
    expect(fact.promiseKept).toBeNull();
    // on-time can still be judged against the SLA-derived dueEffective.
    expect(fact.onTime).not.toBeNull();
  });

  it("agrees exactly with on-time once a real promise exists — dueEffective IS the promise, never the SLA, the moment one is given", () => {
    // Same due comparison, positive and negative, proving promiseKept is not
    // a second, independently-drifting calculation from onTime.
    const kept = derive({ etaGiven: minutesAgo(5), readyAt: minutesAgo(6) });
    const missed = derive({ etaGiven: minutesAgo(10), readyAt: minutesAgo(5) });
    expect(kept.promiseKept).toBe(kept.onTime);
    expect(missed.promiseKept).toBe(missed.onTime);
  });
});

describe("average lateness — signed minutes against dueEffective", () => {
  it("is negative (early) for an order that beat its promise", () => {
    const fact = derive({ etaGiven: minutesAgo(0), readyAt: minutesAgo(10) });
    expect(fact.latenessMinutes).toBeLessThan(0);
  });

  it("is positive (late) for an order that missed its promise", () => {
    const fact = derive({ etaGiven: minutesAgo(20), readyAt: minutesAgo(5) });
    expect(fact.latenessMinutes).toBeGreaterThan(0);
  });

  it("averages across a batch, early and late cancelling appropriately", () => {
    const early = derive({ id: "a", etaGiven: minutesAgo(0), readyAt: minutesAgo(10) }); // -10
    const late = derive({ id: "b", etaGiven: minutesAgo(20), readyAt: minutesAgo(10) }); // +10
    const summary = summarizeOrderTiming([early, late]);
    expect(summary.averageLatenessMinutes).toBeCloseTo(0, 5);
  });
});

describe("durations — median and p90", () => {
  it("computes the median and p90 of received→completed across a batch", () => {
    // Five orders, received→completed = 10, 20, 30, 40, 50 minutes.
    const facts = [10, 20, 30, 40, 50].map((mins, i) =>
      derive({
        id: `order-${i}`,
        enteredAt: minutesAgo(mins),
        createdAt: minutesAgo(mins),
        readyAt: minutesAgo(mins - 1 > 0 ? mins - 1 : 0),
        settledAt: minutesAgo(0),
      }),
    );
    const summary = summarizeOrderTiming(facts);
    expect(summary.medians.receivedToCompletedMinutes).toBeCloseTo(30, 5);
    expect(summary.p90s.receivedToCompletedMinutes).toBeCloseTo(50, 5);
  });

  it("leaves a duration null when its milestones were never both reached", () => {
    const fact = derive({ fulfilmentMethod: "collection", outForDeliveryAt: null });
    expect(fact.dispatchToDeliveredMinutes).toBeNull();
  });
});

describe("delayed count and revised-promise accuracy", () => {
  it("counts an order as delayed only when it was ever flagged, regardless of current delayFlag", () => {
    const fact = derive({ wasDelayed: true, delayFlag: false });
    expect(fact.wasDelayed).toBe(true);
  });

  it("revisedPromiseKept is true when handover beat the revised promise", () => {
    const revisedAt = minutesAgo(3);
    const fact = derive({ wasDelayed: true, revisedPromiseAtDelay: revisedAt, readyAt: minutesAgo(5) });
    expect(fact.revisedPromiseKept).toBe(true);
  });

  it("revisedPromiseKept is false when handover missed the revised promise", () => {
    const revisedAt = minutesAgo(10);
    const fact = derive({ wasDelayed: true, revisedPromiseAtDelay: revisedAt, readyAt: minutesAgo(2) });
    expect(fact.revisedPromiseKept).toBe(false);
  });

  it("is null for an order that was never delayed", () => {
    const fact = derive({ wasDelayed: false, revisedPromiseAtDelay: null });
    expect(fact.revisedPromiseKept).toBeNull();
  });

  it("accuracy percent is computed only over delayed orders with a judged revised promise", () => {
    const kept = derive({ id: "kept", wasDelayed: true, revisedPromiseAtDelay: minutesAgo(3), readyAt: minutesAgo(5) });
    const missed = derive({ id: "missed", wasDelayed: true, revisedPromiseAtDelay: minutesAgo(10), readyAt: minutesAgo(2) });
    const neverDelayed = derive({ id: "never", wasDelayed: false });
    const summary = summarizeOrderTiming([kept, missed, neverDelayed]);
    expect(summary.delayedCount).toBe(2);
    expect(summary.revisedPromiseAccuracyPercent).toBeCloseTo(50, 5);
  });
});

describe("customer-waiting incidents", () => {
  it("is an incident when the customer arrived before the order was ready", () => {
    const fact = derive({
      fulfilmentMethod: "collection",
      customerArrivedAt: minutesAgo(5),
      readyAt: minutesAgo(1),
    });
    expect(fact.customerWaitingIncident).toBe(true);
  });

  it("is not an incident when the order was already ready before the customer arrived", () => {
    const fact = derive({
      fulfilmentMethod: "collection",
      readyAt: minutesAgo(10),
      customerArrivedAt: minutesAgo(1),
    });
    expect(fact.customerWaitingIncident).toBe(false);
  });

  it("does not apply to delivery orders", () => {
    const fact = derive({ fulfilmentMethod: "delivery", customerArrivedAt: minutesAgo(1), readyAt: null });
    expect(fact.customerWaitingIncident).toBe(false);
  });
});

describe("held time and unassigned time", () => {
  it("counts an order as held only when it accrued held seconds", () => {
    const held = derive({ id: "held", heldSeconds: 600 });
    const neverHeld = derive({ id: "clean", heldSeconds: 0 });
    const summary = summarizeOrderTiming([held, neverHeld]);
    expect(summary.heldOrdersCount).toBe(1);
    expect(summary.averageHeldMinutes).toBeCloseTo(10, 5);
  });

  it("counts an order as ever-unassigned when it was never claimed", () => {
    const fact = derive({ claimedAt: null });
    expect(fact.everUnassigned).toBe(true);
    expect(fact.receivedToClaimedMinutes).toBeNull();
  });
});

describe("exclusions (brief, 'Reporting': backdated, carried-over completions, assumed-ready)", () => {
  it("excludes a backdated order from every figure", () => {
    const fact = derive({ dateKind: "backdated", etaGiven: minutesAgo(50), readyAt: minutesAgo(0) });
    expect(fact.excluded).toBe("backdated");
    expect(fact.onTime).toBeNull();
    expect(fact.latenessMinutes).toBeNull();

    const summary = summarizeOrderTiming([fact]);
    expect(summary.ordersConsidered).toBe(0);
    expect(summary.excludedBackdated).toBe(1);
  });

  it("excludes a carried-over completion — received on an earlier trading day than it settled", () => {
    // Received 05:50 on the 11th (still the 10th's trading day), settled 07:00 on the 12th.
    const receivedAt = new Date("2026-01-11T05:50:00.000Z");
    const settledAt = new Date("2026-01-12T07:00:00.000Z");
    const fact = deriveOrderTiming(
      baseOrder({
        enteredAt: receivedAt.toISOString(),
        createdAt: receivedAt.toISOString(),
        readyAt: settledAt.toISOString(),
        settledAt: settledAt.toISOString(),
        etaGiven: null,
      }),
      SETTINGS,
    );
    expect(fact.excluded).toBe("carried-over");

    const summary = summarizeOrderTiming([fact]);
    expect(summary.ordersConsidered).toBe(0);
    expect(summary.excludedCarriedOver).toBe(1);
  });

  it("does NOT treat a same-day order as carried-over merely for taking a while", () => {
    // Received and settled both on the 12th, just hours apart.
    const fact = derive({
      enteredAt: "2026-01-12T07:00:00.000Z",
      createdAt: "2026-01-12T07:00:00.000Z",
      readyAt: "2026-01-12T10:00:00.000Z",
      settledAt: "2026-01-12T10:05:00.000Z",
      etaGiven: null,
    });
    expect(fact.excluded).toBe(false);
  });

  it("excludes a ready event stamped by migration 065's backfill (meta.assumed:true)", () => {
    const fact = derive({ readyAssumed: true });
    expect(fact.excluded).toBe("assumed-ready");
    expect(fact.receivedToReadyMinutes).toBeNull();

    const summary = summarizeOrderTiming([fact]);
    expect(summary.ordersConsidered).toBe(0);
    expect(summary.excludedAssumedReady).toBe(1);
  });

  it("an excluded order is still visible in the summary's exclusion counts, not silently dropped", () => {
    const backdated = derive({ id: "b", dateKind: "backdated" });
    const clean = derive({ id: "c" });
    const summary = summarizeOrderTiming([backdated, clean]);
    expect(summary.ordersConsidered + summary.ordersExcluded).toBe(2);
  });
});

describe("the BST/GMT boundary (brief DoD: 'figures match fixtures incl. a BST/GMT case')", () => {
  // 25 October 2026: London goes BST (UTC+1) → GMT (UTC+0) at 02:00 local —
  // the trading day of 2026-10-24 runs 05:00 UTC (24th) to 06:00 UTC (25th),
  // 25 hours long (see shared/time/tradingDay.spec.ts). An order received
  // before the clock change and made ready after it must still land in the
  // SAME trading day, and its duration must be exact plain-clock minutes —
  // proving neither the day bucket nor the minute maths is thrown off by the
  // one repeated local hour.
  const receivedAt = new Date("2026-10-25T00:30:00.000Z"); // 01:30 BST — before the 02:00 BST change
  const readyAt = new Date("2026-10-25T05:30:00.000Z"); // 05:30 GMT — after the change, still < 06:00 GMT

  it("buckets both ends of the span into the same trading day despite the clocks going back", () => {
    const fact = deriveOrderTiming(
      baseOrder({
        enteredAt: receivedAt.toISOString(),
        createdAt: receivedAt.toISOString(),
        readyAt: readyAt.toISOString(),
        settledAt: readyAt.toISOString(),
        etaGiven: null,
      }),
      SETTINGS,
    );
    expect(fact.tradingDay).toBe("2026-10-24");
    expect(fact.excluded).toBe(false); // NOT carried-over — same trading day both ends
  });

  it("computes the exact plain-clock duration across the fold-back, unaffected by the repeated hour", () => {
    const fact = deriveOrderTiming(
      baseOrder({
        enteredAt: receivedAt.toISOString(),
        createdAt: receivedAt.toISOString(),
        readyAt: readyAt.toISOString(),
        settledAt: readyAt.toISOString(),
        etaGiven: null,
      }),
      SETTINGS,
    );
    // 00:30Z to 05:30Z is exactly 300 minutes of real elapsed time, regardless
    // of how many times "01:xx local" was rendered that night.
    expect(fact.receivedToReadyMinutes).toBeCloseTo(300, 5);
  });

  it("still cuts at 06:00 LOCAL, not 06:00 UTC, either side of the transition", () => {
    // 05:59 GMT on the 25th is still the 24th's trading day.
    const stillYesterday = deriveOrderTiming(
      baseOrder({
        enteredAt: "2026-10-25T05:59:00.000Z",
        createdAt: "2026-10-25T05:59:00.000Z",
        readyAt: "2026-10-25T05:59:00.000Z",
        settledAt: "2026-10-25T05:59:00.000Z",
        etaGiven: null,
      }),
      SETTINGS,
    );
    expect(stillYesterday.tradingDay).toBe("2026-10-24");

    // 06:00 GMT on the 25th is the new trading day.
    const newDay = deriveOrderTiming(
      baseOrder({
        enteredAt: "2026-10-25T06:00:00.000Z",
        createdAt: "2026-10-25T06:00:00.000Z",
        readyAt: "2026-10-25T06:00:00.000Z",
        settledAt: "2026-10-25T06:00:00.000Z",
        etaGiven: null,
      }),
      SETTINGS,
    );
    expect(newDay.tradingDay).toBe("2026-10-25");
  });
});

describe("groupOrderTiming", () => {
  it("buckets by fulfilment and summarises each bucket independently", () => {
    const collection = derive({ id: "c1", fulfilmentMethod: "collection" });
    const delivery = derive({ id: "d1", fulfilmentMethod: "delivery", outForDeliveryAt: minutesAgo(8), settledAt: minutesAgo(1) });
    const groups = groupOrderTiming([collection, delivery], "fulfilment");
    expect(groups.map((g) => g.key).sort()).toEqual(["collection", "delivery"]);
    expect(groups.find((g) => g.key === "collection")!.summary.ordersConsidered).toBe(1);
    expect(groups.find((g) => g.key === "delivery")!.summary.ordersConsidered).toBe(1);
  });

  it("labels an unassigned order distinctly when grouping by assignee", () => {
    const fact = derive({ assignedUserId: null, claimedAt: null });
    const groups = groupOrderTiming([fact], "assignee");
    expect(groups[0].key).toBe("(unassigned)");
  });

  it("groups by trading day, honouring the same BST/GMT bucketing as the per-order derivation", () => {
    const a = derive({ id: "a", enteredAt: "2026-01-11T07:00:00.000Z", createdAt: "2026-01-11T07:00:00.000Z", readyAt: "2026-01-11T07:10:00.000Z", settledAt: "2026-01-11T07:10:00.000Z", etaGiven: null });
    const b = derive({ id: "b", enteredAt: "2026-01-12T07:00:00.000Z", createdAt: "2026-01-12T07:00:00.000Z", readyAt: "2026-01-12T07:10:00.000Z", settledAt: "2026-01-12T07:10:00.000Z", etaGiven: null });
    const groups = groupOrderTiming([a, b], "day");
    expect(groups.map((g) => g.key)).toEqual(["2026-01-11", "2026-01-12"]);
  });
});

describe("red flags (brief, 'Reporting')", () => {
  function summaryWith(overrides: Partial<ReturnType<typeof summarizeOrderTiming>>) {
    return { ...summarizeOrderTiming([]), ...overrides };
  }

  it("flags collection on-time below 80%", () => {
    const flags = orderTimingRedFlags(summaryWith({ collectionOnTimePercent: 79.9 }));
    expect(flags.some((f) => f.includes("Collection on-time"))).toBe(true);
  });

  it("does not flag collection on-time at exactly 80%", () => {
    const flags = orderTimingRedFlags(summaryWith({ collectionOnTimePercent: 80 }));
    expect(flags.some((f) => f.includes("Collection on-time"))).toBe(false);
  });

  it("flags delivery p90 over 60 minutes", () => {
    const flags = orderTimingRedFlags(summaryWith({ deliveryP90ReceivedToCompletedMinutes: 61 }));
    expect(flags.some((f) => f.includes("Delivery p90"))).toBe(true);
  });

  it("does not flag delivery p90 at exactly 60 minutes", () => {
    const flags = orderTimingRedFlags(summaryWith({ deliveryP90ReceivedToCompletedMinutes: 60 }));
    expect(flags.some((f) => f.includes("Delivery p90"))).toBe(false);
  });

  it("raises no flags when nothing has been measured yet", () => {
    expect(orderTimingRedFlags(summarizeOrderTiming([]))).toEqual([]);
  });
});

describe("re-settlement needs no dedupe here (module doc)", () => {
  it("one TimingOrderInput per order means one DerivedOrderTiming out, regardless of how many completions it has had", () => {
    // The caller (reportsEngine.ts) is responsible for assembling ONE row per
    // order from the CURRENT orders row — this module has no orderId-keyed
    // state at all, so there is nothing here that could double-count a
    // resettled order. Proven against real reopen/re-complete events in
    // server/__tests__/orderTimingReport.test.ts.
    const resettled = derive({ id: "resettled-order", completedUserId: "priya" });
    const summary = summarizeOrderTiming([resettled]);
    expect(summary.ordersConsidered).toBe(1);
  });
});
