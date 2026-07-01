import { describe, it, expect } from "vitest";
import {
  buildCashierShiftBalanceSheet,
  allocateGlobalExpenseShare,
  dailyOverheadTotal,
  utcDateKey,
} from "./cashierShiftReport";

describe("buildCashierShiftBalanceSheet", () => {
  it("matches the spec worked example: £100 sale, £25 stock, £10 order expense, £15 overhead", () => {
    const orders = [
      {
        id: "o1",
        total: 100,
        paymentMethod: "card",
        status: "completed",
        createdAt: "2026-06-01T10:00:00Z",
        items: [{ quantity: 1, costPrice: 25 }],
      },
    ];

    const sheet = buildCashierShiftBalanceSheet(orders, 10, 15, [], 0, 20);

    expect(sheet.grossSales).toBe(100);
    expect(sheet.stockCost).toBe(25);
    expect(sheet.netSalesProfit).toBe(50);
    expect(sheet.commissionAmount).toBe(10);
    expect(sheet.businessRetainedProfit).toBe(40);
  });

  it("never pays commission on negative net sales profit", () => {
    const orders = [
      {
        id: "o1",
        total: 50,
        paymentMethod: "cash",
        status: "completed",
        createdAt: "2026-06-01T10:00:00Z",
        items: [{ quantity: 1, costPrice: 40 }],
      },
    ];

    const sheet = buildCashierShiftBalanceSheet(orders, 30, 0, [], 0, 20);

    expect(sheet.netSalesProfit).toBeLessThan(0);
    expect(sheet.commissionAmount).toBe(0);
  });

  it("excludes unpaid credit/tick sales from paid sales received", () => {
    const orders = [
      {
        id: "o1",
        total: 100,
        paymentMethod: "cash",
        status: "completed",
        createdAt: "2026-06-01T10:00:00Z",
        items: [],
      },
      {
        id: "o2",
        total: 40,
        paymentMethod: "tick",
        status: "pending",
        createdAt: "2026-06-01T11:00:00Z",
        items: [],
      },
    ];

    const sheet = buildCashierShiftBalanceSheet(orders, 0, 0, [], 0, 10);

    expect(sheet.grossSales).toBe(140);
    expect(sheet.unpaidCreditSales).toBe(40);
    expect(sheet.paidSalesReceived).toBe(100);
    expect(sheet.netSalesProfit).toBe(100);
  });

  it("flags incomplete cost data when a product has no cost price, treating it as 0", () => {
    const orders = [
      {
        id: "o1",
        total: 20,
        paymentMethod: "cash",
        status: "completed",
        createdAt: "2026-06-01T10:00:00Z",
        items: [{ quantity: 1, costPrice: null }],
      },
    ];

    const sheet = buildCashierShiftBalanceSheet(orders, 0, 0, [], 0, 10);

    expect(sheet.stockCost).toBe(0);
    expect(sheet.hasIncompleteCostData).toBe(true);
  });

  it("deducts refunds from net sales profit", () => {
    const orders = [
      {
        id: "o1",
        total: 100,
        paymentMethod: "card",
        status: "completed",
        createdAt: "2026-06-01T10:00:00Z",
        items: [],
      },
    ];

    const sheet = buildCashierShiftBalanceSheet(orders, 0, 0, [{ total: 30 }], 0, 10);

    expect(sheet.refunds).toBe(30);
    expect(sheet.netSalesProfit).toBe(70);
  });
});

describe("allocateGlobalExpenseShare", () => {
  it("returns 0 when there were no org-wide sales that day", () => {
    expect(allocateGlobalExpenseShare(50, 0, 0)).toBe(0);
  });

  it("allocates proportionally to the shift's share of paid sales", () => {
    expect(allocateGlobalExpenseShare(100, 25, 100)).toBe(25);
  });
});

describe("dailyOverheadTotal", () => {
  it("converts weekly/monthly/yearly frequencies to a daily equivalent", () => {
    const total = dailyOverheadTotal([
      { amount: 7, frequency: "weekly" },
      { amount: 30, frequency: "monthly" },
      { amount: 365, frequency: "yearly" },
      { amount: 5, frequency: "daily" },
    ]);
    expect(total).toBeCloseTo(1 + 1 + 1 + 5, 5);
  });
});

describe("utcDateKey", () => {
  it("extracts the UTC calendar date from an ISO timestamp", () => {
    expect(utcDateKey("2026-06-01T23:30:00Z")).toBe("2026-06-01");
  });
});
