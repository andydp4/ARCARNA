/**
 * My run (v1.2) against the real route table and a real database: a person
 * sees only their own run, a manager can pick a driver, the saved order is
 * per person, and "Couldn't deliver" puts the delivery back to ready with a
 * board note and a Signal to managers.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml). Mocks
 * ../db without a database like roleMatrix.test.ts, so the no-DB run loads it
 * and skips the database half.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = !!process.env.DATABASE_URL;
process.env.DEV_AUTH_BYPASS = "0";

vi.mock("../db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {}, pool: {} },
);

vi.mock("../auth", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  const fakeAuth = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    const id = String(req.headers["x-test-user"] ?? `run-${String(role).toLowerCase()}`);
    req.user = { id, role, orgId: req.headers["x-test-org"] ?? null, isAllowed: true, claims: { sub: id } };
    return next();
  };
  const fakeOrgContext = (req: any, _res: any, next: any) => {
    if (!req.user) return next();
    req.orgContext = { orgId: req.user.orgId, locationId: null, role: req.user.role };
    return next();
  };
  return { ...real, setupAuth: async () => {}, isAuthenticated: fakeAuth, requireOrgContext: fakeOrgContext };
});

describe.skipIf(!hasDb)("My run (database)", () => {
  let app: express.Express;
  let db: any;
  let s: typeof import("@shared/schema");
  const orgId = randomUUID();
  const suffix = orgId.slice(0, 8);
  const DRIVER = `run-driver-${suffix}`;
  const OTHER = `run-other-${suffix}`;
  const MANAGER = `run-manager-${suffix}`;
  const ids = { late: "", soon: "", out: "", notReady: "", othersRun: "", collection: "", done: "", held: "", cancelledOut: "", tapped: "" };

  function as(role: string, user: string) {
    const agent = (method: "get" | "post" | "put", url: string) =>
      request(app)
        [method](url)
        .set("x-test-role", role)
        .set("x-test-org", orgId)
        .set("x-org-id", orgId)
        .set("x-test-user", user);
    return {
      get: (url: string) => agent("get", url),
      post: (url: string, body: unknown = {}) => agent("post", url).send(body as object),
      put: (url: string, body: unknown = {}) => agent("put", url).send(body as object),
    };
  }

  beforeAll(async () => {
    ({ db } = await import("../db"));
    s = await import("@shared/schema");
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ My Run Org" });
    await db.insert(s.allowedUsers).values([
      { replitUserId: DRIVER, authUserId: DRIVER, name: "Dee Driver", role: "CASHIER", orgId },
      { replitUserId: OTHER, authUserId: OTHER, name: "Otto Other", role: "CASHIER", orgId },
      { replitUserId: MANAGER, authUserId: MANAGER, name: "Mo Manager", role: "MANAGER", orgId },
    ]);
    const [jane] = await db
      .insert(s.customers)
      .values({ orgId, name: "Jane Smith", phone: "07700 904821" })
      .returning();
    const now = Date.now();
    const min = 60_000;
    const order = async (values: Record<string, unknown>) => {
      const [row] = await db
        .insert(s.orders)
        .values({
          orgId,
          total: "20.00",
          paymentMethod: "cash",
          status: "pending",
          fulfilmentMethod: "delivery",
          customerId: jane.id,
          deliveryAddress: "5 Live Lane",
          deliveryPostcode: "LV1 1VE",
          assignedUserId: DRIVER,
          readyAt: new Date(now - 5 * min),
          ...values,
        })
        .returning();
      return row.id as string;
    };
    ids.soon = await order({ etaGiven: new Date(now + 30 * min), deliveryNotes: "side door" });
    ids.late = await order({ etaGiven: new Date(now + 10 * min), paymentMethod: "tick", total: "12.50" });
    ids.out = await order({ etaGiven: new Date(now + 60 * min), outForDeliveryAt: new Date(now - min) });
    ids.notReady = await order({ readyAt: null, etaGiven: new Date(now + 5 * min) });
    ids.othersRun = await order({ assignedUserId: OTHER });
    ids.collection = await order({ fulfilmentMethod: "collection", deliveryAddress: null, deliveryPostcode: null });
    ids.done = await order({ status: "completed", settledAt: new Date(), outForDeliveryAt: new Date() });
    ids.held = await order({ status: "on-hold" });
    ids.cancelledOut = await order({ status: "cancelled", outForDeliveryAt: new Date(now - min) });
    await db.insert(s.orderItems).values([
      { orgId, orderId: ids.soon, productId: null, quantity: 2, unitPrice: "5.00", totalPrice: "10.00" },
      { orgId, orderId: ids.soon, productId: null, quantity: 1, unitPrice: "10.00", totalPrice: "10.00" },
    ] as any);

    const { registerRoutes } = await import("../routes");
    app = express();
    app.use(express.json());
    await registerRoutes(app as any);
  });

  afterAll(async () => {
    if (!db) return;
    const { eq, inArray } = await import("drizzle-orm");
    const orderIds = Object.values(ids).filter(Boolean);
    try {
      if (orderIds.length) await db.delete(s.orderItems).where(inArray(s.orderItems.orderId, orderIds));
    } catch (e) {
      console.warn("[myRun] cleanup", (e as Error).message);
    }
    for (const table of [
      s.orgNotifications,
      s.adminAuditLogs,
      s.deliveryRunOrders,
      s.orderEvents,
      s.orders,
      s.customers,
    ] as any[]) {
      try {
        await db.delete(table).where(eq(table.orgId, orgId));
      } catch (e) {
        console.warn("[myRun] cleanup", (e as Error).message);
      }
    }
    await db.delete(s.allowedUsers).where(inArray(s.allowedUsers.replitUserId, [DRIVER, OTHER, MANAGER])).catch(() => {});
    await db.delete(s.organizations).where(eq(s.organizations.id, orgId)).catch(() => {});
  });

  it("shows a driver their own ready and out-for-delivery stops, by due time, and nothing else", async () => {
    const res = await as("CASHIER", DRIVER).get("/api/my-run");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body.stops.map((x: any) => x.id)).toEqual([ids.late, ids.soon, ids.out]);
    expect(res.body.viewingOther).toBe(false);
    expect(res.body.drivers).toBeUndefined();
    const soon = res.body.stops.find((x: any) => x.id === ids.soon);
    expect(soon).toMatchObject({
      customerName: "Jane Smith",
      deliveryAddress: "5 Live Lane",
      deliveryPostcode: "LV1 1VE",
      deliveryNotes: "side door",
      itemCount: 2,
      onTick: 0,
      hasCustomer: true,
    });
    expect(res.body.stops.find((x: any) => x.id === ids.late).onTick).toBe(12.5);
    // No phone number anywhere in the run.
    expect(JSON.stringify(res.body)).not.toMatch(/7700|904821/);
  });

  it("refuses someone else's run below manager, and lets a manager pick a driver", async () => {
    expect((await as("CASHIER", OTHER).get(`/api/my-run?driver=${DRIVER}`)).status).toBe(403);
    const own = await as("CASHIER", OTHER).get("/api/my-run");
    expect(own.body.stops.map((x: any) => x.id)).toEqual([ids.othersRun]);

    const res = await as("MANAGER", MANAGER).get(`/api/my-run?driver=${DRIVER}`);
    expect(res.status).toBe(200);
    expect(res.body.viewingOther).toBe(true);
    expect(res.body.driver).toEqual({ userId: DRIVER, name: "Dee Driver" });
    expect(res.body.stops).toHaveLength(3);
    const drivers = res.body.drivers.map((d: any) => d.userId);
    expect(drivers[0]).toBe(MANAGER);
    expect(drivers).toEqual(expect.arrayContaining([DRIVER, OTHER]));
  });

  it("keeps the order a driver saves, for them only", async () => {
    const saved = await as("CASHIER", DRIVER).put("/api/my-run/order", { orderIds: [ids.out, ids.soon] });
    expect(saved.status).toBe(200);
    const res = await as("CASHIER", DRIVER).get("/api/my-run");
    expect(res.body.stops.map((x: any) => x.id)).toEqual([ids.out, ids.soon, ids.late]);

    // Another person's save is their own row: it cannot reorder this run.
    await as("CASHIER", OTHER).put("/api/my-run/order", { orderIds: [ids.late, ids.soon, ids.out] });
    const again = await as("CASHIER", DRIVER).get("/api/my-run");
    expect(again.body.stops.map((x: any) => x.id)).toEqual([ids.out, ids.soon, ids.late]);

    expect((await as("CASHIER", DRIVER).put("/api/my-run/order", { orderIds: ["not-an-id"] })).status).toBe(400);
  });

  it("\"Couldn't deliver\" is the assignee's, puts it back to ready, notes the board and tells managers", async () => {
    const { eq, and } = await import("drizzle-orm");
    const url = `/api/orders/${ids.out}/couldnt-deliver`;
    expect((await as("CASHIER", OTHER).post(url, { reason: "no_answer" })).status).toBe(403);
    expect((await as("CASHIER", DRIVER).post(url, { reason: "other" })).status).toBe(400);
    expect((await as("CASHIER", DRIVER).post(`/api/orders/${ids.soon}/couldnt-deliver`, { reason: "no_answer" })).status).toBe(409);

    const res = await as("CASHIER", DRIVER).post(url, { reason: "no_answer", note: "rang twice" });
    expect(res.status).toBe(200);
    expect(res.body.deliveryIssue).toBe("Couldn't deliver: No answer — rang twice");

    const [row] = await db.select().from(s.orders).where(eq(s.orders.id, ids.out));
    expect(row.outForDeliveryAt).toBeNull();
    expect(row.readyAt).not.toBeNull();
    expect(row.assignedUserId).toBe(DRIVER);
    expect(row.status).toBe("pending");
    expect(row.deliveryIssue).toBe("Couldn't deliver: No answer — rang twice");
    expect(row.deliveryIssueAt).not.toBeNull();

    // Still on the driver's run, as ready, for the next attempt.
    const run = await as("CASHIER", DRIVER).get("/api/my-run");
    const stop = run.body.stops.find((x: any) => x.id === ids.out);
    expect(stop.outForDeliveryAt).toBeNull();
    expect(stop.deliveryIssue).toContain("No answer");

    // The board card carries the note.
    const board = await as("CASHIER", DRIVER).get("/api/orders/board");
    expect(board.body.orders.find((o: any) => o.id === ids.out).deliveryIssue).toContain("No answer");

    // One Signal, to managers, not to the cashiers.
    const signals = await db
      .select({ id: s.orgNotifications.id, message: s.orgNotifications.message })
      .from(s.orgNotifications)
      .where(and(eq(s.orgNotifications.orgId, orgId), eq(s.orgNotifications.source, "delivery_failed")));
    expect(signals).toHaveLength(1);
    expect(signals[0].message).toContain("Dee Driver");
    const recipients = await db
      .select({ userId: s.orgNotificationRecipients.userId })
      .from(s.orgNotificationRecipients)
      .where(eq(s.orgNotificationRecipients.notificationId, signals[0].id));
    const who = recipients.map((r: any) => r.userId);
    expect(who).toContain(MANAGER);
    expect(who).not.toContain(DRIVER);
    expect(who).not.toContain(OTHER);

    // A replayed tap is refused, not a second Signal.
    const repeat = await as("CASHIER", DRIVER).post(url, { reason: "no_answer" });
    expect(repeat.status).toBe(409);
    expect(repeat.body.code).toBe("NOT_OUT");

    // Cancelled while the tap waited: not put back to ready, no Signal.
    const cancelled = await as("CASHIER", DRIVER).post(`/api/orders/${ids.cancelledOut}/couldnt-deliver`, {
      reason: "no_answer",
    });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.code).toBe("ORDER_OFF_RUN");
    const [cancelledRow] = await db.select().from(s.orders).where(eq(s.orders.id, ids.cancelledOut));
    expect(cancelledRow.outForDeliveryAt).not.toBeNull();
    expect(cancelledRow.deliveryIssue).toBeNull();
    const after = await db
      .select({ id: s.orgNotifications.id })
      .from(s.orgNotifications)
      .where(and(eq(s.orgNotifications.orgId, orgId), eq(s.orgNotifications.source, "delivery_failed")));
    expect(after).toHaveLength(1);

    const [audit] = await db
      .select({ action: s.adminAuditLogs.action })
      .from(s.adminAuditLogs)
      .where(and(eq(s.adminAuditLogs.orgId, orgId), eq(s.adminAuditLogs.targetId, ids.out)));
    expect(audit?.action).toBe("order.delivery_failed");
  });

  it("Start run and Delivered go through the existing transition route", async () => {
    const start = await as("CASHIER", DRIVER).post(`/api/orders/${ids.out}/transition`, { action: "out_for_delivery" });
    expect(start.status).toBe(200);
    const done = await as("CASHIER", DRIVER).post(`/api/orders/${ids.out}/transition`, { action: "complete", label: "delivered" });
    expect(done.status).toBe(200);
    const run = await as("CASHIER", DRIVER).get("/api/my-run");
    expect(run.body.stops.map((x: any) => x.id)).not.toContain(ids.out);
  });

  it("a replayed Delivered tap cannot complete an order again after it was reopened", async () => {
    const { eq } = await import("drizzle-orm");
    // Made here, not in beforeAll, so the run counts above are unchanged.
    const [made] = await db
      .insert(s.orders)
      .values({
        orgId,
        total: "20.00",
        paymentMethod: "cash",
        status: "pending",
        fulfilmentMethod: "delivery",
        deliveryAddress: "5 Live Lane",
        deliveryPostcode: "LV1 1VE",
        assignedUserId: DRIVER,
        readyAt: new Date(Date.now() - 300_000),
        outForDeliveryAt: new Date(Date.now() - 60_000),
      })
      .returning();
    ids.tapped = made.id;
    const url = `/api/orders/${ids.tapped}/transition`;
    const body = { action: "complete", label: "delivered", tapId: `tap-${suffix}` };
    expect((await as("CASHIER", DRIVER).post(url, body)).status).toBe(200);
    const reopen = await as("MANAGER", MANAGER).post(url, { action: "reopen" });
    expect(reopen.status).toBe(200);

    // The phone never heard back and sends the same tap again.
    const replay = await as("CASHIER", DRIVER).post(url, { ...body, actualAt: new Date(Date.now() - 60_000).toISOString() });
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe("TAP_ALREADY_APPLIED");
    const [row] = await db.select().from(s.orders).where(eq(s.orders.id, ids.tapped));
    expect(row.status).not.toBe("completed");

    // A new tap (a real second delivery) still completes it.
    const fresh = await as("CASHIER", DRIVER).post(url, { ...body, tapId: `tap2-${suffix}` });
    expect(fresh.status).toBe(200);
  });
});
