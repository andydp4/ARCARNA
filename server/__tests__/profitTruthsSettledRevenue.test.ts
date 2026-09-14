/**
 * ARC-025 (Profit Truths / expense-reports.tsx, backed by
 * storage.getProfitAnalysis and storage.getExpenseReport):
 *  - revenue used to be every order by `created_at` with no status filter and
 *    no refund netting, same class of bug as ARC-020 — fixed onto
 *    {@link settledRevenueByDay};
 *  - COGS joined `order_items` to `orders` on that same unfiltered
 *    `created_at` window — fixed to the matching settled window; and
 *  - an expense category that nets to zero divided by a zero total and
 *    rendered "NaN%" on the pie chart — fixed to a guarded 0%.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { orders, organizations, orderItems, products, overheadExpenses } from "@shared/schema";
import { storage } from "../storage";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("Profit Truths matches the settled-revenue definition", () => {
  let orgId: string;
  let db: (typeof import("../db"))["db"];
  let settledRevenueByDay: (typeof import("../services/revenue"))["settledRevenueByDay"];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ settledRevenueByDay } = await import("../services/revenue"));
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Profit Truths Test" });
  });

  afterEach(async () => {
    await db.delete(orderItems).where(eq(orderItems.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(products).where(eq(products.orgId, orgId));
    await db.delete(overheadExpenses).where(eq(overheadExpenses.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("revenue excludes a pending order and matches settledRevenueByDay for the same range", async () => {
    await db.insert(orders).values([
      {
        id: randomUUID(),
        orgId,
        total: "300.00",
        paymentMethod: "cash",
        status: "completed",
        settledTotal: "300.00",
        settledAt: new Date("2026-01-15T10:00:00.000Z"),
      },
      {
        id: randomUUID(),
        orgId,
        total: "4000.00",
        paymentMethod: "cash",
        status: "pending",
        createdAt: new Date("2026-01-15T11:00:00.000Z"),
      },
    ] as never);

    const analysis = await storage.getProfitAnalysis(
      new Date("2026-01-15T00:00:00.000Z"),
      new Date("2026-01-15T23:59:59.999Z"),
      orgId,
    );
    const expected = await settledRevenueByDay(orgId, "2026-01-15", "2026-01-15");

    expect(expected.get("2026-01-15")?.revenue).toBe(300);
    expect(analysis.summary.revenue).toBe(300);
    expect(analysis.summary.orderCount).toBe(1);
    expect(analysis.summary.vatTreatment).toBe("incl. VAT");
  });

  it("COGS is scoped to the settled order, not any order in the created_at window", async () => {
    const productId = randomUUID();
    const settledOrderId = randomUUID();
    const pendingOrderId = randomUUID();

    await db.insert(products).values({
      id: productId,
      orgId,
      name: "Profit Test Widget",
      productId: `PTW-${productId}`,
      defaultSalePrice: "20.00",
      costPrice: "5.00",
    } as never);

    await db.insert(orders).values([
      {
        id: settledOrderId,
        orgId,
        total: "20.00",
        paymentMethod: "cash",
        status: "completed",
        settledTotal: "20.00",
        settledAt: new Date("2026-01-15T10:00:00.000Z"),
      },
      {
        // Still open — its line item must not add to COGS for this range.
        id: pendingOrderId,
        orgId,
        total: "200.00",
        paymentMethod: "cash",
        status: "pending",
        createdAt: new Date("2026-01-15T11:00:00.000Z"),
      },
    ] as never);
    await db.insert(orderItems).values([
      { orgId, orderId: settledOrderId, productId, quantity: "1", unitPrice: "20.00", totalPrice: "20.00" },
      { orgId, orderId: pendingOrderId, productId, quantity: "10", unitPrice: "20.00", totalPrice: "200.00" },
    ] as never);

    const analysis = await storage.getProfitAnalysis(
      new Date("2026-01-15T00:00:00.000Z"),
      new Date("2026-01-15T23:59:59.999Z"),
      orgId,
    );

    // 1 unit at £5 cost, not 11 units.
    expect(analysis.summary.cogs).toBe(5);
    expect(analysis.summary.grossProfit).toBe(15);
  });

  it("guards an empty expense category against divide-by-zero (no NaN%)", async () => {
    await db.insert(overheadExpenses).values({
      id: randomUUID(),
      orgId,
      name: "Comped marketing spend",
      category: "Marketing",
      amount: "0.00",
      frequency: "daily",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      isActive: 1,
    } as never);

    const report = await storage.getExpenseReport(
      new Date("2026-01-15T00:00:00.000Z"),
      new Date("2026-01-15T23:59:59.999Z"),
      orgId,
    );

    const marketing = report.overheadByCategory.find((c: any) => c.category === "Marketing");
    expect(marketing).toBeDefined();
    expect(Number.isNaN(marketing.percentage)).toBe(false);
    expect(marketing.percentage).toBe(0);
  });
});
