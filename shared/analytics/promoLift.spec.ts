import { describe, expect, it } from "vitest";
import {
  aggregateWindowMetrics,
  computePromoLift,
  liftPercent,
} from "./promoLift";

describe("liftPercent", () => {
  it("returns null when baseline is zero and promo is positive", () => {
    expect(liftPercent(100, 0)).toBeNull();
  });

  it("returns 0 when both are zero", () => {
    expect(liftPercent(0, 0)).toBe(0);
  });

  it("computes percentage lift", () => {
    expect(liftPercent(150, 100)).toBe(50);
  });
});

describe("aggregateWindowMetrics", () => {
  it("handles empty orders", () => {
    const m = aggregateWindowMetrics(
      [],
      new Map(),
      new Date("2025-01-01"),
      new Date("2025-02-01"),
    );
    expect(m.orderCount).toBe(0);
    expect(m.aov).toBe(0);
    expect(m.newCustomerShare).toBe(0);
  });
});

describe("computePromoLift", () => {
  const window = {
    start: new Date("2025-06-01"),
    end: new Date("2025-07-01"),
  };
  const baseline = {
    start: new Date("2025-05-01"),
    end: new Date("2025-06-01"),
  };

  it("computes lift for equal-length windows", () => {
    const first = new Map<string, Date>([
      ["c1", new Date("2025-06-10")],
      ["c2", new Date("2025-05-15")],
    ]);
    const result = computePromoLift({
      promo: {
        id: "p1",
        name: "Summer",
        startDate: window.start,
        endDate: window.end,
        usageCount: 12,
      },
      baselineWeeks: 4,
      promoOrders: [
        { customerId: "c1", total: 100 },
        { customerId: "c2", total: 50 },
      ],
      baselineOrders: [{ customerId: "c2", total: 80 }],
      firstOrderAtByCustomer: first,
      promoWindow: window,
      baselineWindow: baseline,
    });
    expect(result.promo.usageCount).toBe(12);
    expect(result.promoWindow.revenue).toBe(150);
    expect(result.baselineWindow.revenue).toBe(80);
    expect(result.lift.revenueLiftPct).toBe(87.5);
  });
});
