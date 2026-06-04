import { describe, expect, it } from "vitest";
import { aggregateHourOfDay, formatHourOfDayTooltip } from "./hourOfDay";

function utcDowHour(date: Date): { dow: number; hour: number } {
  return { dow: date.getUTCDay(), hour: date.getUTCHours() };
}

describe("aggregateHourOfDay", () => {
  it("returns flat grid with zero buckets when no orders", () => {
    const buckets = aggregateHourOfDay([], 12, utcDowHour);
    expect(buckets).toHaveLength(7 * 24);
    expect(buckets.every((b) => b.avgRevenue === 0 && b.txns === 0)).toBe(true);
  });

  it("averages revenue across weeks for a bucket", () => {
    const mon14 = new Date("2026-01-05T14:30:00Z"); // Monday UTC
    const buckets = aggregateHourOfDay(
      [
        { createdAt: mon14, total: 120, status: "completed" },
        { createdAt: mon14, total: 80, status: "completed" },
      ],
      4,
      utcDowHour,
    );
    const cell = buckets.find((b) => b.dow === 1 && b.hour === 14);
    expect(cell?.txns).toBe(2);
    expect(cell?.avgRevenue).toBe(50);
  });

  it("ignores non-completed and refund-like orders", () => {
    const tue = new Date("2026-01-06T10:00:00Z");
    const buckets = aggregateHourOfDay(
      [
        { createdAt: tue, total: 50, status: "pending" },
        { createdAt: tue, total: -10, status: "completed" },
        { createdAt: tue, total: 30, status: "completed" },
      ],
      1,
      utcDowHour,
    );
    const cell = buckets.find((b) => b.dow === 2 && b.hour === 10);
    expect(cell?.txns).toBe(1);
    expect(cell?.avgRevenue).toBe(30);
  });
});

describe("formatHourOfDayTooltip", () => {
  it("formats tooltip text", () => {
    expect(formatHourOfDayTooltip(1, 14, 312, 18)).toBe("Mon 14:00 — £312 avg, 18 orders");
  });
});
