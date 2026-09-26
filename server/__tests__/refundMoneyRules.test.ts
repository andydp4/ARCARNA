/**
 * v1.2.1 money audit (M1, M3, M4, M5): refunds, against the real route and a
 * real database.
 *
 *  - M1: refunding a Credit List sale took it out of the drawer as cash and
 *    left the tab owing. It must come off the tab; only what was repaid is
 *    handed back.
 *  - M3: an order that was never settled could be refunded, paying money out
 *    for a sale that was never counted in.
 *  - M4: refunds gave back the list price, ignoring the sale's discount.
 *  - M5: "to original" on a card sale was stored as a cash refund, taking it
 *    off the drawer's expected cash.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  adminAuditLogs,
  creditPayments,
  customers,
  locations,
  orderCredit,
  orderItems,
  orderPayments,
  orders,
  organizations,
  products,
  refundLines,
  refunds,
} from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("refunds: amount and tender", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let locationId: string;
  let productId: string;
  let customerId: string;
  const userId = `manager-${randomUUID()}`;

  async function sale(opts: {
    status?: string;
    method: string;
    legs: Array<[string, number]>;
    qty: number;
    unit: number;
    settled: number | null;
  }): Promise<{ orderId: string; lineId: string }> {
    const [order] = await db
      .insert(orders)
      .values({
        orgId,
        customerId,
        total: String(opts.settled ?? opts.qty * opts.unit),
        settledTotal: opts.settled == null ? null : String(opts.settled),
        subtotal: String(opts.qty * opts.unit),
        paymentMethod: opts.method,
        status: opts.status ?? "completed",
        settledAt: opts.status && opts.status !== "completed" ? null : new Date(),
      } as never)
      .returning();
    const [line] = await db
      .insert(orderItems)
      .values({
        orgId,
        orderId: order.id,
        productId,
        quantity: opts.qty,
        unitPrice: opts.unit.toFixed(2),
        totalPrice: (opts.qty * opts.unit).toFixed(2),
      } as never)
      .returning();
    for (const [method, amount] of opts.legs) {
      await db.insert(orderPayments).values({ orgId, orderId: order.id, method, amount: amount.toFixed(2) });
    }
    return { orderId: order.id, lineId: line.id };
  }

  const refund = (orderId: string, lineId: string, qty: number, refundMethod = "original") =>
    request(app)
      .post(`/api/orders/${orderId}/refunds`)
      .send({ reason: "damaged", refundMethod, lines: [{ orderLineId: lineId, qty }] });

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerRefundRoutes } = await import("../routes/refunds");
    orgId = randomUUID();
    locationId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Refund Money Rules Test" });
    await db.insert(locations).values({
      id: locationId, orgId, name: "Counter", address: "1 Test Street", city: "Testville",
      state: "Test", zipCode: "T1", phone: "07700 900001", email: "counter@example.invalid", isDefault: 1,
    });
    const [product] = await db
      .insert(products)
      .values({ orgId, name: "Gadget", productId: `gadget-${randomUUID().slice(0, 8)}`, defaultSalePrice: "25.00" } as never)
      .returning();
    productId = product.id;
    const [customer] = await db
      .insert(customers)
      .values({ orgId, name: "Alice Example", phone: "07700 900123" } as never)
      .returning();
    customerId = customer.id;

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId, role: "MANAGER" };
      req.user = { id: userId, role: "MANAGER" };
      next();
    };
    app = express();
    app.use(express.json());
    registerRefundRoutes(app, [scoped]);
  });

  afterEach(async () => {
    const orderIds = (await db.select({ id: orders.id }).from(orders).where(eq(orders.orgId, orgId))).map((o) => o.id);
    if (orderIds.length) {
      const refundIds = (await db.select({ id: refunds.id }).from(refunds).where(inArray(refunds.orderId, orderIds))).map((r) => r.id);
      if (refundIds.length) {
        await db.delete(refundLines).where(inArray(refundLines.refundId, refundIds));
      }
      await db.delete(refunds).where(eq(refunds.orgId, orgId));
      await db.delete(creditPayments).where(eq(creditPayments.orgId, orgId));
      await db.delete(orderCredit).where(eq(orderCredit.orgId, orgId));
      await db.delete(orderPayments).where(eq(orderPayments.orgId, orgId));
      await db.delete(orderItems).where(eq(orderItems.orgId, orgId));
      await db.delete(orders).where(eq(orders.orgId, orgId));
    }
    await db.delete(customers).where(eq(customers.orgId, orgId));
    await db.delete(products).where(eq(products.orgId, orgId));
    await db.delete(locations).where(eq(locations.id, locationId));
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("M1: a refunded tab sale comes off the tab, and only what was repaid is handed back", async () => {
    const { orderId, lineId } = await sale({ method: "tick", legs: [["tick", 25]], qty: 1, unit: 25, settled: 25 });
    await db.insert(orderCredit).values({
      orderId, orgId, customerId, amountGiven: "25.00", amountOutstanding: "15.00", status: "partial", givenOn: "2026-09-15",
    });
    await db.insert(creditPayments).values({ orgId, orderId, amount: "10.00", method: "cash", paidOn: "2026-09-16" });

    const res = await refund(orderId, lineId, 1).expect(201);
    expect(res.body.refund.refundMethod).toBe("original");
    expect(Number(res.body.refund.total)).toBe(25);
    expect(Number(res.body.refund.creditAmount)).toBe(15);

    const [tab] = await db.select().from(orderCredit).where(eq(orderCredit.orderId, orderId));
    expect(Number(tab.amountOutstanding)).toBe(0);
    expect(tab.status).toBe("settled");
  });

  it("M1: an unpaid tab refunded in part comes down by the refund, with nothing paid out", async () => {
    const { orderId, lineId } = await sale({ method: "tick", legs: [["tick", 50]], qty: 2, unit: 25, settled: 50 });
    await db.insert(orderCredit).values({
      orderId, orgId, customerId, amountGiven: "50.00", amountOutstanding: "50.00", status: "outstanding", givenOn: "2026-09-15",
    });
    const res = await refund(orderId, lineId, 1, "cash").expect(201);
    expect(res.body.refund.refundMethod).toBe("credit");
    const [tab] = await db.select().from(orderCredit).where(eq(orderCredit.orderId, orderId));
    expect(Number(tab.amountOutstanding)).toBe(25);
    expect(tab.status).toBe("outstanding");
  });

  it("M3: an order that was never settled cannot be refunded", async () => {
    const { orderId, lineId } = await sale({ status: "pending", method: "cash", legs: [["cash", 10]], qty: 1, unit: 10, settled: null });
    const res = await refund(orderId, lineId, 1, "cash").expect(409);
    expect(res.body.code).toBe("REFUND_ORDER_NOT_SETTLED");
    expect(await db.select().from(refunds).where(eq(refunds.orderId, orderId))).toHaveLength(0);
  });

  it("M4: a discounted sale refunds what was paid per item, and can be refunded in full", async () => {
    const { orderId, lineId } = await sale({ method: "card", legs: [["card", 45]], qty: 2, unit: 25, settled: 45 });
    const first = await refund(orderId, lineId, 1, "card").expect(201);
    expect(Number(first.body.refund.total)).toBe(22.5);
    const second = await refund(orderId, lineId, 1, "card").expect(201);
    expect(Number(second.body.refund.total)).toBe(22.5);
  });

  it("M5: 'to original' on a card sale goes back to the card, not out of the drawer", async () => {
    const { orderId, lineId } = await sale({ method: "card", legs: [["card", 50]], qty: 2, unit: 25, settled: 50 });
    const res = await refund(orderId, lineId, 1).expect(201);
    expect(res.body.refund.refundMethod).toBe("card");
  });

  it("M5: 'to original' on a sale paid two ways asks which way", async () => {
    const { orderId, lineId } = await sale({ method: "split", legs: [["cash", 20], ["card", 30]], qty: 2, unit: 25, settled: 50 });
    const res = await refund(orderId, lineId, 1).expect(400);
    expect(res.body.code).toBe("REFUND_METHOD_NEEDED");
  });
});
