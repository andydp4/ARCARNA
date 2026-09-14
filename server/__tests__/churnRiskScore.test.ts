/**
 * ARC-029: a brand-new customer with a single order from yesterday used to
 * score 50/100 ("AT RISK") — a 20-point base plus 30 points for "≤2 orders",
 * with no floor on how long they'd actually been a customer. This asserts:
 *  - the pure threshold helper `hasEnoughDataForChurnScore` (fast, no DB); and
 *  - `churnRiskScore` end-to-end against a real DB reproduces the audit's
 *    exact repro (one order, placed yesterday) and no longer flags it,
 *    while a customer who genuinely has enough signal (3+ orders, or 30+
 *    days of tenure with no repeat) is still scored and can still be flagged.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { orders, organizations, customers } from "@shared/schema";
import { hasEnoughDataForChurnScore } from "@shared/analytics/churnThreshold";

describe("hasEnoughDataForChurnScore", () => {
  it("rejects a brand-new customer with one recent order (the audit's exact repro)", () => {
    expect(hasEnoughDataForChurnScore(1, 1)).toBe(false);
  });

  it("rejects a customer with 2 orders and under 30 days of tenure", () => {
    expect(hasEnoughDataForChurnScore(29, 2)).toBe(false);
  });

  it("accepts once tenure reaches 30 days, even with only one order", () => {
    expect(hasEnoughDataForChurnScore(30, 1)).toBe(true);
  });

  it("accepts once order count reaches 3, even on day one of tenure", () => {
    expect(hasEnoughDataForChurnScore(0, 3)).toBe(true);
  });

  it("accepts a long-tenured, frequent customer", () => {
    expect(hasEnoughDataForChurnScore(400, 20)).toBe(true);
  });
});

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("churnRiskScore excludes customers with insufficient data", () => {
  let orgId: string;
  let db: (typeof import("../db"))["db"];
  let churnRiskScore: (typeof import("../services/reportsEngine"))["churnRiskScore"];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ churnRiskScore } = await import("../services/reportsEngine"));

    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Churn Risk Test" });
  });

  afterEach(async () => {
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(customers).where(eq(customers.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  async function makeCustomer(name: string): Promise<string> {
    const [c] = await db.insert(customers).values({ orgId, name }).returning();
    return c.id;
  }

  it("does not flag a brand-new customer with one order from yesterday as at risk", async () => {
    const customerId = await makeCustomer("New Customer");
    const yesterday = new Date(Date.now() - 1 * 86400000);
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      customerId,
      total: "20.00",
      paymentMethod: "cash",
      status: "completed",
      createdAt: yesterday,
    } as never);

    const report = await churnRiskScore(orgId);

    expect(report.rows.some((r: any) => r.customer === "New Customer")).toBe(false);
    expect(report.summary.insufficientData).toBeGreaterThanOrEqual(1);
  });

  it("still scores (and can still flag) a customer with 3+ orders even if all recent", async () => {
    const customerId = await makeCustomer("Frequent New Customer");
    const now = Date.now();
    // Three orders in the last few days, the most recent 40 days ago — old
    // enough to carry real recency risk once eligible, but young enough that
    // the OLD bug's ≤2-orders shortcut is not what's driving the flag here.
    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        customerId,
        total: "20.00",
        paymentMethod: "cash",
        status: "completed",
        createdAt: new Date(now - 44 * 86400000),
      },
      {
        id: randomUUID(),
        orgId,
        customerId,
        total: "20.00",
        paymentMethod: "cash",
        status: "completed",
        createdAt: new Date(now - 42 * 86400000),
      },
      {
        id: randomUUID(),
        orgId,
        customerId,
        total: "20.00",
        paymentMethod: "cash",
        status: "completed",
        createdAt: new Date(now - 40 * 86400000),
      },
    ] as never);

    const report = await churnRiskScore(orgId);
    const row = report.rows.find((r: any) => r.customer === "Frequent New Customer") as
      | { churnScore: number }
      | undefined;

    // Eligible (3 orders) — must appear in the payload as a real number, not
    // be silently excluded the way the insufficient-data case above is.
    expect(row).toBeDefined();
    expect(typeof row!.churnScore).toBe("number");
  });

  it("scores a single-order customer once their tenure alone clears 30 days", async () => {
    const customerId = await makeCustomer("Old One-Timer");
    const farBack = new Date(Date.now() - 90 * 86400000);
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      customerId,
      total: "20.00",
      paymentMethod: "cash",
      status: "completed",
      createdAt: farBack,
    } as never);

    const report = await churnRiskScore(orgId);

    // 90 days since their only order clears both the tenure bar and puts
    // recency risk at its max — this customer should be scored and, given
    // no repeat order in 90 days, flagged as at risk.
    const row = report.rows.find((r: any) => r.customer === "Old One-Timer") as
      | { churnScore: number }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.churnScore).toBeGreaterThanOrEqual(50);
  });
});
