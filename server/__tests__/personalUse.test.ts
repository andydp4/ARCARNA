/**
 * Personal use — staff taking stock for themselves.
 *
 * It is allowed and is not blocked at the till. The control is that it cannot
 * happen quietly: it is never a sale, it earns nobody commission, its cost
 * lands on the day's expenses, and a Signal names who took which products
 * and why — never what they cost (v1.2 Phase 0B).
 *
 * The Signal is the whole point, so the worker is tested for the case that
 * actually matters — that it does not fire twice for one event, and that it
 * carries enough for a manager to judge it without opening anything.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildCashierShiftBalanceSheet } from "@shared/reports/cashierShiftReport";

const inserted: Array<{ table: string; values: any }> = [];
const signals: any[] = [];
let alreadyProcessed: unknown[] = [];
let orderLines: Array<{ qty: number; name: string | null }> = [];

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => alreadyProcessed }),
        leftJoin: () => ({ where: async () => orderLines }),
      }),
    }),
    insert: (table: any) => ({
      values: async (values: any) => {
        inserted.push({ table: table?.[Symbol.for("drizzle:Name")] ?? "unknown", values });
      },
    }),
  },
}));

vi.mock("../services/signals", () => ({
  notify: async (input: any) => {
    signals.push(input);
    return { id: "sig-1", recipients: [] };
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
    cashierUserId: "user-priya",
    reason: "staff lunch",
    items: [{ name: "Sandwich", qty: 2 }],
  },
};

beforeEach(() => {
  inserted.length = 0;
  signals.length = 0;
  alreadyProcessed = [];
  orderLines = [];
});

describe("the personal-use Signal", () => {
  it("names who took which products and why", async () => {
    const result = await new PersonalUseSignalWorker().handle(event as any);

    expect(result.status).toBe("success");
    expect(signals).toHaveLength(1);
    const signal = signals[0];
    expect(signal.source).toBe("personal_use");
    expect(signal.title).toBe("Personal use — Priya");
    expect(signal.message).toContain("Priya");
    expect(signal.message).toContain("2 × Sandwich");
    expect(signal.message).toContain("staff lunch");
    expect(signal.severity).toBe("warning");
  });

  it("shows no cost, even when an old event still carries one", async () => {
    const old = { ...event, payload: { ...event.payload, stockCost: 13.37 } };
    await new PersonalUseSignalWorker().handle(old as any);

    const text = JSON.stringify(signals[0]);
    expect(text).not.toContain("13.37");
    expect(text).not.toContain("£");
    expect(text).not.toMatch(/cost/i);
  });

  it("names the member of staff as its subject, so it goes to people who outrank them", async () => {
    await new PersonalUseSignalWorker().handle(event as any);
    expect(signals[0].subjectUserId).toBe("user-priya");
    expect(signals[0].tellSubject).toBeUndefined();
  });

  it("reads product names from the order when the event carries only quantities", async () => {
    orderLines = [{ qty: 1, name: "Cola 330ml" }, { qty: 3, name: "Crisps" }];
    const legacy = { ...event, payload: { ...event.payload, items: [{ qty: 1 }, { qty: 3 }] } };
    await new PersonalUseSignalWorker().handle(legacy as any);

    expect(signals[0].message).toContain("1 × Cola 330ml, 3 × Crisps");
  });

  it("says so plainly when no reason was given", async () => {
    const noReason = { ...event, payload: { ...event.payload, reason: undefined } };
    await new PersonalUseSignalWorker().handle(noReason as any);

    expect(signals[0].message).toContain("No reason was given");
  });

  it("does not signal twice for the same event", async () => {
    alreadyProcessed = [{ eventId: "evt-1" }];
    const result = await new PersonalUseSignalWorker().handle(event as any);

    expect(result.status).toBe("already_processed");
    expect(signals).toHaveLength(0);
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
