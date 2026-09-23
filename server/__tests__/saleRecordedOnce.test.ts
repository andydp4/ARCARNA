/**
 * Sales recorded once (v1.2 Phase 1A) against a real database.
 *
 * The till sends a sale reference (`clientOrderId`) on every attempt. A repeat
 * — sequential or arriving at the same moment — returns the original order and
 * records nothing. A sale the server refuses is answered 422, can be reported
 * to Needs attention, and is dealt with there by a manager: a retry is
 * recorded once and as the sale of whoever rang it; a discard needs a reason
 * and is logged with the whole sale. In CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("a till sale is recorded once", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgId = randomUUID();
  let locationId = "";
  let productId = "";
  const tag = randomUUID().slice(0, 8);
  const id = (who: string) => `once-${who}-${tag}`;
  const roles: Record<string, string> = { cashier: "CASHIER", manager: "MANAGER" };
  let as = "cashier";

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    const s = schema;
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Sale Recorded Once Test" });
    const [loc] = await db
      .insert(s.locations)
      .values({
        orgId,
        name: "Once Shop",
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
        name: "Once Widget",
        productId: `ONCE-${tag}`,
        defaultSalePrice: "10.00",
        stock: 100,
        stockLimit: 5,
      })
      .returning();
    productId = prod.id;
    await db.insert(s.productLocationStock).values({ orgId, productId, locationId, stock: 100 });
    await db.insert(s.allowedUsers).values(
      Object.entries(roles).map(([who, role]) => ({
        replitUserId: id(who),
        authUserId: id(who),
        name: who,
        role: role as any,
        orgId,
      })),
    );

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId, role: roles[as] };
      req.user = { id: id(as), role: roles[as], claims: { sub: id(as) } };
      next();
    };
    const { registerOrderRoutes } = await import("../routes/orders");
    const { registerSaleIssueRoutes } = await import("../routes/saleIssues");
    app = express();
    app.use(express.json());
    registerOrderRoutes(app, [scoped]);
    registerSaleIssueRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    const { sql } = await import("drizzle-orm");
    // Children first; a table a route did not write to is simply empty here.
    for (const table of [
      "order_events",
      "order_payments",
      "order_expenses",
      "order_items",
      "inventory_movements",
      "ops_alerts",
      "sale_issues",
      "admin_audit_logs",
      "orders",
      "cashier_shifts",
      "shifts",
      "product_location_stock",
      "products",
      "locations",
    ]) {
      try {
        await db.execute(sql.raw(`DELETE FROM ${table} WHERE org_id = '${orgId}'`));
      } catch (e) {
        console.warn("[saleRecordedOnce] cleanup", table, (e as Error).message);
      }
    }
    const { inArray, eq } = await import("drizzle-orm");
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, Object.keys(roles).map(id)));
    try {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    } catch (e) {
      console.warn("[saleRecordedOnce] could not remove the test org", (e as Error).message);
    }
  });

  const sale = (clientOrderId: string, extra: Record<string, unknown> = {}) => ({
    clientOrderId,
    lines: [{ productId, quantity: 1, unitPrice: 10 }],
    paymentMethod: "cash",
    ...extra,
  });
  const post = (who: string, path: string, body: Record<string, unknown>) => {
    as = who;
    return request(app).post(path).send(body);
  };
  const get = (who: string, path: string) => {
    as = who;
    return request(app).get(path);
  };

  async function ordersFor(ref: string) {
    const { and, eq } = await import("drizzle-orm");
    return db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.orgId, orgId), eq(schema.orders.clientOrderId, ref)));
  }

  it("a repeat of a sale returns the original order and records nothing", async () => {
    const ref = randomUUID();
    const first = await post("cashier", "/api/orders", sale(ref)).expect(201);
    const repeat = await post("cashier", "/api/orders", sale(ref)).expect(200);
    expect(repeat.body.duplicate).toBe(true);
    expect(repeat.body.orderId).toBe(first.body.orderId);
    expect(repeat.body.order.id).toBe(first.body.orderId);

    const rows = await ordersFor(ref);
    expect(rows).toHaveLength(1);
    const { eq } = await import("drizzle-orm");
    const payments = await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, rows[0].id));
    expect(payments).toHaveLength(1);
  });

  it("refuses a different sale sent under a reference that already recorded one", async () => {
    const ref = randomUUID();
    await post("cashier", "/api/orders", sale(ref, { expectedTotal: 10 })).expect(201);
    const reused = await post(
      "cashier",
      "/api/orders",
      sale(ref, { lines: [{ productId, quantity: 2, unitPrice: 10 }], expectedTotal: 20 }),
    ).expect(409);
    expect(reused.body.code).toBe("SALE_REFERENCE_REUSED");
    expect(await ordersFor(ref)).toHaveLength(1);
  });

  it("copies of one sale arriving together are recorded once", async () => {
    const ref = randomUUID();
    as = "cashier";
    const answers = await Promise.all([1, 2, 3, 4].map(() => request(app).post("/api/orders").send(sale(ref))));
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses).toEqual([200, 200, 200, 201]);
    expect(new Set(answers.map((a) => a.body.orderId)).size).toBe(1);
    expect(await ordersFor(ref)).toHaveLength(1);
  });

  it("the reference is unique per organisation, enforced by the database", async () => {
    const ref = randomUUID();
    await post("cashier", "/api/orders", sale(ref)).expect(201);
    await expect(
      db.insert(schema.orders).values({
        orgId,
        total: "1.00",
        paymentMethod: "cash",
        clientOrderId: ref,
      } as never),
    ).rejects.toThrow();
  });

  it("answers 'did it land?' by reference", async () => {
    const ref = randomUUID();
    const missing = await get("cashier", `/api/orders/by-reference/${ref}`).expect(200);
    expect(missing.body.found).toBe(false);
    const placed = await post("cashier", "/api/orders", sale(ref)).expect(201);
    const found = await get("cashier", `/api/orders/by-reference/${ref}`).expect(200);
    expect(found.body.found).toBe(true);
    expect(found.body.orderId).toBe(placed.body.orderId);
  });

  it("refuses a malformed reference rather than ignoring it", async () => {
    const res = await post("cashier", "/api/orders", sale("no spaces allowed")).expect(400);
    expect(res.body.code).toBe("CLIENT_ORDER_ID_INVALID");
  });

  it("answers a refused sale with 422, so the till hands it to a manager", async () => {
    const ref = randomUUID();
    const res = await post("cashier", "/api/orders", sale(ref, { payments: [{ method: "cash", amount: 3 }] })).expect(422);
    expect(res.body.message).toMatch(/Payments add up to/);
    expect(await ordersFor(ref)).toHaveLength(0);
  });

  it("Needs attention: reported once, listed for managers, retried once as the cashier's sale", async () => {
    const ref = randomUUID();
    const queuedAt = new Date(Date.now() - 60_000).toISOString();
    const report = {
      clientOrderId: ref,
      payload: sale(ref, { _offlineOrderReplay: true, _offlineQueuedAt: queuedAt }),
      reason: "Select a customer before putting a sale on credit.",
      httpStatus: 400,
      queuedAt,
    };
    const created = await post("cashier", "/api/sale-issues", report).expect(201);
    const issueId = created.body.issueId as string;
    expect(issueId).toBeTruthy();
    // The till lost the answer and reports again: nothing new.
    await post("cashier", "/api/sale-issues", report).expect(200);

    await get("cashier", "/api/sale-issues").expect(403);
    const summary = await get("cashier", "/api/sale-issues/summary").expect(200);
    expect(summary.body.open).toBeGreaterThanOrEqual(1);
    const list = await get("manager", "/api/sale-issues").expect(200);
    const listed = list.body.issues.find((i: { id: string }) => i.id === issueId);
    expect(listed.payload._offlineOrderReplay).toBeUndefined();
    expect(listed.payload.lines).toHaveLength(1);

    // A cashier cannot resend it on a manager's behalf.
    await post("cashier", "/api/orders", { ...sale(ref), saleIssueId: issueId }).expect(403);
    // A resend must keep the sale's own reference.
    await post("manager", "/api/orders", { ...sale(randomUUID()), saleIssueId: issueId }).expect(400);

    const retried = await post("manager", "/api/orders", { ...sale(ref), saleIssueId: issueId }).expect(201);
    const again = await post("manager", "/api/orders", { ...sale(ref), saleIssueId: issueId }).expect(200);
    expect(again.body.orderId).toBe(retried.body.orderId);

    const rows = await ordersFor(ref);
    expect(rows).toHaveLength(1);
    expect(rows[0].inputUserId).toBe(id("cashier"));
    expect(rows[0].locationId).toBe(locationId);

    const { eq } = await import("drizzle-orm");
    const [issue] = await db.select().from(schema.saleIssues).where(eq(schema.saleIssues.id, issueId));
    expect(issue.status).toBe("resolved");
    expect(issue.resolvedOrderId).toBe(rows[0].id);
    expect(issue.resolvedByUserId).toBe(id("manager"));
  });

  it("a report for a sale that did land is let go, not listed", async () => {
    const ref = randomUUID();
    await post("cashier", "/api/orders", sale(ref)).expect(201);
    const res = await post("cashier", "/api/sale-issues", {
      clientOrderId: ref,
      payload: sale(ref),
      reason: "timed out",
    }).expect(200);
    expect(res.body.alreadyRecorded).toBe(true);
  });

  it("a discard needs a manager and a reason, and is logged with the whole sale", async () => {
    const ref = randomUUID();
    const created = await post("cashier", "/api/sale-issues", {
      clientOrderId: ref,
      payload: sale(ref),
      reason: "Customer not found",
      httpStatus: 400,
    }).expect(201);
    const issueId = created.body.issueId as string;

    await post("cashier", `/api/sale-issues/${issueId}/discard`, { reason: "duplicate of a paper sale" }).expect(403);
    await post("manager", `/api/sale-issues/${issueId}/discard`, {}).expect(400);
    await post("manager", `/api/sale-issues/${issueId}/discard`, { reason: "Keyed in again by hand" }).expect(200);
    await post("manager", `/api/sale-issues/${issueId}/discard`, { reason: "Keyed in again by hand" }).expect(409);
    // A discarded sale cannot be resent.
    await post("manager", "/api/orders", { ...sale(ref), saleIssueId: issueId }).expect(409);

    const { and, eq } = await import("drizzle-orm");
    const logs = await db
      .select()
      .from(schema.adminAuditLogs)
      .where(and(eq(schema.adminAuditLogs.orgId, orgId), eq(schema.adminAuditLogs.targetId, issueId)));
    const discard = logs.find((l) => l.action === "sale_issue.discarded");
    expect(discard?.actorUserId).toBe(id("manager"));
    const meta = discard?.metadata as { reason: string; payload: { clientOrderId: string } };
    expect(meta.reason).toBe("Keyed in again by hand");
    expect(meta.payload.clientOrderId).toBe(ref);
    expect(await ordersFor(ref)).toHaveLength(0);
  });

  it("a sign-out with sales unsent needs a manager and is logged", async () => {
    await post("cashier", "/api/sale-issues/sign-out-override", { waiting: 1, failed: 0, reason: "closing up" }).expect(403);
    await post("manager", "/api/sale-issues/sign-out-override", { waiting: 1, failed: 0 }).expect(400);
    await post("manager", "/api/sale-issues/sign-out-override", {
      waiting: 2,
      failed: 1,
      reason: "Till going home, sales handed to Needs attention",
      references: [randomUUID()],
    }).expect(200);
    const { and, eq } = await import("drizzle-orm");
    const logs = await db
      .select()
      .from(schema.adminAuditLogs)
      .where(and(eq(schema.adminAuditLogs.orgId, orgId), eq(schema.adminAuditLogs.action, "till.sign_out_override")));
    expect(logs).toHaveLength(1);
    expect((logs[0].metadata as { waiting: number }).waiting).toBe(2);
  });
});
