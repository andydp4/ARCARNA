/** Real refund route → organisation exceptions → Z-report → persisted cash-up. */
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

describe.skipIf(!hasDb)("refunds: cash-up reconciliation (ARC-BUG-18)", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let locationId: string;
  let userId: string;
  let role = "MANAGER";
  let orderId: string;
  let orderLineId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerRefundRoutes } = await import("../routes/refunds");
    const { registerShiftRoutes } = await import("../routes/shifts");

    orgId = randomUUID();
    locationId = randomUUID();
    userId = `manager-${randomUUID()}`;
    role = "MANAGER";

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
      req.orgContext = { orgId, locationId, role };
      req.user = { id: userId, role };
      next();
    };

    app = express();
    app.use(express.json());
    registerRefundRoutes(app, [scoped]);
    registerShiftRoutes(app, [scoped]);
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

  async function issue(method = "cash") {
    return request(app).post(`/api/orders/${orderId}/refunds`).send({
      reason: "customer_changed_mind", refundMethod: method,
      lines: [{ orderLineId, qty: 1 }],
    }).expect(201);
  }

  async function openDrawer(owner = userId) {
    const [drawer] = await db.insert(shifts).values({
      orgId, locationId, userId: owner, openingFloat: "50.00", status: "open",
    }).returning();
    return drawer;
  }

  it("surfaces a no-shift cash refund even without any drawer, then warns on cash-up without attributing it", async () => {
    const refund = (await issue()).body.refund;
    expect(refund.shiftId).toBeNull();
    // No source location or date can safely be inferred. Older exceptions
    // must survive the UI's rolling shift window too.
    await db.update(refunds).set({ createdAt: new Date("2026-09-20T10:00:00Z") }).where(eq(refunds.id, refund.id));
    const exceptions = (await request(app).get("/api/shifts/unattached-refunds").expect(200)).body;
    expect(exceptions.count).toBe(1);
    expect(exceptions.cashTotal).toBe(10);
    expect(exceptions.refunds).toMatchObject([{ id: refund.id, orderId, cashAmount: 10 }]);
    expect(await db.select().from(shifts).where(eq(shifts.orgId, orgId))).toHaveLength(0);

    const drawer = await openDrawer();
    await db.update(orders).set({ shiftId: drawer.id }).where(eq(orders.id, orderId));
    const preview = (await request(app).get(`/api/shifts/${drawer.id}/report`).expect(200)).body.report;
    expect(preview.unattachedCashRefunds).toEqual({ count: 1, cashTotal: 10 });
    expect(preview.cashSummary).toMatchObject({ cashSales: 10, cashRefunds: 0, expectedCash: 60 });

    const closed = (await request(app).post(`/api/shifts/${drawer.id}/close`).send({ closingCount: 50 }).expect(200)).body;
    expect(closed.report.unattachedCashRefunds).toEqual({ count: 1, cashTotal: 10 });
    // We cannot assume this drawer paid the £10. Preserve its unadjusted
    // variance, WITH a visible review warning, rather than clearing it falsely.
    expect(closed.report.cashSummary).toMatchObject({ expectedCash: 60, variance: -10 });
    const [stored] = await db.select().from(shifts).where(eq(shifts.id, drawer.id));
    expect(Number(stored.expectedCash)).toBe(60);
    expect(Number(stored.variance)).toBe(-10);
    const [unchanged] = await db.select().from(refunds).where(eq(refunds.id, refund.id));
    expect(unchanged.shiftId).toBeNull();
  });

  it.each(["cash", "original"])("deducts a linked %s refund exactly once and persists accurate expected cash", async (method) => {
    const drawer = await openDrawer();
    await db.update(orders).set({ shiftId: drawer.id }).where(eq(orders.id, orderId));
    const refund = (await issue(method)).body.refund;
    expect(refund.shiftId).toBe(drawer.id);
    const closed = (await request(app).post(`/api/shifts/${drawer.id}/close`).send({ closingCount: 50 }).expect(200)).body;
    expect(closed.report.cashSummary).toMatchObject({ cashSales: 10, cashRefunds: 10, expectedCash: 50, variance: 0 });
    expect(closed.report.unattachedCashRefunds).toEqual({ count: 0, cashTotal: 0 });
    expect(Number(closed.shift.expectedCash)).toBe(50);
    expect(Number(closed.shift.variance)).toBe(0);
    const report = (await request(app).get(`/api/shifts/${drawer.id}/report`).expect(200)).body.report;
    expect(report.cashSummary.expectedCash).toBe(50);
    expect((await request(app).get("/api/shifts/unattached-refunds").expect(200)).body.count).toBe(0);
  });

  it("does not attach a back-office refund to the sale's shift or another cashier's open drawer", async () => {
    const other = await openDrawer(`cashier-${randomUUID()}`);
    await db.update(orders).set({ shiftId: other.id }).where(eq(orders.id, orderId));
    expect((await issue()).body.refund.shiftId).toBeNull();
    // View our own sheet: the other drawer still owns its sale, not the refund.
    const ours = await openDrawer();
    const report = (await request(app).get(`/api/shifts/${ours.id}/report`).expect(200)).body.report;
    expect(report.cashSummary.expectedCash).toBe(50);
    expect(report.cashSummary.cashRefunds).toBe(0);
    expect(report.unattachedCashRefunds.cashTotal).toBe(10);
  });

  it("does not treat card, store credit or fully cancelled tab amounts as missing cash; counts only cash paid out", async () => {
    await db.insert(refunds).values([
      { orgId, orderId, cashierId: userId, reason: "other", refundMethod: "card", total: "100.00" },
      { orgId, orderId, cashierId: userId, reason: "other", refundMethod: "store_credit", total: "100.00" },
      { orgId, orderId, cashierId: userId, reason: "other", refundMethod: "credit", total: "100.00", creditAmount: "100.00" },
      { orgId, orderId, cashierId: userId, reason: "other", refundMethod: "cash", total: "100.00", creditAmount: "100.00" },
      { orgId, orderId, cashierId: userId, reason: "other", refundMethod: "original", total: "12.34", creditAmount: "5.67" },
    ]);
    const exceptions = (await request(app).get("/api/shifts/unattached-refunds").expect(200)).body;
    expect(exceptions.count).toBe(1);
    expect(exceptions.cashTotal).toBe(6.67);
    expect(exceptions.refunds[0].cashAmount).toBe(6.67);
  });

  it("includes all exceptions in totals even when the detail list is capped", async () => {
    await db.insert(refunds).values(Array.from({ length: 101 }, () => ({
      orgId, orderId, cashierId: userId, reason: "other", refundMethod: "cash", total: "0.01",
    })));
    const exceptions = (await request(app).get("/api/shifts/unattached-refunds").expect(200)).body;
    expect(exceptions.count).toBe(101);
    expect(exceptions.cashTotal).toBe(1.01);
    expect(exceptions.refunds).toHaveLength(100);
    const next = (await request(app).get("/api/shifts/unattached-refunds?offset=100").expect(200)).body;
    expect(next.count).toBe(101);
    expect(next.cashTotal).toBe(1.01);
    expect(next.refunds).toHaveLength(1);
    expect(exceptions.refunds.map((row: { id: string }) => row.id)).not.toContain(next.refunds[0].id);
    await request(app).get("/api/shifts/unattached-refunds?offset=-1").expect(400);
  });

  it("never reads another organisation's unassigned cash refunds", async () => {
    const foreign = randomUUID();
    await db.insert(organizations).values({ id: foreign, name: "Other Refund Org" });
    try {
      const [sale] = await db.insert(orders).values({ orgId: foreign, total: "50.00", status: "completed", paymentMethod: "cash" }).returning();
      await db.insert(refunds).values({ orgId: foreign, orderId: sale.id, cashierId: userId, reason: "other", refundMethod: "cash", total: "50.00" });
      const exceptions = (await request(app).get("/api/shifts/unattached-refunds").expect(200)).body;
      expect(exceptions.count).toBe(0);
      expect(exceptions.refunds).toEqual([]);
    } finally {
      await db.delete(refunds).where(eq(refunds.orgId, foreign));
      await db.delete(orders).where(eq(orders.orgId, foreign));
      await db.delete(organizations).where(eq(organizations.id, foreign));
    }
  });

  it("preserves historically stored expected cash and variance when unassigned refunds are surfaced", async () => {
    await issue();
    const [drawer] = await db.insert(shifts).values({
      orgId, locationId, userId, openingFloat: "50.00", status: "closed",
      closingCount: "45.00", expectedCash: "55.00", variance: "-10.00", closedAt: new Date(),
    }).returning();
    const report = (await request(app).get(`/api/shifts/${drawer.id}/report`).expect(200)).body.report;
    expect(report.cashSummary).toMatchObject({ expectedCash: 55, variance: -10 });
    expect(report.unattachedCashRefunds.cashTotal).toBe(10);
  });


  it("restricts the organisation exception list to managers, while warning a cashier on their own report", async () => {
    await issue();
    const drawer = await openDrawer();
    role = "CASHIER";
    await request(app).get("/api/shifts/unattached-refunds").expect(403);
    const report = (await request(app).get(`/api/shifts/${drawer.id}/report`).expect(200)).body.report;
    expect(report.unattachedCashRefunds).toEqual({ count: 1, cashTotal: 10 });
  });

  it("deducts refunds attached to a reopened drawer", async () => {
    const drawer = await openDrawer();
    await db.update(shifts).set({ status: "reopened" }).where(eq(shifts.id, drawer.id));
    expect((await issue()).body.refund.shiftId).toBe(drawer.id);
    const closed = (await request(app).post(`/api/shifts/${drawer.id}/close`).send({ closingCount: 40 }).expect(200)).body;
    expect(closed.report.cashSummary).toMatchObject({ expectedCash: 40, cashRefunds: 10, variance: 0 });
  });

  // Force the lock ordering; observing actual pg_blocking_pids avoids a
  // timing-dependent sleep that can pass without ever exercising the race.
  async function waitForBlockedBy(pid: number): Promise<number> {
    const { pool } = await import("../db");
    let blocked = 0;
    await expect.poll(async () => {
      const result = await pool.query("SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [pid]);
      blocked = Number(result.rows[0]?.pid ?? 0);
      return blocked;
    }, { timeout: 5000, interval: 20 }).toBeGreaterThan(0);
    return blocked;
  }

  it("leaves a refund unassigned when closing wins the drawer lock", async () => {
    const drawer = await openDrawer();
    const { pool } = await import("../db");
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      const pid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      await blocker.query("SELECT id FROM shifts WHERE id = $1 FOR UPDATE", [drawer.id]);
      const pending = issue().then((res) => res);
      await waitForBlockedBy(pid);
      await blocker.query("UPDATE shifts SET status = 'closed', expected_cash = 50, closing_count = 50, variance = 0, closed_at = now() WHERE id = $1", [drawer.id]);
      await blocker.query("COMMIT");
      const res = await pending;
      expect(res.body.refund.shiftId).toBeNull();
      const report = (await request(app).get(`/api/shifts/${drawer.id}/report`).expect(200)).body.report;
      expect(report.cashSummary.expectedCash).toBe(50);
      expect(report.unattachedCashRefunds.cashTotal).toBe(10);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });

  it("waits for a refund that wins the drawer lock before persisting the cash count", async () => {
    const drawer = await openDrawer();
    await db.update(orders).set({ shiftId: drawer.id }).where(eq(orders.id, orderId));
    const { pool } = await import("../db");
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      const pid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      await blocker.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
      const refundPending = issue().then((res) => res);
      // The refund has the drawer's share lock, but is held at the order lock.
      const refundPid = await waitForBlockedBy(pid);
      const closePending = request(app).post(`/api/shifts/${drawer.id}/close`).send({ closingCount: 50 }).expect(200).then((res) => res);
      await waitForBlockedBy(refundPid);
      await blocker.query("COMMIT");
      const [refundRes, closed] = await Promise.all([refundPending, closePending]);
      expect(refundRes.body.refund.shiftId).toBe(drawer.id);
      expect(closed.body.report.cashSummary).toMatchObject({ cashRefunds: 10, expectedCash: 50, variance: 0 });
      expect(Number(closed.body.shift.expectedCash)).toBe(50);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });

});
