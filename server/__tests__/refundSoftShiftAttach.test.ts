/**
 * ARC-015: refunding from the back office silently opened a phantom till
 * drawer for the manager doing it.
 *
 * The refund route used to run through `requireOpenShift`, which — correctly,
 * for taking a SALE — auto-opens (and floats) a till shift when the caller has
 * none. Applied to a refund, that meant a manager clearing a refund from Open
 * Orders with no till of their own got one anyway: a drawer nobody physically
 * opened, which then showed them "on now" on the Shifts page and tripped the
 * Control Centre's uncounted-drawer signal for a shift that was never real.
 *
 * The fix attaches softly: this user's already-open shift when one exists,
 * `shiftId: null` when it doesn't — and, critically, never inserts a shift row
 * as a side effect of refunding. Both are asserted here directly against the
 * `shifts` table, against the real route, on a real database — a mocked
 * drizzle chain would not prove "nothing new was inserted" the way counting
 * real rows does.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminAuditLogs,
  locations,
  orderItems,
  orders,
  organizations,
  products,
  refundLines,
  refunds,
  shifts,
} from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("refunds: soft shift attach", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let locationId: string;
  let userId: string;
  let orderId: string;
  let orderLineId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerRefundRoutes } = await import("../routes/refunds");

    orgId = randomUUID();
    locationId = randomUUID();
    userId = `manager-${randomUUID()}`;

    await db.insert(organizations).values({ id: orgId, name: "Refund Soft Attach Test" });
    await db.insert(locations).values({
      id: locationId,
      orgId,
      name: "Counter",
      address: "1 Test Street",
      city: "Testville",
      state: "Test",
      zipCode: "T1",
      phone: "000",
      email: "counter@example.test",
      isDefault: 1,
    });

    const [product] = await db
      .insert(products)
      .values({
        orgId,
        name: "Widget",
        productId: `widget-${randomUUID().slice(0, 8)}`,
        defaultSalePrice: "10.00",
      } as never)
      .returning();

    const [order] = await db
      .insert(orders)
      .values({
        orgId,
        total: "10.00",
        settledTotal: "10.00",
        paymentMethod: "cash",
        status: "completed",
      } as never)
      .returning();
    orderId = order.id;

    const [line] = await db
      .insert(orderItems)
      .values({
        orgId,
        orderId,
        productId: product.id,
        quantity: 1,
        unitPrice: "10.00",
        totalPrice: "10.00",
      } as never)
      .returning();
    orderLineId = line.id;

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
    await db.delete(refundLines).where(eq(refundLines.orderLineId, orderLineId));
    await db.delete(refunds).where(eq(refunds.orgId, orgId));
    await db.delete(orderItems).where(eq(orderItems.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(products).where(eq(products.orgId, orgId));
    await db.delete(shifts).where(eq(shifts.orgId, orgId));
    await db.delete(locations).where(eq(locations.id, locationId));
    // The route's admin-audit write (recordAdminAudit) FK's to this org.
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("issues a refund with no shift attached, and opens no phantom drawer, when the manager has none open", async () => {
    const res = await request(app)
      .post(`/api/orders/${orderId}/refunds`)
      .send({
        reason: "customer_changed_mind",
        refundMethod: "cash",
        lines: [{ orderLineId, qty: 1 }],
      })
      .expect(201);

    expect(res.body.refund.shiftId).toBeNull();

    // The whole point: refunding must not have inserted a till shift for this
    // org at all, phantom or otherwise.
    const shiftRows = await db.select().from(shifts).where(eq(shifts.orgId, orgId));
    expect(shiftRows).toHaveLength(0);
  });

  it("attaches the manager's already-open shift instead of opening a second one", async () => {
    const [existingShift] = await db
      .insert(shifts)
      .values({ orgId, locationId, userId, openingFloat: "50.00", status: "open" })
      .returning();

    const res = await request(app)
      .post(`/api/orders/${orderId}/refunds`)
      .send({
        reason: "customer_changed_mind",
        refundMethod: "cash",
        lines: [{ orderLineId, qty: 1 }],
      })
      .expect(201);

    expect(res.body.refund.shiftId).toBe(existingShift.id);

    const shiftRows = await db.select().from(shifts).where(eq(shifts.orgId, orgId));
    expect(shiftRows).toHaveLength(1);
    expect(shiftRows[0].id).toBe(existingShift.id);
  });
});
