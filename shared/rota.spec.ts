import { describe, expect, it } from "vitest";
import { forwardDates, headcountFor, resolvePersonDay, resolvePersonRota } from "./rota";

const pattern = (overrides: Partial<Parameters<typeof resolvePersonDay>[1][number]> = {}) => [
  { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", effectiveFrom: "2026-01-01", effectiveUntil: null, isActive: 1, ...overrides },
];

describe("resolvePersonDay", () => {
  it("uses the matching pattern when there is no override", () => {
    // 2026-09-28 is a Monday.
    expect(resolvePersonDay("2026-09-28", pattern(), [])).toEqual({
      date: "2026-09-28",
      status: "working",
      startTime: "09:00",
      endTime: "17:00",
      isOverride: false,
    });
  });

  it("is unscheduled with no pattern and no override", () => {
    expect(resolvePersonDay("2026-09-29", [], [])).toEqual({
      date: "2026-09-29",
      status: "unscheduled",
      startTime: null,
      endTime: null,
      isOverride: false,
    });
  });

  it("an off override always wins over a matching pattern", () => {
    const result = resolvePersonDay("2026-09-28", pattern(), [{ date: "2026-09-28", status: "off", startTime: null, endTime: null }]);
    expect(result).toEqual({ date: "2026-09-28", status: "off", startTime: null, endTime: null, isOverride: true });
  });

  it("a working override (a swap) replaces the pattern's hours", () => {
    const result = resolvePersonDay("2026-09-28", pattern(), [
      { date: "2026-09-28", status: "working", startTime: "12:00", endTime: "20:00" },
    ]);
    expect(result).toEqual({ date: "2026-09-28", status: "working", startTime: "12:00", endTime: "20:00", isOverride: true });
  });

  it("a pattern outside its effective range does not apply", () => {
    const expired = pattern({ effectiveUntil: "2026-01-31" });
    expect(resolvePersonDay("2026-09-28", expired, []).status).toBe("unscheduled");
  });

  it("an inactive pattern does not apply", () => {
    expect(resolvePersonDay("2026-09-28", pattern({ isActive: 0 }), []).status).toBe("unscheduled");
  });

  it("wrong day-of-week does not match", () => {
    // 2026-09-29 is a Tuesday; the pattern is for Monday (1).
    expect(resolvePersonDay("2026-09-29", pattern(), []).status).toBe("unscheduled");
  });
});

describe("resolvePersonRota", () => {
  it("resolves a run of dates in order", () => {
    const dates = forwardDates("2026-09-28", 3); // Mon, Tue, Wed
    const days = resolvePersonRota(dates, pattern(), []);
    expect(days.map((d) => d.status)).toEqual(["working", "unscheduled", "unscheduled"]);
  });
});

describe("forwardDates", () => {
  it("includes the start date and rolls over month/year boundaries", () => {
    expect(forwardDates("2026-12-30", 4)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
});

describe("headcountFor", () => {
  it("counts only people working on that date's index", () => {
    const rotaByUser = new Map([
      ["u1", [{ date: "d", status: "working", startTime: null, endTime: null, isOverride: false }] as const],
      ["u2", [{ date: "d", status: "off", startTime: null, endTime: null, isOverride: false }] as const],
      ["u3", [{ date: "d", status: "working", startTime: null, endTime: null, isOverride: false }] as const],
    ]);
    expect(headcountFor("d", rotaByUser as any, 0)).toBe(2);
  });
});
