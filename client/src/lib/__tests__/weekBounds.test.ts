/**
 * ARC-045: weeks must start on Monday everywhere — Profit Truths
 * (expense-reports.tsx) used to start "this week" on Sunday while every
 * other week-scoped report started Monday, so the same day could fall in
 * "this week" on one page and "last week" on another.
 */
import { describe, it, expect } from "vitest";
import { mondayWeekBounds } from "../weekBounds";

describe("mondayWeekBounds", () => {
  it("returns Monday as the start for a Wednesday anchor", () => {
    // 2026-01-14 is a Wednesday.
    const { from, to } = mondayWeekBounds(new Date("2026-01-14T12:00:00Z"));
    expect(from).toBe("2026-01-12"); // Monday
    expect(to).toBe("2026-01-18"); // Sunday
  });

  it("treats a Sunday anchor as the LAST day of its week, not the first", () => {
    // 2026-01-18 is a Sunday — under the old Sunday-start bug this would have
    // been treated as day 1 of a NEW week; it must stay the last day of the
    // week that started on 2026-01-12.
    const { from, to } = mondayWeekBounds(new Date("2026-01-18T12:00:00Z"));
    expect(from).toBe("2026-01-12");
    expect(to).toBe("2026-01-18");
  });

  it("returns the same week's Monday when the anchor already IS Monday", () => {
    const { from, to } = mondayWeekBounds(new Date("2026-01-12T00:00:00Z"));
    expect(from).toBe("2026-01-12");
    expect(to).toBe("2026-01-18");
  });
});
