/**
 * Order-line snapshots, silent underpricing and "Would have flagged"
 * (v1.2 Phase 2: PRC-06, PRC-03, CMP-03) against a real database, through the
 * real engine wiring, the real routes and the real reports.
 *
 * Runs in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("snapshots, silent recording and Would have flagged", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let engine: (typeof import("../../apps/server/src/engine.wiring"))["engine"];
  let withTransaction: (typeof import("../../apps/server/src/db"))["withTransaction"];
  let app: express.Express;
  let role = "ADMIN";
  const orgId = randomUUID();
  const cashierId = `test-pe-cashier-${randomUUID().slice(0, 8)}`;
  const managerId = `test-pe-manager-${randomUUID().slice(0, 8)}`;
  let locationId: string;
  let productId: string;
  let freeProductId: string;
  let costlyProductId: string;
  const orderIds: string[] = [];

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    ({ engine } = await import("../../apps/server/src/engine.wiring"));
    ({ withTransaction } = await import("../../apps/server/src/db"));

    await db.insert(schema.organizations).values({ id: orgId, name: "ZZ Price Exceptions Test" });
    const [loc] = await db
      .insert(schema.locations)
      .values({
        orgId,
        name: "Main",
        address: "1 Test Street",
        city: "Testville",
        state: "TS",
        zipCode: "TS1",
        phone: "0000000000",
        email: "loc@example.com",
        isDefault: 1,
      })
      .returning();
    locationId = loc.id;
    await db.insert(schema.users).values([
      { id: cashierId, orgId, role: "CASHIER", firstName: "Casey", lastName: "Till", email: `${cashierId}@example.com` },
      { id: managerId, orgId, role: "MANAGER", firstName: "Morgan", lastName: "Boss", email: `${managerId}@example.com` },
    ]);
    const [p] = await db
      .insert(schema.products)
      .values({ orgId, name: "Widget", productId: `PE-${randomUUID().slice(0, 8)}`, defaultSalePrice: "5.00", minPrice: "4.00", costPrice: "3.00" })
      .returning();
    productId = p.id;
    const [free] = await db
      .insert(schema.products)
      .values({ orgId, name: "No Cost Thing", productId: `PE-${randomUUID().slice(0, 8)}`, defaultSalePrice: "2.00" })
      .returning();
    freeProductId = free.id;
    // A minimum below cost (allowed, with a warning): the only case where a
    // cost leaking into the till's floor would show.
    const [costly] = await db
      .insert(schema.products)
      .values({ orgId, name: "Costly", productId: `PE-${randomUUID().slice(0, 8)}`, defaultSalePrice: "5.00", minPrice: "2.00", costPrice: "3.00" })
      .returning();
    costlyProductId = costly.id;

    const scoped: RequestHandler = (req: any, _res, next) => {
      const id = role === "CASHIER" ? cashierId : managerId;
      req.orgContext = { orgId, locationId, role };
      req.user = { id, role, claims: { sub: id } };
      next();
    };
    const { registerPriceExceptionRoutes } = await import("../routes/priceExceptions");
    const { registerProductRoutes } = await import("../routes/products");
    app = express();
    app.use(express.json());
    registerPriceExceptionRoutes(app, [scoped]);
    registerProductRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.priceExceptions).where(eq(schema.priceExceptions.orgId, orgId));
    if (orderIds.length) {
      await db.delete(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds));
      await db.delete(schema.orders).where(inArray(schema.orders.id, orderIds));
    }
    await db.delete(schema.cashierShifts).where(eq(schema.cashierShifts.orgId, orgId));
    await db.delete(schema.inventoryMovements).where(eq(schema.inventoryMovements.orgId, orgId));
    await db.delete(schema.productLocationStock).where(eq(schema.productLocationStock.orgId, orgId));
    await db.delete(schema.productPriceHistory).where(eq(schema.productPriceHistory.orgId, orgId));
    await db.delete(schema.products).where(eq(schema.products.orgId, orgId));
    await db.delete(schema.users).where(inArray(schema.users.id, [cashierId, managerId]));
    await db.delete(schema.locations).where(eq(schema.locations.orgId, orgId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  async function place(
    lines: Array<{ productId: string; quantity: number; unitPrice: number }>,
    extra: Record<string, unknown> = {},
    context: { pricedAtList?: boolean } = {},
  ) {
    const { orderId } = await withTransaction(() =>
      engine.placeOrder(
        { orgId, locationId, paymentMethod: "cash", channel: "pos", lines, ...extra },
        undefined,
        { actorUserId: cashierId, ...context },
      ),
    );
    orderIds.push(orderId);
    return orderId;
  }

  async function items(orderId: string) {
    return db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
  }

  async function exceptions(orderId: string) {
    return db.select().from(schema.priceExceptions).where(eq(schema.priceExceptions.orderId, orderId));
  }

  it("snapshots list price, minimum and known cost on each line", async () => {
    const orderId = await place([
      { productId, quantity: 1, unitPrice: 5 },
      { productId: freeProductId, quantity: 1, unitPrice: 2 },
    ]);
    const rows = await items(orderId);
    const widget = rows.find((r) => r.productId === productId)!;
    const other = rows.find((r) => r.productId === freeProductId)!;
    expect([widget.listPrice, widget.floorPrice, widget.unitCost]).toEqual(["5.00", "4.00", "3.00"]);
    expect([other.listPrice, other.floorPrice, other.unitCost]).toEqual(["2.00", "2.00", null]);
    expect(await exceptions(orderId)).toHaveLength(0);
  });

  it("a below-minimum sale completes and is recorded, never blocked", async () => {
    const orderId = await place([{ productId, quantity: 2, unitPrice: 3.5 }]);
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order).toBeTruthy();
    const rows = await exceptions(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId,
      userId: cashierId,
      source: "sale",
      channel: "pos",
      unitPrice: "3.50",
      listPrice: "5.00",
      floorPrice: "4.00",
      unitCost: "3.00",
      belowMinimum: true,
      belowCost: false,
      underList: "3.00",
      underCost: "0.00",
    });
  });

  it("below cost is recorded with £ under cost", async () => {
    const orderId = await place([{ productId, quantity: 1, unitPrice: 2.5 }]);
    const [row] = await exceptions(orderId);
    expect(row).toMatchObject({ belowCost: true, underCost: "0.50", underList: "2.50" });
  });

  it("website orders are not recorded (the server's checkout says so, not the channel)", async () => {
    const orderId = await place(
      [{ productId, quantity: 1, unitPrice: 1 }],
      { channel: "web", paymentMethod: "transfer" },
      { pricedAtList: true },
    );
    expect(await exceptions(orderId)).toHaveLength(0);
  });

  it("a failed recording rolls back to its savepoint and the sale's transaction still commits", async () => {
    const { PriceExceptionsDrizzle } = await import("../../apps/server/src/db/priceExceptions");
    const { order_items } = await import("../../apps/server/src/db/schema");
    const { getDb } = await import("../../apps/server/src/db");
    const orderId = await place([{ productId, quantity: 1, unitPrice: 5 }]);
    await withTransaction(async () => {
      await expect(
        PriceExceptionsDrizzle.record([
          {
            orgId,
            orderId,
            productId,
            userId: null,
            source: "bogus" as any, // violates the CHECK constraint
            channel: "pos",
            quantity: 1,
            unitPrice: 1,
            listPrice: 5,
            floorPrice: 4,
            unitCost: 3,
            belowMinimum: true,
            belowCost: true,
            underList: 4,
            underCost: 2,
          },
        ]),
      ).rejects.toThrow();
      // Postgres would refuse this with "current transaction is aborted"
      // had the failed insert not been under a savepoint.
      await getDb()
        .update(order_items)
        .set({ quantity: 3 })
        .where(eq(order_items.order_id, orderId));
    });
    const [line] = await items(orderId);
    expect(line.quantity).toBe(3);
    expect(await exceptions(orderId)).toHaveLength(0);
  });

  it("Would have flagged shows it by product and person, admins only", async () => {
    role = "ADMIN";
    const res = await request(app).get("/api/price-exceptions/would-have-flagged").expect(200);
    const widget = res.body.byProduct.find((g: any) => g.key === productId);
    expect(widget).toMatchObject({ name: "Widget", lines: 2, belowMinimum: 2, belowCost: 1, underList: 5.5, underCost: 0.5 });
    const casey = res.body.byPerson.find((g: any) => g.key === cashierId);
    expect(casey).toMatchObject({ name: "Casey Till", lines: 2, underList: 5.5, underCost: 0.5 });
    expect(res.body.totals).toMatchObject({ lines: 2, underList: 5.5, underCost: 0.5 });

    role = "MANAGER";
    await request(app).get("/api/price-exceptions/would-have-flagged").expect(403);
    role = "CASHIER";
    await request(app).get("/api/price-exceptions/would-have-flagged").expect(403);
    role = "SUPER_ADMIN";
    await request(app).get("/api/price-exceptions/would-have-flagged").expect(200);
    role = "ADMIN";
  });

  it("a till sale that claims channel 'web' is still recorded", async () => {
    const orderId = await place([{ productId, quantity: 1, unitPrice: 0.5 }], { channel: "web" });
    const rows = await exceptions(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "web", belowCost: true, underList: "4.50", underCost: "2.50" });
  });

  it("a manager's edit counts a breach once, as it now stands, through the real port", async () => {
    const orderId = await place([{ productId, quantity: 2, unitPrice: 3 }]);
    const edit = (lines: Array<{ productId: string; quantity: number; unitPrice: number }>) =>
      withTransaction(() => engine.updateOrder(orderId, { lines }, undefined, { actorUserId: managerId, orgId }));

    // Unchanged: the sale's row stays, still against the cashier.
    await edit([{ productId, quantity: 2, unitPrice: 3 }]);
    let rows = await exceptions(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "sale", userId: cashierId, underList: "4.00" });

    // More of it: one row for all 3 units, not a second one on top.
    await edit([{ productId, quantity: 3, unitPrice: 3 }]);
    rows = await exceptions(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "edit", userId: managerId, quantity: 3, underList: "6.00" });

    // Lifted to list: the breach is gone.
    await edit([{ productId, quantity: 3, unitPrice: 5 }]);
    expect(await exceptions(orderId)).toHaveLength(0);
  });

  it("the till receives a minimum-only floor, and a cashier never sees cost", async () => {
    role = "CASHIER";
    const res = await request(app).get("/api/products").expect(200);
    const widget = res.body.find((p: any) => p.id === productId);
    expect(widget.tillFloor).toBe(4);
    expect(widget).not.toHaveProperty("costPrice");
    // Cost £3 above a £2 minimum: a floor of 3 here would be cost leaking to
    // the till (owner Q4, Q6).
    const costly = res.body.find((p: any) => p.id === costlyProductId);
    expect(costly.tillFloor).toBe(2);
    expect(costly).not.toHaveProperty("costPrice");
    role = "ADMIN";
  });

  it("editing a cost today does not change last week's margin or COGS", async () => {
    const orderId = await place([
      { productId, quantity: 2, unitPrice: 5 },
      { productId: freeProductId, quantity: 1, unitPrice: 2 },
    ]);
    const soldAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.orders)
      .set({ status: "completed", settledAt: soldAt, createdAt: soldAt })
      .where(eq(schema.orders.id, orderId));

    const { weeklyMarginSummary } = await import("../services/reportsEngine");
    const { storage } = await import("../storage");
    const from = new Date(soldAt.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(soldAt.getTime() + 24 * 60 * 60 * 1000);

    const before = await weeklyMarginSummary(orgId, from, to);
    const cogsBefore = (await storage.getProfitAnalysis(from, to, orgId)).summary;
    const widgetBefore = (before.rows as any[]).find((r) => r.product === "Widget");
    expect(widgetBefore).toMatchObject({ costPrice: 3, unitsSold: 2, totalMargin: 4 });
    const otherBefore = (before.rows as any[]).find((r) => r.product === "No Cost Thing");
    expect(otherBefore).toMatchObject({ costPrice: null, costMissingUnits: 1, grossMargin: null });

    await db.update(schema.products).set({ costPrice: "4.75" }).where(eq(schema.products.id, productId));
    await db.update(schema.products).set({ costPrice: "1.00" }).where(eq(schema.products.id, freeProductId));

    const after = await weeklyMarginSummary(orgId, from, to);
    expect((after.rows as any[]).find((r) => r.product === "Widget")).toMatchObject({ costPrice: 3, totalMargin: 4 });
    // Unknown at the time stays unknown: a cost entered later is not backdated.
    expect((after.rows as any[]).find((r) => r.product === "No Cost Thing")).toMatchObject({ costPrice: null });
    const cogsAfter = (await storage.getProfitAnalysis(from, to, orgId)).summary;
    expect(Number(cogsAfter.cogs)).toBeCloseTo(Number(cogsBefore.cogs), 2);
  });

  it("commission uses the sale-time cost and leaves a cost-missing line out (Q5)", async () => {
    const { commissionBasisFor } = await import("../services/creditLedger");
    const { computeCashierShiftBalanceSheet } = await import("../services/cashierShiftEngine");
    await db.update(schema.products).set({ costPrice: "3.00" }).where(eq(schema.products.id, productId));
    await db.update(schema.products).set({ costPrice: null }).where(eq(schema.products.id, freeProductId));
    await db.update(schema.organizations).set({ defaultCashierCommissionRate: "10.00" }).where(eq(schema.organizations.id, orgId));

    // £10 of Widget at £3 cost (known) and £2 of a line with no cost.
    const orderId = await place([
      { productId, quantity: 2, unitPrice: 5 },
      { productId: freeProductId, quantity: 1, unitPrice: 2 },
    ]);
    const [shift] = await db
      .insert(schema.cashierShifts)
      .values({ orgId, userId: cashierId, openedByUserId: cashierId })
      .returning();
    await db
      .update(schema.orders)
      .set({ status: "completed", cashierShiftId: shift.id, completedUserId: cashierId })
      .where(eq(schema.orders.id, orderId));

    const expectBasis = async () => {
      // Margin £10 − £6 = £4 at 10%. Today's £4.75 cost would give £0.05;
      // the no-cost line as pure profit £0.60; its later £1 cost £0.50.
      expect((await commissionBasisFor(orderId))?.fullPool).toBeCloseTo(0.4, 2);
      const { commissionOrders } = await computeCashierShiftBalanceSheet(orgId, shift as any);
      const row = commissionOrders.find((o) => o.orderId === orderId)!;
      expect(row.stockCost).toBeCloseTo(6, 2);
      expect(row.paidContribution).toBeCloseTo(10, 2);
      expect(row.costMissingLines).toBe(1);
    };
    await expectBasis();

    await db.update(schema.products).set({ costPrice: "4.75" }).where(eq(schema.products.id, productId));
    await db.update(schema.products).set({ costPrice: "1.00" }).where(eq(schema.products.id, freeProductId));
    await expectBasis();
  });

  it("a line sold before snapshots existed is costed at today's cost (no backfill)", async () => {
    const orderId = await place([{ productId, quantity: 1, unitPrice: 5 }]);
    await db
      .update(schema.orderItems)
      .set({ listPrice: null, floorPrice: null, unitCost: null })
      .where(eq(schema.orderItems.orderId, orderId));
    const { lineUnitCost } = await import("@shared/pricing/lineSnapshot");
    const [line] = await items(orderId);
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(lineUnitCost(line, product.costPrice)).toBe(Number(product.costPrice));
  });
});
