import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import {
  customers,
  giftCardMovements,
  giftCards,
  inventoryMovements,
  locations,
  loyaltyLedger,
  orderItems,
  orders,
  organizations,
  productLocationStock,
  products,
  refundLines,
  refunds,
} from "@shared/schema";
import { registerOrderRoutes } from "../routes/orders";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("order delete cascade", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let locationId: string;
  let customerId: string;
  let productId: string;
  let orderId: string;
  let orderItemId: string;
  let refundId: string;
  let giftCardId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));

    orgId = randomUUID();
    locationId = randomUUID();
    customerId = randomUUID();
    productId = randomUUID();
    orderId = randomUUID();
    orderItemId = randomUUID();
    refundId = randomUUID();
    giftCardId = randomUUID();

    app = express();
    app.use(express.json());
    registerOrderRoutes(app, [
      (req: any, _res, next) => {
        req.user = { id: "delete-cascade-test-user", role: "ADMIN", orgId };
        req.orgContext = { orgId, locationId, role: "ADMIN" };
        next();
      },
    ]);

    await db.insert(organizations).values({ id: orgId, name: "Order Delete Cascade Test" });
    await db.insert(locations).values({
      id: locationId,
      orgId,
      name: "Main",
      address: "1 Test Street",
      city: "Testville",
      state: "Test",
      zipCode: "T1",
      phone: "000",
      email: "main@example.test",
      isDefault: 1,
    });
    await db.insert(customers).values({
      id: customerId,
      orgId,
      name: "Delete Cascade Customer",
      loyaltyPoints: 8,
    });
    await db.insert(products).values({
      id: productId,
      orgId,
      locationId,
      name: "Cascade Widget",
      productId: `CASCADE-${productId}`,
      defaultSalePrice: "10.00",
      stock: 0,
    });
    await db.insert(productLocationStock).values({
      orgId,
      productId,
      locationId,
      stock: 7,
      stockLimit: 10,
    });
    await db.insert(giftCards).values({
      id: giftCardId,
      orgId,
      code: `GC${giftCardId.replace(/-/g, "").slice(0, 14)}`,
      balance: "70.00",
      originalAmount: "100.00",
      issuedByUserId: "issuer",
      status: "active",
    });
    await db.insert(orders).values({
      id: orderId,
      orgId,
      customerId,
      locationId,
      total: "50.00",
      paymentMethod: "gift_card",
      status: "paid",
    });
    await db.insert(orderItems).values({
      id: orderItemId,
      orgId,
      orderId,
      productId,
      quantity: 5,
      unitPrice: "10.00",
      totalPrice: "50.00",
    });
    await db.insert(refunds).values({
      id: refundId,
      orgId,
      orderId,
      cashierId: "cashier",
      reason: "customer_changed_mind",
      refundMethod: "cash",
      total: "20.00",
    });
    await db.insert(refundLines).values({
      refundId,
      orderLineId: orderItemId,
      qty: 2,
      amount: "20.00",
    });
    await db.insert(giftCardMovements).values({
      giftCardId,
      orderId,
      type: "redeem",
      amount: "30.00",
      balanceAfter: "70.00",
    });
    await db.insert(loyaltyLedger).values([
      {
        orgId,
        customerId,
        orderId,
        eventId: randomUUID(),
        pointsDelta: 10,
        reason: "earn",
        previousBalance: 0,
        newBalance: 10,
      },
      {
        orgId,
        customerId,
        orderId,
        eventId: randomUUID(),
        pointsDelta: -2,
        reason: "reverse",
        previousBalance: 10,
        newBalance: 8,
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(inventoryMovements).where(eq(inventoryMovements.correlationId, orderId));
    await db.delete(giftCardMovements).where(eq(giftCardMovements.giftCardId, giftCardId));
    await db.delete(refundLines).where(eq(refundLines.orderLineId, orderItemId));
    await db.delete(refunds).where(eq(refunds.id, refundId));
    await db.delete(loyaltyLedger).where(eq(loyaltyLedger.orderId, orderId));
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await db.delete(orders).where(eq(orders.id, orderId));
    await db.delete(giftCards).where(eq(giftCards.id, giftCardId));
    await db
      .delete(productLocationStock)
      .where(and(eq(productLocationStock.orgId, orgId), eq(productLocationStock.productId, productId)));
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(locations).where(eq(locations.id, locationId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("atomically restores unrefunded stock, gift card balance, and loyalty points", async () => {
    const response = await request(app).delete(`/api/orders/${orderId}`);

    expect(response.status).toBe(200);

    const [stock] = await db
      .select({ stock: productLocationStock.stock })
      .from(productLocationStock)
      .where(
        and(
          eq(productLocationStock.orgId, orgId),
          eq(productLocationStock.productId, productId),
          eq(productLocationStock.locationId, locationId),
        ),
      );
    expect(stock?.stock).toBe(10);

    const movements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.correlationId, orderId));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      delta: 3,
      reason: "cancellation",
      eventId: orderId,
    });
    expect(movements[0]?.eventId).toHaveLength(36);

    const [card] = await db.select().from(giftCards).where(eq(giftCards.id, giftCardId));
    expect(String(card?.balance)).toBe("100.00");
    expect(card?.status).toBe("active");

    const [customer] = await db
      .select({ loyaltyPoints: customers.loyaltyPoints })
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(customer?.loyaltyPoints).toBe(0);

    const [remainingOrder] = await db.select().from(orders).where(eq(orders.id, orderId));
    const remainingDependents = await Promise.all([
      db.select().from(orderItems).where(eq(orderItems.orderId, orderId)),
      db.select().from(refunds).where(eq(refunds.orderId, orderId)),
      db.select().from(refundLines).where(eq(refundLines.orderLineId, orderItemId)),
      db.select().from(giftCardMovements).where(eq(giftCardMovements.orderId, orderId)),
      db.select().from(loyaltyLedger).where(eq(loyaltyLedger.orderId, orderId)),
    ]);
    expect(remainingOrder).toBeUndefined();
    expect(remainingDependents.every((rows) => rows.length === 0)).toBe(true);
  });
});
