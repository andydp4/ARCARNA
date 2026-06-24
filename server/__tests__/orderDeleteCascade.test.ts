import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  customers,
  giftCardMovements,
  inventoryMovements,
  invoices,
  locations,
  loyaltyLedger,
  orderExpenses,
  orderItems,
  orders,
  organizations,
  productLocationStock,
  products,
  refundLines,
  refunds,
} from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("order delete cascade", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let locationId: string;
  let customerId: string;
  let orderId: string;
  let productAId: string;
  let productBId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerOrderRoutes } = await import("../routes/orders");

    orgId = randomUUID();
    locationId = randomUUID();
    customerId = randomUUID();
    orderId = randomUUID();
    productAId = randomUUID();
    productBId = randomUUID();

    app = express();
    app.use(express.json());
    registerOrderRoutes(app, [
      (req: any, _res, next) => {
        req.orgContext = { orgId, locationId: null, role: "ADMIN" };
        req.user = { id: "order-delete-test-user" };
        next();
      },
    ]);

    await db.insert(organizations).values({
      id: orgId,
      name: `Order Delete Test ${orgId}`,
    });
    await db.insert(locations).values({
      id: locationId,
      orgId,
      name: "Order Delete Test Location",
      address: "1 Test Street",
      city: "Testville",
      state: "Test",
      zipCode: "T1",
      phone: "000",
      email: "delete-order@example.test",
      isDefault: 1,
    });
    await db.insert(customers).values({
      id: customerId,
      orgId,
      name: "Delete Cascade Customer",
      loyaltyPoints: 40,
    });
    await db.insert(products).values([
      {
        id: productAId,
        orgId,
        name: "Partially Refunded Product",
        productId: `PARTIAL-${productAId}`,
        locationId,
        defaultSalePrice: "10.00",
        stock: 0,
      },
      {
        id: productBId,
        orgId,
        name: "Unrefunded Product",
        productId: `UNREFUNDED-${productBId}`,
        locationId,
        defaultSalePrice: "10.00",
        stock: 0,
      },
    ]);
    await db.insert(productLocationStock).values([
      { orgId, productId: productAId, locationId, stock: 8, stockLimit: 10 },
      { orgId, productId: productBId, locationId, stock: 8, stockLimit: 10 },
    ]);
    await db.insert(orders).values({
      id: orderId,
      orgId,
      customerId,
      locationId,
      total: "50.00",
      paymentMethod: "cash",
      status: "completed",
    });

    const lineAId = randomUUID();
    const lineBId = randomUUID();
    await db.insert(orderItems).values([
      {
        id: lineAId,
        orgId,
        orderId,
        productId: productAId,
        quantity: 3,
        unitPrice: "10.00",
        totalPrice: "30.00",
      },
      {
        id: lineBId,
        orgId,
        orderId,
        productId: productBId,
        quantity: 2,
        unitPrice: "10.00",
        totalPrice: "20.00",
      },
    ]);

    const refundId = randomUUID();
    await db.insert(refunds).values({
      id: refundId,
      orgId,
      orderId,
      cashierId: "order-delete-test-user",
      reason: "customer_changed_mind",
      refundMethod: "cash",
      total: "10.00",
    });
    await db.insert(refundLines).values({
      refundId,
      orderLineId: lineAId,
      qty: 1,
      amount: "10.00",
    });
    await db.insert(loyaltyLedger).values([
      {
        orgId,
        customerId,
        orderId,
        eventId: randomUUID(),
        pointsDelta: 50,
        reason: "earn",
        previousBalance: 0,
        newBalance: 50,
      },
      {
        orgId,
        customerId,
        orderId,
        eventId: randomUUID(),
        pointsDelta: -10,
        reason: "reverse",
        previousBalance: 50,
        newBalance: 40,
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(giftCardMovements).where(eq(giftCardMovements.orderId, orderId));
    await db.delete(inventoryMovements).where(eq(inventoryMovements.correlationId, orderId));
    await db.delete(refundLines).where(
      inArray(
        refundLines.refundId,
        db.select({ id: refunds.id }).from(refunds).where(eq(refunds.orderId, orderId)),
      ),
    );
    await db.delete(refunds).where(eq(refunds.orderId, orderId));
    await db.delete(orderExpenses).where(eq(orderExpenses.orderId, orderId));
    await db.delete(loyaltyLedger).where(eq(loyaltyLedger.orderId, orderId));
    await db.delete(invoices).where(eq(invoices.orderId, orderId));
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
    await db.delete(orders).where(eq(orders.id, orderId));
    await db.delete(productLocationStock).where(eq(productLocationStock.orgId, orgId));
    await db.delete(products).where(inArray(products.id, [productAId, productBId]));
    await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(locations).where(eq(locations.id, locationId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("restocks only unrefunded quantities and removes net loyalty impact", async () => {
    const response = await request(app).delete(`/api/orders/${orderId}`);

    expect(response.status).toBe(200);

    const stocks = await db
      .select({
        productId: productLocationStock.productId,
        stock: productLocationStock.stock,
      })
      .from(productLocationStock)
      .where(
        and(
          eq(productLocationStock.orgId, orgId),
          inArray(productLocationStock.productId, [productAId, productBId]),
        ),
      );
    const stockByProduct = new Map(stocks.map((row) => [row.productId, row.stock]));
    expect(stockByProduct.get(productAId)).toBe(10);
    expect(stockByProduct.get(productBId)).toBe(10);

    const [customer] = await db
      .select({ loyaltyPoints: customers.loyaltyPoints })
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(customer?.loyaltyPoints).toBe(0);

    await expect(db.select().from(orders).where(eq(orders.id, orderId))).resolves.toHaveLength(0);
    await expect(db.select().from(refunds).where(eq(refunds.orderId, orderId))).resolves.toHaveLength(0);
    await expect(db.select().from(loyaltyLedger).where(eq(loyaltyLedger.orderId, orderId))).resolves.toHaveLength(0);
  });
});
