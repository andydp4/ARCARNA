/**
 * Charged = recorded (v1.2 Phase 1B) against a real database.
 *
 * The server prices every till sale with the same priceOrder() the till shows,
 * inside the sale's transaction and before any payment leg is written: tier %,
 * a promotion checked and counted inside the sale, points taken after VAT
 * (owner Q2). Every tender must add up to that price; the order stores the
 * breakdown; the shift's discounts figure and the loyalty earned follow from
 * it. In CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("a till sale is charged what it is recorded at", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgId = randomUUID();
  let locationId = "";
  let productId = "";
  let silverId = "";
  const tag = randomUUID().slice(0, 8);
  const userId = `pricing-cashier-${tag}`;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    const s = schema;
    // Commission on, so sales join a cashier shift and the shift sheet can be read.
    await db
      .insert(s.organizations)
      .values({ id: orgId, name: "ZZ Sale Pricing Test", defaultTaxRate: "0", cashierCommissionEnabled: true });
    const [loc] = await db
      .insert(s.locations)
      .values({
        orgId,
        name: "Pricing Shop",
        address: "1 Test Street",
        city: "Testville",
        state: "TS",
        zipCode: "TS1",
        phone: "0000000000",
        email: "shop@example.com",
        isDefault: 1,
        isActive: 1,
      })
      .returning();
    locationId = loc.id;
    const [prod] = await db
      .insert(s.products)
      .values({
        orgId,
        locationId,
        name: "Pricing Widget",
        productId: `PRICE-${tag}`,
        defaultSalePrice: "25.00",
        costPrice: "10.00",
        stock: 1000,
        stockLimit: 5,
      })
      .returning();
    productId = prod.id;
    await db.insert(s.productLocationStock).values({ orgId, productId, locationId, stock: 1000 });
    await db.insert(s.allowedUsers).values({
      replitUserId: userId,
      authUserId: userId,
      name: "Pricing Cashier",
      role: "CASHIER" as any,
      orgId,
    });
    await db.insert(s.loyaltyTiers).values({ orgId, name: "Bronze", pointsRequired: 0, discountPercentage: "0" });
    const [silver] = await db
      .insert(s.loyaltyTiers)
      .values({ orgId, name: "Silver", pointsRequired: 500, discountPercentage: "10" })
      .returning();
    silverId = silver.id;
    await db.insert(s.loyaltySettings).values({ orgId, redemptionRate: "0.01", minRedeemPoints: 100 });

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId, role: "CASHIER" };
      req.user = { id: userId, role: "CASHIER", claims: { sub: userId } };
      next();
    };
    const { registerOrderRoutes } = await import("../routes/orders");
    app = express();
    app.use(express.json());
    registerOrderRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    const { sql } = await import("drizzle-orm");
    // Rows keyed by order rather than org: the outbox has no org, and the
    // loyalty worker's earn rows carry none.
    for (const statement of [
      `DELETE FROM event_outbox WHERE correlation_id IN (SELECT id::text FROM orders WHERE org_id = '${orgId}')`,
      `DELETE FROM loyalty_ledger WHERE order_id IN (SELECT id FROM orders WHERE org_id = '${orgId}')`,
      `DELETE FROM commission_ledger WHERE org_id = '${orgId}'`,
    ]) {
      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        console.warn("[salePricing] cleanup", statement, (e as Error).message);
      }
    }
    for (const table of [
      "loyalty_ledger",
      "order_events",
      "order_payments",
      "order_credit",
      "order_expenses",
      "order_items",
      "inventory_movements",
      "ops_alerts",
      "orders",
      "cashier_shifts",
      "shifts",
      "promotions",
      "customers",
      "loyalty_tiers",
      "loyalty_settings",
      "product_location_stock",
      "products",
      "locations",
    ]) {
      try {
        await db.execute(sql.raw(`DELETE FROM ${table} WHERE org_id = '${orgId}'`));
      } catch (e) {
        console.warn("[salePricing] cleanup", table, (e as Error).message);
      }
    }
    const { eq } = await import("drizzle-orm");
    await db.delete(schema.allowedUsers).where(eq(schema.allowedUsers.replitUserId, userId));
    try {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    } catch (e) {
      console.warn("[salePricing] could not remove the test org", (e as Error).message);
    }
  });

  /** Two £25 widgets: £50 before anything comes off. */
  const sale = (extra: Record<string, unknown> = {}) => ({
    clientOrderId: randomUUID(),
    lines: [{ productId, quantity: 2, unitPrice: 25 }],
    paymentMethod: "cash",
    ...extra,
  });
  const post = (body: Record<string, unknown>) => request(app).post("/api/orders").send(body);

  async function customer(points: number) {
    const [c] = await db
      .insert(schema.customers)
      .values({ orgId, name: `Pricing Customer ${randomUUID().slice(0, 6)}`, loyaltyPoints: points })
      .returning();
    return c;
  }
  async function promotion(over: Partial<typeof schema.promotions.$inferInsert> = {}) {
    const [p] = await db
      .insert(schema.promotions)
      .values({
        orgId,
        name: "Five off",
        code: `FIVE${randomUUID().slice(0, 6).toUpperCase()}`,
        type: "fixed",
        value: "5.00",
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
        isActive: 1,
        ...over,
      })
      .returning();
    return p;
  }
  async function orderRow(id: string) {
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    return row;
  }
  async function legs(id: string) {
    const { eq } = await import("drizzle-orm");
    return db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, id));
  }
  async function pointsOf(customerId: string) {
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ loyaltyPoints: schema.customers.loyaltyPoints })
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId));
    return row.loyaltyPoints;
  }

  it("a 10% loyalty sale paid by split tender goes through, and every leg adds up to what was charged", async () => {
    const c = await customer(600);
    const res = await post(
      sale({
        customerId: c.id,
        payments: [
          { method: "cash", amount: 20 },
          { method: "card", amount: 25 },
        ],
        expectedTotal: 45,
      }),
    ).expect(201);
    expect(res.body.order.total).toBe("45.00");
    expect(res.body.order.tierDiscount).toBe(5);

    const row = await orderRow(res.body.orderId);
    expect(row.subtotal).toBe("50.00");
    expect(row.tierDiscount).toBe("5.00");
    expect(row.tierDiscountPercent).toBe("10.00");
    expect(row.vatRate).toBe("0.00");
    expect(row.vatAmount).toBe("0.00");
    expect(row.total).toBe("45.00");
    const paid = await legs(row.id);
    expect(paid.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(45);
  });

  it("refuses a split that adds up to the list price instead of the discounted one", async () => {
    const c = await customer(600);
    const res = await post(
      sale({ customerId: c.id, payments: [{ method: "cash", amount: 25 }, { method: "card", amount: 25 }] }),
    ).expect(422);
    expect(res.body.message).toMatch(/Payments add up to £50\.00 but the order is £45\.00/);
  });

  it("a points sale on tick puts the amount charged on credit, after VAT (owner Q2)", async () => {
    const { eq } = await import("drizzle-orm");
    await db.update(schema.organizations).set({ defaultTaxRate: "20" }).where(eq(schema.organizations.id, orgId));
    try {
      const c = await customer(600);
      // £50 − 10% tier = £45 net; VAT £9 → £54; 500 points = £5 off → £49.
      const res = await post(sale({ customerId: c.id, paymentMethod: "tick", redeemPoints: 500, expectedTotal: 49 })).expect(201);
      const row = await orderRow(res.body.orderId);
      expect(row.total).toBe("49.00");
      expect(row.vatAmount).toBe("9.00");
      expect(row.vatRate).toBe("20.00");
      expect(row.pointsRedeemed).toBe(500);
      expect(row.pointsDiscount).toBe("5.00");
      const paid = await legs(row.id);
      expect(paid).toHaveLength(1);
      expect(paid[0].method).toBe("tick");
      expect(paid[0].amount).toBe("49.00");

      // What the Credit List will carry once the goods leave.
      const { creditLegTotal } = await import("../services/creditLedger");
      expect(await creditLegTotal(row.id, "tick", Number(row.total))).toBe(49);

      expect(await pointsOf(c.id)).toBe(100);
      const ledger = await db.select().from(schema.loyaltyLedger).where(eq(schema.loyaltyLedger.orderId, row.id));
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ reason: "redeem", pointsDelta: -500, previousBalance: 600, newBalance: 100 });
    } finally {
      await db.update(schema.organizations).set({ defaultTaxRate: "0" }).where(eq(schema.organizations.id, orgId));
    }
  });

  it("loyalty is earned on what was paid", async () => {
    const c = await customer(600);
    const res = await post(sale({ customerId: c.id, redeemPoints: 500, expectedTotal: 40 })).expect(201);
    const { and, eq } = await import("drizzle-orm");
    const [event] = await db
      .select()
      .from(schema.eventOutbox)
      .where(and(eq(schema.eventOutbox.correlationId, res.body.orderId), eq(schema.eventOutbox.eventType, "OrderCreated")));
    expect(event).toBeTruthy();
    expect((event.payload as { order: { total: number } }).order.total).toBe(40);

    const { LoyaltyWorker } = await import("../workers/loyaltyWorker");
    const result = await new LoyaltyWorker().handle({
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      occurredAt: event.occurredAt.toISOString(),
      payload: event.payload,
    } as never);
    expect(result.status).toBe("success");
    // 600 − 500 spent + 40 earned on the £40 actually paid.
    expect(await pointsOf(c.id)).toBe(140);
  });

  it("two sales cannot spend the same points", async () => {
    const c = await customer(600);
    const answers = await Promise.all(
      [1, 2].map(() => post(sale({ customerId: c.id, redeemPoints: 500, expectedTotal: 40 }))),
    );
    expect(answers.map((a) => a.status).sort()).toEqual([201, 422]);
    expect(await pointsOf(c.id)).toBe(100);
  });

  it("a promotion is checked and counted inside the sale, and its last use goes once", async () => {
    const promo = await promotion({ usageLimit: 1 });
    const first = await post(sale({ promoCode: promo.code, expectedTotal: 45 })).expect(201);
    const row = await orderRow(first.body.orderId);
    expect(row.promotionId).toBe(promo.id);
    expect(row.promoCode).toBe(promo.code);
    expect(row.promoDiscount).toBe("5.00");
    expect(row.total).toBe("45.00");

    const second = await post(sale({ promoCode: promo.code, expectedTotal: 45 })).expect(422);
    expect(second.body.message).toMatch(/used up/);
    const { eq } = await import("drizzle-orm");
    const [after] = await db.select().from(schema.promotions).where(eq(schema.promotions.id, promo.id));
    expect(after.usageCount).toBe(1);
  });

  it("refuses an expired promotion, one below its minimum spend, and a members' one for a non-member", async () => {
    const expired = await promotion({ endDate: new Date(Date.now() - 60_000) });
    expect((await post(sale({ promoCode: expired.code })).expect(422)).body.message).toMatch(/expired/);
    const minSpend = await promotion({ minPurchase: "60.00" });
    expect((await post(sale({ promoCode: minSpend.code })).expect(422)).body.message).toMatch(/£60\.00/);
    const members = await promotion({ tierRequired: silverId });
    const walkIn = await customer(0);
    expect((await post(sale({ customerId: walkIn.id, promoCode: members.code })).expect(422)).body.message).toMatch(/Silver/);
    const { eq } = await import("drizzle-orm");
    const [unused] = await db.select().from(schema.promotions).where(eq(schema.promotions.id, members.id));
    expect(unused.usageCount).toBe(0);
  });

  it("parity: the till's priceOrder() and the recorded order agree on every figure", async () => {
    const { eq } = await import("drizzle-orm");
    await db.update(schema.organizations).set({ defaultTaxRate: "20" }).where(eq(schema.organizations.id, orgId));
    try {
      const c = await customer(750);
      const promo = await promotion({ type: "percentage", value: "12.5", maxDiscount: "6.00" });
      const lines = [
        { productId, quantity: 3, unitPrice: 7.99 },
        { productId, quantity: 0.4, unitPrice: 12.35 },
      ];
      // Exactly what the till computes, from the same data it holds.
      const { priceOrder } = await import("@shared/pricing/priceOrder");
      const tiers = await db.select().from(schema.loyaltyTiers).where(eq(schema.loyaltyTiers.orgId, orgId));
      const till = priceOrder({
        lines,
        taxRatePercent: 20,
        customer: { loyaltyPoints: 750 },
        tiers,
        promotion: promo,
        points: { points: 300, redemptionRate: 0.01, minRedeemPoints: 100, balance: 750 },
      });
      const res = await post(
        sale({ lines, customerId: c.id, promoCode: promo.code, redeemPoints: 300, expectedTotal: till.total }),
      ).expect(201);
      const row = await orderRow(res.body.orderId);
      const money = (n: number) => n.toFixed(2);
      expect(row.subtotal).toBe(money(till.subtotal));
      expect(row.tierDiscount).toBe(money(till.tierDiscount));
      expect(row.promoDiscount).toBe(money(till.promoDiscount));
      expect(row.vatAmount).toBe(money(till.vatAmount));
      expect(row.pointsDiscount).toBe(money(till.pointsDiscount));
      expect(row.total).toBe(money(till.total));
      // And the breakdown adds up to the total it explains.
      expect(
        Math.round(
          (Number(row.subtotal) - Number(row.tierDiscount) - Number(row.promoDiscount) + Number(row.vatAmount) - Number(row.pointsDiscount)) * 100,
        ) / 100,
      ).toBe(Number(row.total));
      const paid = await legs(row.id);
      expect(paid.map((l) => l.amount)).toEqual([money(till.total)]);
    } finally {
      await db.update(schema.organizations).set({ defaultTaxRate: "0" }).where(eq(schema.organizations.id, orgId));
    }
  });

  it("refuses a sale whose price changed since the till showed it", async () => {
    const res = await post(sale({ expectedTotal: 45 })).expect(422);
    expect(res.body.message).toMatch(/till showed £45\.00 but the price is now £50\.00/);
  });

  it("the shift's discounts figure is what was taken off, and commission is not cut by it twice", async () => {
    const c = await customer(600);
    const promo = await promotion();
    const res = await post(sale({ customerId: c.id, promoCode: promo.code, expectedTotal: 40 })).expect(201);
    const row = await orderRow(res.body.orderId);
    expect(row.cashierShiftId).toBeTruthy();
    const { eq } = await import("drizzle-orm");
    const [shift] = await db.select().from(schema.cashierShifts).where(eq(schema.cashierShifts.id, row.cashierShiftId!));
    const { computeCashierShiftBalanceSheet } = await import("../services/cashierShiftEngine");
    const { sheet } = await computeCashierShiftBalanceSheet(orgId, shift);
    const { sql } = await import("drizzle-orm");
    const [expected] = (
      await db.execute(sql`
        SELECT COALESCE(SUM(COALESCE(tier_discount,0) + COALESCE(promo_discount,0) + COALESCE(points_discount,0)), 0)::float AS d,
               COALESCE(SUM(total), 0)::float AS t
        FROM orders WHERE COALESCE(completed_cashier_shift_id, cashier_shift_id) = ${shift.id}`)
    ).rows as Array<{ d: number; t: number }>;
    expect(sheet.discounts).toBeGreaterThanOrEqual(10);
    expect(sheet.discounts).toBe(Math.round(expected.d * 100) / 100);
    expect(sheet.grossSales).toBe(Math.round(expected.t * 100) / 100);
  });
});
