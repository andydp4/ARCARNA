import { describe, expect, it } from "vitest";
import {
  currentTradingDay,
  lastClosedTradingDay,
  shiftIsoDate,
  tradingDayBounds,
  tradingDayFor,
} from "./tradingDay";

const LONDON = "Europe/London";

describe("which trading day a sale belongs to", () => {
  it("puts an early-hours sale on the previous day", () => {
    // 05:59 on the 12th — the shop is still working the 11th.
    expect(tradingDayFor(new Date("2026-01-12T05:59:00Z"), LONDON)).toBe("2026-01-11");
  });

  it("starts the new day at 06:00", () => {
    expect(tradingDayFor(new Date("2026-01-12T06:00:00Z"), LONDON)).toBe("2026-01-12");
    expect(tradingDayFor(new Date("2026-01-12T06:01:00Z"), LONDON)).toBe("2026-01-12");
  });

  it("keeps a whole trading evening together across midnight", () => {
    const evening = tradingDayFor(new Date("2026-01-12T23:30:00Z"), LONDON);
    const afterMidnight = tradingDayFor(new Date("2026-01-13T01:30:00Z"), LONDON);

    expect(evening).toBe("2026-01-12");
    expect(afterMidnight).toBe("2026-01-12");
  });
});

describe("the cut is 06:00 local, not 06:00 UTC", () => {
  it("cuts at 05:00 UTC during British Summer Time", () => {
    // BST is UTC+1, so 06:00 in the shop is 05:00 UTC. A UTC-based cut would
    // put the first hour of trading on the wrong day for seven months a year.
    expect(tradingDayFor(new Date("2026-07-12T04:59:00Z"), LONDON)).toBe("2026-07-11");
    expect(tradingDayFor(new Date("2026-07-12T05:00:00Z"), LONDON)).toBe("2026-07-12");
  });

  it("cuts at 06:00 UTC in winter, when London is on GMT", () => {
    expect(tradingDayFor(new Date("2026-01-12T05:59:00Z"), LONDON)).toBe("2026-01-11");
    expect(tradingDayFor(new Date("2026-01-12T06:00:00Z"), LONDON)).toBe("2026-01-12");
  });

  it("holds for a zone behind UTC too", () => {
    // New York in winter is UTC-5, so 06:00 there is 11:00 UTC.
    expect(tradingDayFor(new Date("2026-01-12T10:59:00Z"), "America/New_York")).toBe("2026-01-11");
    expect(tradingDayFor(new Date("2026-01-12T11:00:00Z"), "America/New_York")).toBe("2026-01-12");
  });
});

describe("the day the clocks move", () => {
  it("is 23 hours long when they go forward", () => {
    // 29 March 2026: London goes GMT → BST at 01:00.
    const { start, end } = tradingDayBounds("2026-03-28", LONDON);
    const hours = (end.getTime() - start.getTime()) / 3_600_000;

    expect(hours).toBe(23);
  });

  it("is 25 hours long when they go back", () => {
    // 25 October 2026: London goes BST → GMT at 02:00.
    const { start, end } = tradingDayBounds("2026-10-24", LONDON);
    const hours = (end.getTime() - start.getTime()) / 3_600_000;

    expect(hours).toBe(25);
  });

  it("still starts at 06:00 local on both of those days", () => {
    for (const date of ["2026-03-29", "2026-10-25"]) {
      const { start } = tradingDayBounds(date, LONDON);
      const localHour = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: LONDON,
          hour: "2-digit",
          hourCycle: "h23",
        }).format(start),
      );
      expect(localHour).toBe(6);
    }
  });

  it("leaves no gap and no overlap between consecutive days", () => {
    // Every instant belongs to exactly one trading day, including across a
    // clock change — a gap would lose sales, an overlap would double-count them.
    for (const date of ["2026-03-28", "2026-06-15", "2026-10-24"]) {
      const today = tradingDayBounds(date, LONDON);
      const tomorrow = tradingDayBounds(shiftIsoDate(date, 1), LONDON);
      expect(today.end.getTime()).toBe(tomorrow.start.getTime());
    }
  });
});

describe("bounds agree with attribution", () => {
  it("puts every instant inside its own day's window", () => {
    const samples = [
      "2026-01-12T06:00:00Z",
      "2026-01-12T13:00:00Z",
      "2026-01-13T02:00:00Z",
      "2026-07-12T05:00:00Z",
      "2026-07-12T23:59:00Z",
    ];
    for (const iso of samples) {
      const instant = new Date(iso);
      const day = tradingDayFor(instant, LONDON);
      const { start, end } = tradingDayBounds(day, LONDON);
      expect(instant.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(instant.getTime()).toBeLessThan(end.getTime());
    }
  });
});

describe("what the daily close totals", () => {
  it("is yesterday's trading day once today has started", () => {
    expect(lastClosedTradingDay(LONDON, new Date("2026-01-12T06:05:00Z"))).toBe("2026-01-11");
  });

  it("is the day before that while today has not started yet", () => {
    // 05:55 — the 11th is still running, so the last finished day is the 10th.
    expect(lastClosedTradingDay(LONDON, new Date("2026-01-12T05:55:00Z"))).toBe("2026-01-10");
  });

  it("reports the day in progress right now", () => {
    expect(currentTradingDay(LONDON, new Date("2026-01-12T23:00:00Z"))).toBe("2026-01-12");
  });
});
