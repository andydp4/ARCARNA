/**
 * The counter view answers "what is waiting, and how long has it waited".
 *
 * A timestamp does not answer that — somebody reading "14:32" has to do
 * arithmetic to discover an order has been sitting for forty minutes. The wait
 * is stated directly and escalates in tone, so a glance is enough.
 */
import { describe, expect, it } from "vitest";
import { describeWait, formatPaymentLabel } from "../orders-row";

const NOW = new Date("2026-08-26T14:00:00Z").getTime();
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

describe("how long an order has waited", () => {
  it("says just now for something that has only landed", () => {
    expect(describeWait(minutesAgo(0), NOW).label).toBe("just now");
  });

  it("counts in minutes for the first hour", () => {
    expect(describeWait(minutesAgo(14), NOW).label).toBe("14 min");
    expect(describeWait(minutesAgo(59), NOW).label).toBe("59 min");
  });

  it("switches to hours and minutes past the hour", () => {
    expect(describeWait(minutesAgo(75), NOW).label).toBe("1h 15m");
  });

  it("switches to days once it is genuinely old", () => {
    expect(describeWait(minutesAgo(60 * 26), NOW).label).toBe("1d");
  });

  it("gets louder the longer it waits", () => {
    // Quiet while it is fresh, a warning once it is lingering, and loud once it
    // has been an hour — which on a counter is a complaint waiting to happen.
    expect(describeWait(minutesAgo(5), NOW).tone).toContain("muted");
    expect(describeWait(minutesAgo(25), NOW).tone).toContain("warning");
    expect(describeWait(minutesAgo(90), NOW).tone).toContain("destructive");
  });

  it("never reports a negative wait for a clock that is slightly ahead", () => {
    const future = new Date(NOW + 30_000).toISOString();
    expect(describeWait(future, NOW).minutes).toBe(0);
    expect(describeWait(future, NOW).label).toBe("just now");
  });
});

/**
 * The stored value for a credit sale is still literally "tick" — it is a
 * database value on every historic and current order, not just a label, and
 * changing it is a data migration, not a rename. Every place that DISPLAYS
 * a payment method has to translate it, or the word "tick" resurfaces on a
 * screen a member of staff reads (Open Orders, invoices, insights).
 */
describe("payment method labels", () => {
  it("shows a credit sale as Credit, never as tick", () => {
    expect(formatPaymentLabel("tick")).toBe("Credit");
    expect(formatPaymentLabel("TICK")).toBe("Credit");
  });

  it("capitalises everything else consistently", () => {
    expect(formatPaymentLabel("cash")).toBe("Cash");
    expect(formatPaymentLabel("card")).toBe("Card");
    expect(formatPaymentLabel("transfer")).toBe("Transfer");
  });

  it("turns hyphens and underscores into spaces before capitalising", () => {
    expect(formatPaymentLabel("personal_use")).toBe("Personal use");
    expect(formatPaymentLabel("gift-card")).toBe("Gift card");
  });

  it("shows a dash for no method at all, rather than an empty cell", () => {
    expect(formatPaymentLabel("")).toBe("—");
  });
});
