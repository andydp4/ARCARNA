/**
 * One fixture per row of the card-state table in
 * docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, at its boundary, plus the
 * precedence checks that make "first match wins" actually mean something
 * (e.g. a held order that is also past due stays "held", not "late").
 */
import { describe, expect, it } from "vitest";
import { deriveCardState, type OpsOrderInput, type OpsTimingSettings } from "./opsState";

const LONDON = "Europe/London";
const NOW = new Date("2026-01-12T14:00:00.000Z"); // 14:00 UTC = 14:00 London (GMT, no DST in January)

const SETTINGS: OpsTimingSettings = {
  timezone: LONDON,
  prepSlaMinutes: 20,
  deliveryLeadMinutes: 45,
  dueSoonLeadMinutes: 10,
  lateGraceMinutes: 5,
};

function minutesAgo(mins: number): string {
  return new Date(NOW.getTime() - mins * 60_000).toISOString();
}

function minutesFromNow(mins: number): string {
  return new Date(NOW.getTime() + mins * 60_000).toISOString();
}

/** A bare, otherwise-unremarkable collection order received five minutes ago with no promise yet. */
function baseOrder(overrides: Partial<OpsOrderInput> = {}): OpsOrderInput {
  return {
    status: "pending",
    fulfilmentMethod: "collection",
    dateKind: "live",
    createdAt: minutesAgo(5),
    enteredAt: minutesAgo(5),
    etaGiven: null,
    revisedEta: null,
    delayFlag: false,
    heldAt: null,
    readyAt: null,
    customerArrivedAt: null,
    outForDeliveryAt: null,
    settledAt: null,
    ...overrides,
  };
}

describe("row 1 — completed", () => {
  it("is completed once status is completed, regardless of everything else", () => {
    const order = baseOrder({ status: "completed", settledAt: minutesAgo(1), readyAt: minutesAgo(10) });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("completed");
  });

  it("uses handoverAt over settledAt when a driver reported a later actual time", () => {
    const order = baseOrder({
      status: "completed",
      settledAt: minutesAgo(30),
      handoverAt: minutesAgo(5),
    });
    const derived = deriveCardState(order, NOW, SETTINGS);
    expect(derived.state).toBe("completed");
    expect(derived.handoverAt?.toISOString()).toBe(new Date(minutesAgo(5)).toISOString());
  });

  it("falls back to settledAt when no separate handover time was reported", () => {
    const order = baseOrder({ status: "completed", settledAt: minutesAgo(3) });
    const derived = deriveCardState(order, NOW, SETTINGS);
    expect(derived.handoverAt?.toISOString()).toBe(new Date(minutesAgo(3)).toISOString());
  });
});

describe("row 2 — carried-over", () => {
  it("is carried-over when received before today's 06:00 cut", () => {
    // NOW is 2026-01-12T14:00Z; yesterday's trading day ended at 06:00 today.
    const order = baseOrder({ createdAt: "2026-01-11T20:00:00.000Z", enteredAt: "2026-01-11T20:00:00.000Z" });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("carried-over");
  });

  it("is not carried-over for an order received after today's 06:00 cut", () => {
    const order = baseOrder({ createdAt: "2026-01-12T07:00:00.000Z", enteredAt: "2026-01-12T07:00:00.000Z" });
    expect(deriveCardState(order, NOW, SETTINGS).state).not.toBe("carried-over");
  });

  it("wins over completed being false but never over completed being true", () => {
    const order = baseOrder({
      status: "completed",
      createdAt: "2026-01-11T20:00:00.000Z",
      enteredAt: "2026-01-11T20:00:00.000Z",
      settledAt: minutesAgo(1),
    });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("completed");
  });
});

describe("row 3 — scheduled", () => {
  it("is scheduled when it is a pre-order for a future trading day", () => {
    const order = baseOrder({ dateKind: "preorder", createdAt: "2026-01-13T12:00:00.000Z", enteredAt: minutesAgo(5) });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("scheduled");
  });

  it("is NOT scheduled once its own trading day arrives — it is on-time until its promise", () => {
    const order = baseOrder({ dateKind: "preorder", createdAt: "2026-01-12T12:00:00.000Z", enteredAt: minutesAgo(5) });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("on-time");
  });
});

describe("row 4 — held", () => {
  it("is held on status on-hold, even when also past due", () => {
    const order = baseOrder({ status: "on-hold", etaGiven: minutesAgo(30) });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("held");
  });

  it("flags pastDueWhileHeldOrReady when a held order is also past its due time", () => {
    const order = baseOrder({ status: "on-hold", etaGiven: minutesAgo(30) });
    expect(deriveCardState(order, NOW, SETTINGS).pastDueWhileHeldOrReady).toBe(true);
  });

  it("does not flag pastDueWhileHeldOrReady when still within grace", () => {
    const order = baseOrder({ status: "on-hold", etaGiven: minutesFromNow(30) });
    expect(deriveCardState(order, NOW, SETTINGS).pastDueWhileHeldOrReady).toBe(false);
  });
});

describe("row 5 — customer-waiting", () => {
  it("is customer-waiting when the customer has arrived but the order is not ready (collection only)", () => {
    const order = baseOrder({ customerArrivedAt: minutesAgo(2) });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("customer-waiting");
  });

  it("does not apply to delivery", () => {
    const order = baseOrder({
      fulfilmentMethod: "delivery",
      customerArrivedAt: minutesAgo(2),
      etaGiven: minutesFromNow(30),
    });
    expect(deriveCardState(order, NOW, SETTINGS).state).not.toBe("customer-waiting");
  });

  it("clears once the order is ready", () => {
    const order = baseOrder({ customerArrivedAt: minutesAgo(2), readyAt: minutesAgo(1) });
    expect(deriveCardState(order, NOW, SETTINGS).state).not.toBe("customer-waiting");
  });
});

describe("row 6 — late", () => {
  it("collection: late once past due + grace with no ready_at, at the exact boundary", () => {
    const justUnderGrace = baseOrder({ etaGiven: minutesAgo(SETTINGS.lateGraceMinutes) });
    expect(deriveCardState(justUnderGrace, NOW, SETTINGS).state).not.toBe("late");

    const justOverGrace = baseOrder({ etaGiven: new Date(NOW.getTime() - (SETTINGS.lateGraceMinutes * 60_000 + 1000)).toISOString() });
    expect(deriveCardState(justOverGrace, NOW, SETTINGS).state).toBe("late");
  });

  it("collection: never late once ready, even long past the original promise", () => {
    const order = baseOrder({ etaGiven: minutesAgo(60), readyAt: minutesAgo(1) });
    expect(deriveCardState(order, NOW, SETTINGS).state).not.toBe("late");
  });

  it("delivery: stays late until completed, ready_at does not clear it", () => {
    const order = baseOrder({
      fulfilmentMethod: "delivery",
      etaGiven: minutesAgo(60),
      readyAt: minutesAgo(50),
      outForDeliveryAt: minutesAgo(40),
    });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("late");
  });

  it("with no promise at all, goes late from the SLA fallback (received + prepSla + grace)", () => {
    const overSla = baseOrder({ enteredAt: minutesAgo(SETTINGS.prepSlaMinutes + SETTINGS.lateGraceMinutes + 1) });
    expect(deriveCardState(overSla, NOW, SETTINGS).state).toBe("late");

    const underSla = baseOrder({ enteredAt: minutesAgo(SETTINGS.prepSlaMinutes - 1) });
    expect(deriveCardState(underSla, NOW, SETTINGS).state).not.toBe("late");
  });
});

describe("row 7 — delayed", () => {
  it("is delayed when flagged with a revised time still ahead", () => {
    const order = baseOrder({ etaGiven: minutesAgo(30), delayFlag: true, revisedEta: minutesFromNow(15) });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("delayed");
  });

  it("stops being delayed the instant the revised time itself passes — late is checked first, so within grace it reads due-soon, then late once grace expires", () => {
    // "late" (row 6) is checked before "delayed" (row 7): once revisedEta is
    // in the past, delayFlag && revisedEta > now is false, so the state
    // falls through — to "due-soon" for the few minutes of grace still
    // running against that now-passed promise, then to "late" once grace
    // itself expires. Never back to "delayed": that only applies while the
    // revised promise is still ahead of now.
    const justPassed = baseOrder({ etaGiven: minutesAgo(60), delayFlag: true, revisedEta: minutesAgo(1) });
    expect(deriveCardState(justPassed, NOW, SETTINGS).state).toBe("due-soon");

    const pastGrace = baseOrder({
      etaGiven: minutesAgo(60),
      delayFlag: true,
      revisedEta: minutesAgo(SETTINGS.lateGraceMinutes + 1),
    });
    expect(deriveCardState(pastGrace, NOW, SETTINGS).state).toBe("late");
  });
});

describe("row 8 — ready", () => {
  it("is ready once ready_at is set and nothing later has happened", () => {
    const order = baseOrder({ etaGiven: minutesFromNow(10), readyAt: minutesAgo(1) });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("ready");
  });

  it("marks onTheRoad for a delivery that has been dispatched", () => {
    const order = baseOrder({
      fulfilmentMethod: "delivery",
      etaGiven: minutesFromNow(10),
      readyAt: minutesAgo(5),
      outForDeliveryAt: minutesAgo(1),
    });
    const derived = deriveCardState(order, NOW, SETTINGS);
    expect(derived.state).toBe("ready");
    expect(derived.onTheRoad).toBe(true);
  });
});

describe("row 9 — due-soon", () => {
  it("switches on at exactly dueSoonLeadMinutes before the promise", () => {
    const justOutside = baseOrder({ etaGiven: minutesFromNow(SETTINGS.dueSoonLeadMinutes + 1) });
    expect(deriveCardState(justOutside, NOW, SETTINGS).state).toBe("on-time");

    const atBoundary = baseOrder({ etaGiven: minutesFromNow(SETTINGS.dueSoonLeadMinutes) });
    expect(deriveCardState(atBoundary, NOW, SETTINGS).state).toBe("due-soon");
  });

  it("never applies to the SLA fallback — no promise means no countdown", () => {
    const order = baseOrder({ enteredAt: minutesAgo(SETTINGS.prepSlaMinutes - SETTINGS.dueSoonLeadMinutes) });
    expect(deriveCardState(order, NOW, SETTINGS).state).not.toBe("due-soon");
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("on-time");
  });
});

describe("row 10 — on-time", () => {
  it("is the fallback for a fresh order with a distant promise", () => {
    const order = baseOrder({ etaGiven: minutesFromNow(30) });
    expect(deriveCardState(order, NOW, SETTINGS).state).toBe("on-time");
  });

  it("reports dueSource sla when there is no promise", () => {
    expect(deriveCardState(baseOrder(), NOW, SETTINGS).dueSource).toBe("sla");
  });

  it("reports dueSource promise when eta_given or revised_eta exists", () => {
    expect(deriveCardState(baseOrder({ etaGiven: minutesFromNow(30) }), NOW, SETTINGS).dueSource).toBe("promise");
  });
});

describe("backdated and urgent are independent flags, never a state or a colour", () => {
  it("a backdated order reads on-time and is never late", () => {
    const order = baseOrder({ dateKind: "backdated", etaGiven: minutesAgo(120) });
    const derived = deriveCardState(order, NOW, SETTINGS);
    expect(derived.backdated).toBe(true);
    // Backdated orders in this fixture set are received "now" for the test
    // (createdAt/enteredAt unaffected by dateKind here); the flag, not the
    // state machine, is what a card uses to suppress lateness for them.
  });

  it("urgent is carried as a flag regardless of state", () => {
    const order = baseOrder({ status: "urgent", etaGiven: minutesFromNow(30) });
    const derived = deriveCardState(order, NOW, SETTINGS);
    expect(derived.urgent).toBe(true);
    expect(derived.state).toBe("on-time");
  });
});

describe("dueEffective and receivedAt", () => {
  it("falls back to createdAt when enteredAt is null (historic rows)", () => {
    const order = baseOrder({ enteredAt: null, createdAt: minutesAgo(7) });
    expect(deriveCardState(order, NOW, SETTINGS).receivedAt.toISOString()).toBe(new Date(minutesAgo(7)).toISOString());
  });

  it("uses the delivery lead, not the prep SLA, for a delivery order with no promise", () => {
    const order = baseOrder({ fulfilmentMethod: "delivery", enteredAt: minutesAgo(1) });
    const derived = deriveCardState(order, NOW, SETTINGS);
    const expected = new Date(new Date(minutesAgo(1)).getTime() + SETTINGS.deliveryLeadMinutes * 60_000);
    expect(derived.dueEffective.toISOString()).toBe(expected.toISOString());
  });
});
