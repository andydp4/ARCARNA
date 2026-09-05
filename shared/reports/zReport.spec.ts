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

describe("credit on the Z-report", () => {
  const shift = {
    id: "s1",
    openingFloat: 100,
    closingCount: null,
    expectedCash: null,
    variance: null,
    openedAt: "2026-08-25T08:00:00.000Z",
    closedAt: null,
    cashierName: "Priya",
    locationName: "Front counter",
    status: "open",
    notes: null,
  };

  it("reports credit given and credit resolved without moving net sales", () => {
    const orders = [
      {
        id: "o1",
        total: 300,
        paymentMethod: "tick",
        createdAt: "2026-08-25T09:00:00.000Z",
        items: [],
      },
    ];

    const withoutCredit = buildZReport(shift, orders, []);
    const withCredit = buildZReport(
      shift,
      orders,
      [],
      [{ orderId: "o1", amountGiven: 300 }],
      [
        { amount: 120, givenOn: "2026-08-18", method: "cash" },
        { amount: 30, givenOn: "2026-08-18", method: "card" },
        { amount: 45, givenOn: "2026-08-20", method: "cash" },
      ],
    );

    expect(withCredit.creditGivenOut).toBe(300);
    expect(withCredit.creditResolved).toEqual([
      { givenOn: "2026-08-18", amount: 150 },
      { givenOn: "2026-08-20", amount: 45 },
    ]);
    // The whole point: neither line is takings for today.
    expect(withCredit.netSales).toBe(withoutCredit.netSales);
  });

  it("reports nothing rather than zeroes on a shift with no credit activity", () => {
    const report = buildZReport(shift, [], []);

    expect(report.creditGivenOut).toBe(0);
    expect(report.creditResolved).toEqual([]);
  });
});

describe("split tender", () => {
  const shift = {
    id: "s1",
    openingFloat: 100,
    closingCount: null,
    expectedCash: null,
    variance: null,
    openedAt: "2026-08-26T08:00:00.000Z",
    closedAt: null,
    cashierName: "Priya",
    locationName: "Front counter",
    status: "open",
    notes: null,
  };

  const splitOrder = {
    id: "o1",
    total: 100,
    paymentMethod: "split",
    payments: [
      { method: "cash", amount: 50 },
      { method: "tick", amount: 50 },
    ],
    createdAt: "2026-08-26T09:00:00.000Z",
    items: [],
  };

  it("shows each tender for what it actually took", () => {
    const report = buildZReport(shift, [splitOrder], []);

    expect(report.salesByPaymentMethod).toEqual([
      { method: "cash", total: 50, count: 1 },
      { method: "tick", total: 50, count: 1 },
    ]);
    expect(report.grossSales).toBe(100);
  });

  it("expects only the cash leg in the drawer", () => {
    // The whole point: £100 sold, £50 in the till. Counting the sale as £100 of
    // cash would show a £50 variance on a drawer that balanced perfectly.
    const report = buildZReport(shift, [splitOrder], []);

    expect(report.cashSummary.cashSales).toBe(50);
    expect(report.cashSummary.expectedCash).toBe(150);
  });

  it("treats an order with no legs as a single tender, as it always was", () => {
    const report = buildZReport(
      shift,
      [{ id: "o2", total: 80, paymentMethod: "card", createdAt: "2026-08-26T09:00:00.000Z", items: [] }],
      [],
    );

    expect(report.salesByPaymentMethod).toEqual([{ method: "card", total: 80, count: 1 }]);
    expect(report.cashSummary.cashSales).toBe(0);
  });
});
