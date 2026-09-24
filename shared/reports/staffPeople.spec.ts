import { describe, expect, it } from "vitest";
import { computeBenefit, netBenefitOf, orderMarginPence, sumBenefit } from "./staffBenefit";
import { computeSpeed, teamSpeed, type SpeedOrder } from "./staffSpeed";
import { activeHoursForShift, activeTime, fairnessRates, teamMedian } from "./staffFairness";
import { colourFor, evaluateKpis, isAmberOnly, kpisMetLabel, staffTargetsSchema, type KpiSource } from "./staffTargets";
import { computeBadges } from "./staffBadges";
import { decideFlag, flagSummary, topThreshold, LP_MIN_EVENTS } from "./lossPrevention";
import type { DerivedOrderTiming } from "./orderTiming";

const T = (hhmm: string) => new Date(`2026-01-12T${hhmm}:00.000Z`);

describe("Benefit (£)", () => {
  it("floors each order's margin at zero and leaves unknown-cost lines out", () => {
    expect(orderMarginPence([{ total: 10, quantity: 2, unitCost: 3 }]).marginPence).toBe(400);
    expect(orderMarginPence([{ total: 5, quantity: 1, unitCost: 8 }]).marginPence).toBe(0);
    expect(orderMarginPence([{ total: 5, quantity: 1, unitCost: null }])).toEqual({ marginPence: 0, costMissingLines: 1 });
  });

  it("splits margin and discount 100% solo or 90/10, and charges capture to whoever took the sale", () => {
    const out = computeBenefit(
      [
        { id: "a", loaderId: "amy", completerId: "amy", discount: 1, hasCustomer: true, lines: [{ total: 20, quantity: 1, unitCost: 10 }] },
        { id: "b", loaderId: "ben", completerId: "amy", discount: 2, hasCustomer: false, lines: [{ total: 50, quantity: 1, unitCost: 30 }] },
      ],
      new Map([["amy", { priceExceptionCost: 3, personalUseCost: 4 }]]),
    );
    const amy = out.get("amy")!;
    const ben = out.get("ben")!;
    expect(amy.marginContributed).toBe(10 + 18);
    expect(ben.marginContributed).toBe(2);
    expect(amy.discountGiven).toBe(1 + 1.8);
    expect(ben.discountGiven).toBe(0.2);
    expect(amy.ordersTaken).toBe(1);
    expect(amy.namedCustomerCapturePercent).toBe(100);
    expect(ben.namedCustomerCapturePercent).toBe(0);
    // Net benefit = margin − discount − exception cost − personal use. Never profit.
    expect(amy.netBenefit).toBe(28 - 2.8 - 3 - 4);
    expect(netBenefitOf({ marginContributed: 1, discountGiven: 0.1, priceExceptionCost: 0.2, personalUseCost: 0.3 })).toBe(0.4);
  });

  it("team benefit adds the people up and recomputes the percentage", () => {
    const out = computeBenefit([
      { id: "a", loaderId: "amy", completerId: "amy", discount: 0, hasCustomer: true, lines: [] },
      { id: "b", loaderId: "ben", completerId: "ben", discount: 0, hasCustomer: false, lines: [] },
    ]);
    expect(sumBenefit([...out.values()]).namedCustomerCapturePercent).toBe(50);
  });
});

function fact(over: Partial<DerivedOrderTiming>): DerivedOrderTiming {
  return {
    id: "o",
    fulfilmentMethod: "collection",
    channel: "pos",
    assignedUserId: null,
    completedUserId: null,
    inputUserId: null,
    station: null,
    tradingDay: "2026-01-12",
    hourOfTradingDay: 11,
    excluded: false,
    hasPromise: true,
    onTime: true,
    promiseKept: true,
    latenessMinutes: 0,
    receivedToClaimedMinutes: null,
    receivedToReadyMinutes: 10,
    readyToHandoverMinutes: 5,
    arrivedToHandoverMinutes: null,
    dispatchToDeliveredMinutes: null,
    receivedToCompletedMinutes: 15,
    wasDelayed: false,
    revisedPromiseKept: null,
    customerWaitingIncident: false,
    heldSeconds: 0,
    everUnassigned: false,
    ...over,
  };
}

function order(over: Partial<SpeedOrder>): SpeedOrder {
  return {
    fact: fact({}),
    loaderId: "lee",
    preparerId: "pat",
    dispatcherId: null,
    assigneeId: "pat",
    completerId: "cal",
    receivedAt: T("11:00"),
    readyAt: T("11:10"),
    handoverAt: T("11:15"),
    firstPromiseAt: T("11:20"),
    delays: [],
    delayNotifiedAt: null,
    instant: false,
    ...over,
  };
}

describe("Speed", () => {
  const settings = { prepSlaMinutes: 20, deliveryLeadMinutes: 45 };

  it("credits collection on time to the preparer and delivery on time to the dispatcher", () => {
    const out = computeSpeed(
      [
        order({}),
        order({ fact: fact({ fulfilmentMethod: "delivery", onTime: false }), dispatcherId: "dan", preparerId: "pat" }),
      ],
      settings,
    );
    expect(out.get("pat")!.collectionOnTimePercent).toBe(100);
    expect(out.get("pat")!.deliveryJudged).toBe(0);
    expect(out.get("dan")!.deliveryOnTimePercent).toBe(0);
  });

  it("judges the first promise against the FIRST eta, so a delay cannot move the goalposts", () => {
    // Revised to 12:00 (on time against it), but ready at 11:30 after a first promise of 11:20.
    const out = computeSpeed([order({ fact: fact({ onTime: true }), readyAt: T("11:30"), firstPromiseAt: T("11:20") })], settings);
    expect(out.get("pat")!.collectionOnTimePercent).toBe(100);
    expect(out.get("pat")!.firstPromiseKeptPercent).toBe(0);
  });

  it("counts instant counter sales but leaves them out of the medians", () => {
    const out = computeSpeed(
      [
        order({}),
        order({ instant: true, preparerId: null, readyAt: null, completerId: "pat", fact: fact({ receivedToReadyMinutes: null, readyToHandoverMinutes: 0, onTime: null }) }),
      ],
      settings,
    );
    expect(out.get("pat")!.instantCounterSales).toBe(1);
    expect(out.get("pat")!.readyToHandover.count).toBe(0);
    expect(out.get("pat")!.receivedToReady).toEqual({ count: 1, medianMinutes: 10, slowest10Minutes: 10 });
  });

  it("promise length against target goes to the loader; delays told in advance to whoever declared them", () => {
    const out = computeSpeed(
      [
        order({ firstPromiseAt: T("11:15") }),
        order({ firstPromiseAt: T("11:40"), delays: [{ userId: "pat", at: T("11:10"), customerTold: true }] }),
        order({ delays: [{ userId: "pat", at: T("11:30"), customerTold: true }] }),
      ],
      settings,
      [{ userId: "pat", minutes: 2 }, { userId: "pat", minutes: 4 }],
    );
    expect(out.get("lee")!.promisesGiven).toBe(3);
    expect(out.get("lee")!.promisesWithinTarget).toBe(2);
    expect(out.get("pat")!.delaysDeclared).toBe(2);
    expect(out.get("pat")!.delaysToldInAdvance).toBe(1);
    expect(out.get("pat")!.alertToAckMedianMinutes).toBe(2);
  });

  it("excluded orders contribute nothing; the team figure is the same maths over everything", () => {
    const orders = [order({}), order({ fact: fact({ excluded: "backdated", onTime: null }) })];
    expect(computeSpeed(orders, settings).get("pat")!.collectionJudged).toBe(1);
    expect(teamSpeed(orders, settings).collectionJudged).toBe(1);
  });
});

describe("Fairness", () => {
  it("active hours are first to last action plus 10 minutes, capped at 12 hours", () => {
    expect(activeHoursForShift(T("09:00"), T("11:50"))).toBe(3);
    expect(activeHoursForShift(new Date("2026-01-12T06:00:00Z"), new Date("2026-01-13T05:00:00Z"))).toBe(12);
    expect(activeTime([
      { tradingDay: "2026-01-12", openedAt: T("09:00"), lastActivityAt: T("09:50") },
      { tradingDay: "2026-01-13", openedAt: T("09:00"), lastActivityAt: T("09:50") },
    ])).toEqual({ activeHours: 2, daysWorked: 2 });
  });

  it("puts a part-timer on the same footing: rates per hour, per day, per 10 orders", () => {
    const r = fairnessRates({ activeHours: 4, daysWorked: 1, ordersHandled: 20, jobs: 40, completed: 20, valueBroughtIn: 400, refundsProcessed: 2, reopens: 0, deletes: 1, unreadyTaps: 0, wrongItemOrders: 0 });
    expect(r.jobsPerActiveHour).toBe(10);
    expect(r.valuePerDay).toBe(400);
    expect(r.refundsPer10Orders).toBe(1);
    expect(fairnessRates({ activeHours: 0, daysWorked: 0, ordersHandled: 0, jobs: 0, completed: 0, valueBroughtIn: 0, refundsProcessed: 0, reopens: 0, deletes: 0, unreadyTaps: 0, wrongItemOrders: 0 }).jobsPerActiveHour).toBeNull();
  });

  it("a team median needs 4 or more people", () => {
    expect(teamMedian([1, 2, 3])).toBeNull();
    expect(teamMedian([1, 2, 3, 10])).toBe(2.5);
    expect(teamMedian([1, null, 3, 4, 5])).toBe(3.5);
  });
});

describe("Targets", () => {
  const source = (over: Partial<KpiSource["speed"]> = {}): KpiSource => ({
    figures: { wrongItemRatePercent: 0, picked: 30 },
    speed: { ...computeSpeed([], { prepSlaMinutes: 20, deliveryLeadMinutes: 45 }).get(null)!, ...over } as KpiSource["speed"],
    rates: fairnessRates({ activeHours: 10, daysWorked: 2, ordersHandled: 30, jobs: 50, completed: 30, valueBroughtIn: 600, refundsProcessed: 0, reopens: 0, deletes: 0, unreadyTaps: 0, wrongItemOrders: 0 }),
    namedCustomerCapturePercent: 50,
    ordersTaken: 20,
  });

  it("green, amber, red, and grey when there is too little data", () => {
    const t = { metric: "namedCustomerCapturePercent" as const, green: 80, amber: 60 };
    expect(colourFor(85, 20, t, false)).toBe("green");
    expect(colourFor(65, 20, t, false)).toBe("amber");
    expect(colourFor(40, 20, t, false)).toBe("red");
    expect(colourFor(40, 3, t, false)).toBe("grey");
    expect(colourFor(null, 30, t, false)).toBe("grey");
    // Lower is better.
    expect(colourFor(2, 30, { metric: "wrongItemRatePercent", green: 1, amber: 3 }, false)).toBe("amber");
  });

  it("the first 4 weeks are amber-only", () => {
    const set = new Date("2026-01-01T00:00:00Z");
    expect(isAmberOnly(set, new Date("2026-01-20T00:00:00Z"))).toBe(true);
    expect(isAmberOnly(set, new Date("2026-01-30T00:00:00Z"))).toBe(false);
    expect(colourFor(10, 30, { metric: "namedCustomerCapturePercent", green: 80, amber: 60 }, true)).toBe("amber");
  });

  it("KPIs met = greens ÷ targets with enough data", () => {
    const s = evaluateKpis(
      source({ collectionJudged: 20, collectionOnTimePercent: 95 }),
      [
        { metric: "collectionOnTimePercent", green: 90, amber: 80 },
        { metric: "namedCustomerCapturePercent", green: 80, amber: 60 },
        { metric: "deliveryOnTimePercent", green: 90, amber: 80 },
      ],
      false,
    );
    expect(s.results.map((r) => r.colour)).toEqual(["green", "red", "grey"]);
    expect([s.met, s.of]).toEqual([1, 2]);
    expect(kpisMetLabel(s)).toBe("1 of 2 KPIs met");
    expect(kpisMetLabel({ met: 0, of: 0 })).toBe("Not enough data yet");
  });

  it("refuses a green worse than amber, duplicates, and anything with money in it", () => {
    expect(staffTargetsSchema.safeParse({ targets: [{ metric: "collectionOnTimePercent", green: 70, amber: 80 }] }).success).toBe(false);
    expect(
      staffTargetsSchema.safeParse({
        targets: [
          { metric: "collectionOnTimePercent", green: 90, amber: 80 },
          { metric: "collectionOnTimePercent", green: 95, amber: 80 },
        ],
      }).success,
    ).toBe(false);
    const withBonus = staffTargetsSchema.parse({ targets: [{ metric: "collectionOnTimePercent", green: 90, amber: 80, bonus: 50 }] });
    expect(JSON.stringify(withBonus)).not.toContain("bonus");
  });
});

describe("Badges", () => {
  it("are earned against fixed bars with enough data — no ranking", () => {
    const speed = computeSpeed(
      Array.from({ length: 12 }, () => order({})),
      { prepSlaMinutes: 20, deliveryLeadMinutes: 45 },
    ).get("pat")!;
    const badges = computeBadges({
      figures: { completed: 0, prepared: 12, dispatched: 0, loaded: 0, picked: 25, wrongItemOrders: 0, completedOthers: 0 },
      speed,
      rates: { daysWorked: 2 },
      namedCustomerCapturePercent: null,
      ordersTaken: 0,
    });
    expect(badges.map((b) => b.key)).toEqual(expect.arrayContaining(["on-the-dot", "promise-keeper", "steady-hands"]));
    expect(badges.map((b) => b.key)).not.toContain("regular");
  });
});

describe("Loss-prevention rule", () => {
  it("needs 3 or more events", () => {
    expect(decideFlag({ events: LP_MIN_EVENTS - 1, value: 2 }, [{ events: 0, value: 0 }], null).flagged).toBe(false);
  });

  it("flags at twice the person's baseline, not below it", () => {
    const prev = [{ events: 2, value: 2 }, { events: 2, value: 2 }];
    expect(decideFlag({ events: 4, value: 4 }, prev, null)).toMatchObject({ flagged: true, reason: "baseline", baseline: 2 });
    expect(decideFlag({ events: 3, value: 3 }, prev, null).flagged).toBe(false);
  });

  it("or a place in the top 5% of person-weeks, once there are enough to compare", () => {
    expect(topThreshold(Array.from({ length: 19 }, (_, i) => i))).toBeNull();
    const top = topThreshold(Array.from({ length: 40 }, (_, i) => i))!;
    expect(top).toBe(37);
    const prev = [{ events: 30, value: 30 }];
    expect(decideFlag({ events: 38, value: 38 }, prev, top)).toMatchObject({ flagged: true, reason: "top" });
    // A new starter with no earlier weeks is judged by the top-5% test alone.
    expect(decideFlag({ events: 5, value: 5 }, [], top).flagged).toBe(false);
  });

  it("is worded neutrally", () => {
    const text = flagSummary("refunds", "12 Jan 2026", { events: 5, value: 5 }, { flagged: true, reason: "baseline", baseline: 1, topThreshold: null });
    expect(text).toContain("usually about 1 a week");
    expect(text).toContain("Worth a look");
    expect(text.toLowerCase()).not.toMatch(/suspicious|fraud|theft|steal/);
  });
});
