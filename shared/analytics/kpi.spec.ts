import { describe, expect, it } from "vitest";
import {
  aggregateDay,
  aggregateFromDailyRow,
  averageSameWeekdayKpi,
  offsetDate,
  pctDelta,
  sameWeekdayWindow,
} from "@shared/analytics/kpi";

describe("aggregateDay", () => {
  it("returns zeros when there are no orders", () => {
    expect(aggregateDay([])).toEqual({
      revenue: 0,
      txns: 0,
      aov: 0,
      refundsTotal: 0,
    });
  });

  it("computes revenue, txns, and aov for completed sales", () => {
    const result = aggregateDay([
      { total: 100 },
      { total: 50 },
      { total: "25.50" },
    ]);
    expect(result).toEqual({
      revenue: 175.5,
      txns: 3,
      aov: 58.5,
      refundsTotal: 0,
    });
  });

  it("tracks refunds separately and reduces revenue", () => {
    const result = aggregateDay([
      { total: 200 },
      { total: -30, isRefund: true },
      { total: -20 },
    ]);
    expect(result).toEqual({
      revenue: 150,
      txns: 1,
      aov: 150,
      refundsTotal: 50,
    });
  });
});

describe("aggregateFromDailyRow", () => {
  it("handles missing row", () => {
    expect(aggregateFromDailyRow(null)).toEqual({
      revenue: 0,
      txns: 0,
      aov: 0,
      refundsTotal: 0,
    });
  });
});

describe("sameWeekdayWindow", () => {
  it("returns 52 prior same-weekday dates", () => {
    const dates = sameWeekdayWindow("2026-06-01", 52);
    expect(dates).toHaveLength(52);
    expect(dates[0]).toBe("2026-05-25");
    expect(dates[51]).toBe("2025-06-02");
  });
});

describe("offsetDate", () => {
  it("shifts by calendar days", () => {
    expect(offsetDate("2026-06-01", -7)).toBe("2026-05-25");
  });
});

describe("averageSameWeekdayKpi", () => {
  it("returns null when fewer than 4 historical rows", () => {
    const sparse = [null, null, { revenue: 100, txns: 2, aov: 50, refundsTotal: 0 }];
    expect(averageSameWeekdayKpi(sparse)).toBeNull();
  });

  it("averages present rows and excludes nulls", () => {
    const rows = [
      { revenue: 100, txns: 2, aov: 50, refundsTotal: 0 },
      { revenue: 200, txns: 4, aov: 50, refundsTotal: 0 },
      null,
      { revenue: 300, txns: 6, aov: 50, refundsTotal: 0 },
      { revenue: 400, txns: 8, aov: 50, refundsTotal: 0 },
    ];
    expect(averageSameWeekdayKpi(rows)).toEqual({
      revenue: 250,
      txns: 5,
      aov: 50,
      refundsTotal: 0,
    });
  });
});

describe("pctDelta", () => {
  it("returns null when baseline is zero", () => {
    expect(pctDelta(100, 0)).toBeNull();
  });

  it("computes rounded percent change", () => {
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(75, 100)).toBe(-25);
  });
});
