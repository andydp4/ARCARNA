/**
 * Personal use — staff taking stock for themselves.
 *
 * It is allowed and is not blocked at the till. The control is that it cannot
 * happen quietly: it is never a sale, it earns nobody commission, its cost
 * lands on the day's expenses, and a Signal names who took what and why.
 *
 * The Signal is the whole point, so the worker is tested for the case that
 * actually matters — that it does not fire twice for one event, and that it
 * carries enough for a manager to judge it without opening anything.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildCashierShiftBalanceSheet } from "@shared/reports/cashierShiftReport";

const inserted: Array<{ table: string; values: any }> = [];
let alreadyProcessed: unknown[] = [];

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => alreadyProcessed }) }),
    }),
    insert: (table: any) => ({
      values: async (values: any) => {
        inserted.push({ table: table?.[Symbol.for("drizzle:Name")] ?? "unknown", values });
      },
    }),
  },
}));

const { PersonalUseSignalWorker } = await import("../workers/personalUseSignalWorker");

const event = {
  eventId: "evt-1",
  eventType: "PersonalUseRecorded" as const,
  aggregateId: "order-1",
  occurredAt: new Date().toISOString(),
  correlationId: "corr-1",
  version: 1,
  payload: {
    orgId: "org-1",
    orderId: "order-1",
    cashierName: "Priya",
    reason: "staff lunch",
    stockCost: 14.2,
    items: [{ name: "Sandwich", qty: 2 }],
  },
};

beforeEach(() => {
  inserted.length = 0;
  alreadyProcessed = [];
});

describe("the personal-use Signal", () => {
  it("names who took what, what it cost and why", async () => {
    const result = await new PersonalUseSignalWorker().handle(event as any);

    expect(result.status).toBe("success");
    const signal = inserted.find((i) => i.values.source === "personal_use");
    expect(signal).toBeDefined();
    expect(signal!.values.title).toBe("Personal use — £14.20");
    expect(signal!.values.message).toContain("Priya");
    expect(signal!.values.message).toContain("2 × Sandwich");
    expect(signal!.values.message).toContain("£14.20");
    expect(signal!.values.message).toContain("staff lunch");
    expect(signal!.values.severity).toBe("warning");
  });

  it("says so plainly when no reason was given", async () => {
    const noReason = { ...event, payload: { ...event.payload, reason: undefined } };
    await new PersonalUseSignalWorker().handle(noReason as any);

    const signal = inserted.find((i) => i.values.source === "personal_use");
    expect(signal!.values.message).toContain("No reason was given");
  });

  it("does not signal twice for the same event", async () => {
    alreadyProcessed = [{ eventId: "evt-1" }];
    const result = await new PersonalUseSignalWorker().handle(event as any);

    expect(result.status).toBe("already_processed");
    expect(inserted).toHaveLength(0);
  });
});

describe("personal use in the shift figures", () => {
  const items = [{ quantity: 2, costPrice: 5 }];

  it("is not a sale, and does not touch takings or the payment breakdown", () => {
    const sheet = buildCashierShiftBalanceSheet(
      [
        {
          id: "sale",
          total: 100,
          paymentMethod: "cash",
          status: "completed",
          createdAt: "2026-08-25T10:00:00.000Z",
          creditOutstanding: 0,
          items: [{ quantity: 1, costPrice: 40 }],
        },
        {
          id: "staff",
          total: 0,
          paymentMethod: "personal_use",
          status: "completed",
          createdAt: "2026-08-25T11:00:00.000Z",
          creditOutstanding: 0,
          items,
        },
      ],
      0,
      0,
      [],
      0,
      10,
    );

    expect(sheet.grossSales).toBe(100);
    expect(sheet.cashSales).toBe(100);
    // The goods it took are costed on their own line, not mixed into the stock
    // cost of things that were actually sold.
    expect(sheet.stockCost).toBe(40);
    expect(sheet.personalUseCost).toBe(10);
  });

  it("earns nobody commission", () => {
    const sheet = buildCashierShiftBalanceSheet(
      [
        {
          id: "staff",
          total: 0,
          paymentMethod: "personal_use",
          status: "completed",
          createdAt: "2026-08-25T11:00:00.000Z",
          creditOutstanding: 0,
          items,
        },
      ],
      0,
      0,
      [],
      0,
      10,
    );

    expect(sheet.grossSales).toBe(0);
    expect(sheet.commissionAmount).toBe(0);
  });
});
