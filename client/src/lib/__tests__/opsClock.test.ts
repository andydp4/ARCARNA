/**
 * What a card actually says.
 *
 * `deriveCardState` is already proven row by row in shared/orders/opsState.spec.ts;
 * these assertions cover the half a cashier reads — the counter, its spoken
 * label and the chip — because "the state is right but the clock says 0:00" is
 * indistinguishable from a broken board when you are standing at a counter.
 *
 * Every case passes its own `now`, per the fake-time convention in the
 * Operations Centre brief's test matrix: no timers are faked here.
 */
import { describe, expect, it } from "vitest";
import { deriveCardState, type OpsOrderInput, type OpsTimingSettings } from "@shared/orders/opsState";
import {
  cardChipText,
  cardClock,
  elapsedSinceReceived,
  formatClockSpan,
  formatDayChip,
  formatSpokenSpan,
  formatTimeOfDay,
} from "../opsClock";

const SETTINGS: OpsTimingSettings = {
  timezone: "Europe/London",
  prepSlaMinutes: 20,
  deliveryLeadMinutes: 45,
  dueSoonLeadMinutes: 10,
  lateGraceMinutes: 5,
};

/** Midday on a Saturday in British Summer Time — 11:00 UTC reads as 12:00. */
const NOW = new Date("2026-09-12T11:00:00Z");
const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString();

function order(overrides: Partial<OpsOrderInput> = {}): OpsOrderInput {
  return {
    status: "pending",
    fulfilmentMethod: "collection",
    dateKind: "live",
    createdAt: at(-10),
    enteredAt: at(-10),
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

function read(input: OpsOrderInput, now: Date = NOW) {
  const derived = deriveCardState(input, now, SETTINGS);
  return {
    state: derived.state,
    clock: cardClock(input, derived, now, SETTINGS.timezone),
    chip: cardChipText(input, derived, now, SETTINGS.timezone),
    elapsed: elapsedSinceReceived(derived, now),
  };
}

describe("spans", () => {
  it("counts in minutes and seconds", () => {
    expect(formatClockSpan(0)).toBe("0:00");
    expect(formatClockSpan(252_000)).toBe("4:12");
    expect(formatClockSpan(59_999)).toBe("0:59");
  });

  it("adds an hours field only once there is an hour to show", () => {
    expect(formatClockSpan(59 * 60_000)).toBe("59:00");
    expect(formatClockSpan(3_723_000)).toBe("1:02:03");
  });

  it("never counts backwards when the tablet's clock runs ahead of the server", () => {
    expect(formatClockSpan(-4_000)).toBe("0:00");
  });

  it("speaks whole minutes, because a live region reading seconds is unusable", () => {
    expect(formatSpokenSpan(30_000)).toBe("less than a minute");
    expect(formatSpokenSpan(60_000)).toBe("1 minute");
    expect(formatSpokenSpan(4 * 60_000)).toBe("4 minutes");
    expect(formatSpokenSpan(65 * 60_000)).toBe("1 hour 5 minutes");
    expect(formatSpokenSpan(120 * 60_000)).toBe("2 hours");
  });

  it("renders times and days in the organisation's timezone, not the tablet's", () => {
    expect(formatTimeOfDay(NOW, "Europe/London")).toBe("12:00");
    expect(formatTimeOfDay(NOW, "UTC")).toBe("11:00");
    expect(formatDayChip(NOW, "Europe/London")).toBe("SAT 12 SEPT");
  });
});

describe("the clock and chip for every state reachable from the board", () => {
  it("counts down to a promise that has not passed", () => {
    const card = read(order({ etaGiven: at(30) }));
    expect(card.state).toBe("on-time");
    expect(card.chip).toBe("ON TIME");
    expect(card.clock?.text).toBe("due in 30:00");
    expect(card.clock?.ariaLabel).toBe("Due in 30 minutes");
  });

  it("counts up, and says so, when nobody promised a time", () => {
    const card = read(order({ enteredAt: at(-12), createdAt: at(-12) }));
    expect(card.state).toBe("on-time");
    expect(card.chip).toBe("NO TIME GIVEN");
    expect(card.clock?.text).toBe("12:00");
    expect(card.clock?.ariaLabel).toBe("Waiting 12 minutes, no time given");
  });

  it("turns DUE SOON inside the lead time without changing the countdown", () => {
    const card = read(order({ etaGiven: at(5) }));
    expect(card.state).toBe("due-soon");
    expect(card.chip).toBe("DUE SOON");
    expect(card.clock?.text).toBe("due in 5:00");
  });

  it("says how far past the promise a late order is", () => {
    const card = read(order({ etaGiven: at(-10) }));
    expect(card.state).toBe("late");
    expect(card.chip).toBe("LATE 10:00");
    expect(card.clock?.text).toBe("late by 10:00");
    expect(card.clock?.ariaLabel).toBe("Late by 10 minutes");
  });

  it("says OVERDUE without a number when the SLA, not a promise, has run out", () => {
    // Collection SLA is 20 minutes and the grace is 5, so 40 minutes in with
    // no promise is overdue — but there is no promise to be "late by".
    const card = read(order({ createdAt: at(-40), enteredAt: at(-40) }));
    expect(card.state).toBe("late");
    expect(card.chip).toBe("OVERDUE · NO TIME GIVEN");
    expect(card.clock?.text).toBe("40:00");
  });

  it("counts down to the revised time on a declared delay", () => {
    const card = read(order({ etaGiven: at(-30), delayFlag: true, revisedEta: at(15) }));
    expect(card.state).toBe("delayed");
    expect(card.chip).toBe("DELAYED");
    expect(card.clock?.text).toBe("new time in 15:00");
  });

  it("counts how long a held order has been held", () => {
    const held = read(order({ status: "on-hold", heldAt: at(-7) }));
    expect(held.state).toBe("held");
    expect(held.chip).toBe("HELD");
    expect(held.clock?.text).toBe("held 7:00");
  });

  it("falls back to time-in-the-building while held_at does not exist yet", () => {
    // v0 runs over the existing columns, where nothing writes `held_at`
    // (it arrives with migration 065). The card still has to say something
    // true rather than "held 0:00".
    const card = read(order({ status: "on-hold", createdAt: at(-25), enteredAt: at(-25) }));
    expect(card.clock?.text).toBe("held 25:00");
  });

  it("gives yesterday's and tomorrow's cards no clock at all", () => {
    const yesterday = read(order({ createdAt: at(-26 * 60), enteredAt: at(-26 * 60) }));
    expect(yesterday.state).toBe("carried-over");
    expect(yesterday.chip).toBe("YESTERDAY");
    expect(yesterday.clock).toBeNull();
    expect(yesterday.elapsed).toBeNull();

    const tomorrow = read(order({ dateKind: "preorder", createdAt: at(24 * 60), enteredAt: at(-5), etaGiven: null }));
    expect(tomorrow.state).toBe("scheduled");
    expect(tomorrow.chip).toBe("FOR SUN 13 SEPT");
    expect(tomorrow.clock).toBeNull();
  });

  it("states when a completed order was handed over and how long it took", () => {
    const card = read(order({ status: "completed", createdAt: at(-30), enteredAt: at(-30), settledAt: at(0) }));
    expect(card.state).toBe("completed");
    expect(card.chip).toBe("DONE");
    expect(card.clock?.text).toBe("Done 12:00 · took 30:00");
  });

  it("shows a completed order with no settlement stamp without inventing one", () => {
    // `GET /api/orders` does not project `settled_at` today, so v0's completed
    // cards arrive without one. Better silent than fabricated.
    const card = read(order({ status: "completed" }));
    expect(card.state).toBe("completed");
    expect(card.clock).toBeNull();
  });

  it("keeps a second, smaller clock for how long an open order has been here", () => {
    const card = read(order({ etaGiven: at(30), createdAt: at(-18), enteredAt: at(-18) }));
    expect(card.elapsed).toBe("18:00");
  });
});

describe("stages that arrive with the stage columns (N2/N3b)", () => {
  it("counts how long something has been ready and waiting", () => {
    const card = read(order({ readyAt: at(-3), etaGiven: at(20) }));
    expect(card.state).toBe("ready");
    expect(card.chip).toBe("READY");
    expect(card.clock?.text).toBe("ready 3:00");
  });

  it("switches to an arrival estimate once a delivery is on the road", () => {
    const card = read(
      order({
        fulfilmentMethod: "delivery",
        readyAt: at(-10),
        outForDeliveryAt: at(-5),
        etaGiven: at(12),
      }),
    );
    expect(card.chip).toBe("ON THE ROAD");
    expect(card.clock?.text).toBe("ETA in 12:00");
  });

  it("counts the customer's wait from the moment they arrived", () => {
    const card = read(order({ customerArrivedAt: at(-4), etaGiven: at(10) }));
    expect(card.state).toBe("customer-waiting");
    expect(card.chip).toBe("CUSTOMER WAITING");
    expect(card.clock?.text).toBe("waiting 4:00");
  });
});
