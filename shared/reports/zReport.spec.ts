import { describe, it, expect } from "vitest";
import { buildZReport, computeExpectedCash } from "./zReport";

const baseShift = {
  id: "shift-1",
  openingFloat: 50,
  closingCount: 200,
  expectedCash: null,
  variance: null,
  openedAt: "2026-06-01T09:00:00Z",
  closedAt: "2026-06-01T17:00:00Z",
  cashierName: "Alex",
  locationName: "Main",
  status: "closed",
};

describe("buildZReport", () => {
  it("aggregates sales, refunds, and payment methods", () => {
    const orders = [
      {
        id: "o1",
        total: 100,
        paymentMethod: "cash",
        createdAt: "2026-06-01T10:00:00Z",
        items: [
          {
            productId: "p1",
            productName: "Widget",
            sku: "W-1",
            category: "Tools",
            quantity: 2,
            lineTotal: 100,
          },
        ],
      },
      {
        id: "o2",
        total: 50,
        paymentMethod: "card",
        createdAt: "2026-06-01T11:00:00Z",
        items: [
          {
            productId: "p2",
            productName: "Gadget",
            sku: "G-1",
            quantity: 1,
            lineTotal: 50,
          },
        ],
      },
    ];
    const refunds = [
      {
        id: "r1",
        total: 20,
        refundMethod: "cash",
        createdAt: "2026-06-01T12:00:00Z",
      },
    ];

    const report = buildZReport(baseShift, orders, refunds);

    expect(report.orderCount).toBe(2);
    expect(report.grossSales).toBe(150);
    expect(report.refundsTotal).toBe(20);
    expect(report.netSales).toBe(130);
    expect(report.salesByPaymentMethod).toHaveLength(2);
    expect(report.cashSummary.cashSales).toBe(100);
    expect(report.cashSummary.cashRefunds).toBe(20);
    expect(report.topSkus[0].sku).toBe("W-1");
  });

  it("computes variance from counted cash", () => {
    const expected = computeExpectedCash(
      50,
      [
        {
          id: "o1",
          total: 100,
          paymentMethod: "cash",
          createdAt: "",
          items: [],
        },
      ],
      [{ id: "r1", total: 10, refundMethod: "cash", createdAt: "" }],
    );
    expect(expected).toBe(140);

    const report = buildZReport(
      { ...baseShift, closingCount: 145, expectedCash: expected },
      [
        {
          id: "o1",
          total: 100,
          paymentMethod: "cash",
          createdAt: "",
          items: [],
        },
      ],
      [{ id: "r1", total: 10, refundMethod: "cash", createdAt: "" }],
    );
    expect(report.cashSummary.variance).toBe(5);
  });
});
