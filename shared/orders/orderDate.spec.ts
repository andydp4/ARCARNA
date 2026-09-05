import { describe, expect, it } from "vitest";
import {
  BACKDATE_LIMIT_DAYS,
  PREORDER_LIMIT_DAYS,
  classifyOrderDate,
  instantForOrderDate,
  isIsoDate,
  orderDateWindow,
  todayIn,
} from "./orderDate";
import { tradingDayFor } from "../time/tradingDay";

const LONDON = "Europe/London";
const TODAY = "2026-09-03";

describe("what an order date means", () => {
  it("is a live sale when no date is given", () => {
    for (const none of [undefined, null, ""]) {
      expect(classifyOrderDate(none, TODAY)).toEqual({
        ok: true,
        dating: { kind: "live", date: TODAY },
      });
    }
  });

  it("is a live sale when the date is today", () => {
    expect(classifyOrderDate(TODAY, TODAY)).toEqual({
      ok: true,
      dating: { kind: "live", date: TODAY },
    });
  });

  it("is backdated for a day already gone", () => {
    expect(classifyOrderDate("2026-09-02", TODAY)).toEqual({
      ok: true,
      dating: { kind: "backdated", date: "2026-09-02" },
    });
  });

  it("is a pre-order for a day still to come", () => {
    expect(classifyOrderDate("2026-09-10", TODAY)).toEqual({
      ok: true,
      dating: { kind: "preorder", date: "2026-09-10" },
    });
  });

  it("allows exactly the window: 7 days back, 14 ahead, inclusive", () => {
    const { min, max } = orderDateWindow(TODAY);
    expect(min).toBe("2026-08-27");
    expect(max).toBe("2026-09-17");
    expect(BACKDATE_LIMIT_DAYS).toBe(7);
    expect(PREORDER_LIMIT_DAYS).toBe(14);

    expect(classifyOrderDate(min, TODAY).ok).toBe(true);
    expect(classifyOrderDate(max, TODAY).ok).toBe(true);
  });

  it("refuses a date outside the window rather than moving it", () => {
    const tooOld = classifyOrderDate("2026-08-26", TODAY);
    expect(tooOld.ok).toBe(false);
    if (!tooOld.ok) {
      expect(tooOld.code).toBe("ORDER_DATE_OUT_OF_RANGE");
      expect(tooOld.message).toMatch(/7 days back/);
    }

    const tooFar = classifyOrderDate("2026-09-18", TODAY);
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) {
      expect(tooFar.code).toBe("ORDER_DATE_OUT_OF_RANGE");
      expect(tooFar.message).toMatch(/14 days ahead/);
    }
  });

  it("refuses anything that is not a calendar date", () => {
    for (const bad of ["yesterday", "03/09/2026", "2026-13-01", "2026-02-30", 20260903, {}]) {
      const verdict = classifyOrderDate(bad, TODAY);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe("ORDER_DATE_INVALID");
    }
  });

  it("checks the date is real, not just shaped like one", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });
});

describe("where a dated order lands", () => {
  it("stamps a dated order at noon local, inside the trading day it names", () => {
    // BST: noon London is 11:00Z.
    const instant = instantForOrderDate("2026-09-02", LONDON);
    expect(instant.toISOString()).toBe("2026-09-02T11:00:00.000Z");
    expect(tradingDayFor(instant, LONDON)).toBe("2026-09-02");
  });

  it("stays inside the right trading day in winter too", () => {
    const instant = instantForOrderDate("2026-01-12", LONDON);
    expect(instant.toISOString()).toBe("2026-01-12T12:00:00.000Z");
    expect(tradingDayFor(instant, LONDON)).toBe("2026-01-12");
  });

  it("uses the calendar date in the org's zone, not the trading day, for today", () => {
    // 01:30 on the 4th London time. The trading day is still the 3rd; the
    // calendar — and the date on the till's form — says the 4th.
    const smallHours = new Date("2026-09-04T00:30:00Z");
    expect(todayIn(LONDON, smallHours)).toBe("2026-09-04");
    expect(tradingDayFor(smallHours, LONDON)).toBe("2026-09-03");
  });

  it("follows the zone across midnight", () => {
    const lateLondon = new Date("2026-09-03T23:30:00Z");
    expect(todayIn(LONDON, lateLondon)).toBe("2026-09-04");
    expect(todayIn("UTC", lateLondon)).toBe("2026-09-03");
  });
});
