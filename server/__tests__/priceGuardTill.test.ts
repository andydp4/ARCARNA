/**
 * Price guard at the till (v1.2 Phase 4: PRC-02, PRC-04, CMP-05) against a
 * real database, through the real order route, the real engine and notify().
 *
 * Covers the owner's checks: a below-minimum sale with a reason completes and
 * managers get one Signal; a manager's own goes to admins and the owner only;
 * an offline sale gives one order and one exception; "Manager agreed: Alex"
 * asks Alex; below cost after discounts is flagged without the cashier; the
 * switch is admin only, logged, and off means silent recording only.
 *
 * Runs in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("price guard at the till", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const cashierId = `pg-cashier-${tag}`;
  const alexId = `pg-alex-${tag}`;
  const morganId = `pg-morgan-${tag}`;
  const adminId = `pg-admin-${tag}`;
  const people = [
    { id: cashierId, role: "CASHIER", name: "Sam Till" },
    { id: alexId, role: "MANAGER", name: "Alex Boss" },
    { id: morganId, role: "MANAGER", name: "Morgan Floor" },
    { id: adminId, role: "ADMIN", name: "Ada Admin" },
  ];
  let actor = cashierId;
  let locationId = "";
  let widgetId = "";
  let lossId = "";

  const roleOf = (id: string) => people.find((p) => p.id === id)!.role;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    const s = schema;
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Price Guard Test", defaultTaxRate: "0" });
    const [loc] = await db
      .insert(s.locations)
      .values({
        orgId,
        name: "Guard Shop",
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
    // Widget: list £5, minimum £4, cost £2. Loss leader: list £5, no minimum, cost £4.50.
    const [w] = await db
      .insert(s.products)
      .values({ orgId, locationId, name: "Guard Widget", productId: `PG-W-${tag}`, defaultSalePrice: "5.00", minPrice: "4.00", costPrice: "2.00", stock: 1000 })
      .returning();
    widgetId = w.id;
    const [l] = await db
      .insert(s.products)
      .values({ orgId, locationId, name: "Guard Thin Margin", productId: `PG-L-${tag}`, defaultSalePrice: "5.00", costPrice: "4.50", stock: 1000 })
      .returning();
    lossId = l.id;
    await db.insert(s.productLocationStock).values([
      { orgId, productId: widgetId, locationId, stock: 1000 },
      { orgId, productId: lossId, locationId, stock: 1000 },
    ]);
    await db.insert(s.allowedUsers).values(
      people.map((p) => ({ replitUserId: p.id, authUserId: p.id, name: p.name, role: p.role as any, orgId })),
    );

    const scoped: RequestHandler = (req: any, _res, next) => {
      const role = roleOf(actor);
      req.orgContext = { orgId, locationId, role };
      req.user = { id: actor, role, claims: { sub: actor } };
      next();
    };
    const { registerOrderRoutes } = await import("../routes/orders");
    const { registerPriceGuardRoutes } = await import("../routes/priceGuard");
    app = express();
    app.use(express.json());
    registerOrderRoutes(app, [scoped]);
    registerPriceGuardRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    const { sql, eq, inArray } = await import("drizzle-orm");
    for (const statement of [
      `DELETE FROM event_outbox WHERE correlation_id IN (SELECT id::text FROM orders WHERE org_id = '${orgId}')`,
      `DELETE FROM loyalty_ledger WHERE order_id IN (SELECT id FROM orders WHERE org_id = '${orgId}')`,
      `DELETE FROM org_notification_recipients WHERE org_id = '${orgId}'`,
    ]) {
      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        console.warn("[priceGuardTill] cleanup", (e as Error).message);
      }
    }
    for (const table of [
      "price_guard_orders",
      "price_exceptions",
      "org_notifications",
      "admin_audit_logs",
      "order_events",
      "order_payments",
      "order_expenses",
      "order_items",
      "inventory_movements",
      "ops_alerts",
      "commission_ledger",
      "orders",
      "cashier_shifts",
      "shifts",
      "product_location_stock",
      "product_price_history",
      "products",
      "locations",
    ]) {
      try {
        await db.execute(sql.raw(`DELETE FROM ${table} WHERE org_id = '${orgId}'`));
      } catch (e) {
        console.warn("[priceGuardTill] cleanup", table, (e as Error).message);
      }
    }
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, people.map((p) => p.id)));
    try {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    } catch (e) {
      console.warn("[priceGuardTill] could not remove the test org", (e as Error).message);
    }
  });

  const as = (id: string) => {
    actor = id;
  };
  const setSwitch = async (enabled: boolean) => {
    as(adminId);
    await request(app).put("/api/settings/price-guard").send({ enabled }).expect(200);
    as(cashierId);
  };
  const sale = (lines: Array<{ productId: string; quantity: number; unitPrice: number }>, extra: Record<string, unknown> = {}) => ({
    clientOrderId: randomUUID(),
    lines,
    paymentMethod: "cash",
    ...extra,
  });
  const confirm = (reason: string, lines: Array<{ productId: string; unitPrice: number }>, extra: Record<string, unknown> = {}) => ({
    reason,
    lines,
    confirmedAt: new Date().toISOString(),
    ...extra,
  });
  const post = (body: Record<string, unknown>) => request(app).post("/api/orders").send(body);

  async function guardRows(orderId: string) {
    const { eq } = await import("drizzle-orm");
    return db.select().from(schema.priceGuardOrders).where(eq(schema.priceGuardOrders.orderId, orderId));
  }
  async function signalsFor(orderId: string) {
    const { and, eq, sql } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(schema.orgNotifications)
      .where(and(eq(schema.orgNotifications.orgId, orgId), sql`${schema.orgNotifications.metadata}->>'orderId' = ${orderId}`));
    const out = [];
    for (const r of rows) {
      const recipients = await db
        .select({ userId: schema.orgNotificationRecipients.userId })
        .from(schema.orgNotificationRecipients)
        .where(eq(schema.orgNotificationRecipients.notificationId, r.id));
      out.push({ ...r, recipients: recipients.map((x) => x.userId) });
    }
    return out;
  }

  it("the switch is admin only, off by default, and every change is logged", async () => {
    const { and, eq } = await import("drizzle-orm");
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    expect(org.priceGuardEnabled).toBe(false);
    as(alexId);
    await request(app).put("/api/settings/price-guard").send({ enabled: true }).expect(403);
    as(cashierId);
    await request(app).put("/api/settings/price-guard").send({ enabled: true }).expect(403);
    await setSwitch(true);
    await setSwitch(false);
    const logged = await db
      .select()
      .from(schema.adminAuditLogs)
      .where(and(eq(schema.adminAuditLogs.orgId, orgId), eq(schema.adminAuditLogs.action, "price_guard.updated")));
    expect(logged.map((l) => (l.metadata as any)?.to)).toEqual(expect.arrayContaining([true, false]));
    expect(logged).toHaveLength(2);
  });

  it("off: the sale is recorded silently only — no guard row, no Signal", async () => {
    await setSwitch(false);
    const res = await post(sale([{ productId: widgetId, quantity: 1, unitPrice: 3 }])).expect(201);
    expect(await guardRows(res.body.orderId)).toHaveLength(0);
    expect(await signalsFor(res.body.orderId)).toHaveLength(0);
    const { eq } = await import("drizzle-orm");
    const silent = await db.select().from(schema.priceExceptions).where(eq(schema.priceExceptions.orderId, res.body.orderId));
    expect(silent).toHaveLength(1);
  });

  it("on: a cashier's below-minimum sale with a reason completes; managers get one Signal", async () => {
    await setSwitch(true);
    const res = await post(
      sale([{ productId: widgetId, quantity: 2, unitPrice: 3 }], {
        priceGuard: confirm("trade", [{ productId: widgetId, unitPrice: 3 }]),
      }),
    ).expect(201);
    const [row] = await guardRows(res.body.orderId);
    expect(row).toMatchObject({ reason: "trade", confirmed: true, severity: "warning", flaggedLines: 1, unconfirmedLines: 0, offline: false });
    expect(row.underMinimum).toBe("2.00");
    const signals = await signalsFor(res.body.orderId);
    expect(signals).toHaveLength(1);
    expect(signals[0].source).toBe("price_guard");
    expect(signals[0].message).toMatch(/£2\.00 under minimum on order #\w+ by Sam Till: 1 line, reason: Trade customer/);
    expect(signals[0].recipients).toEqual(expect.arrayContaining([alexId, morganId, adminId]));
    expect(signals[0].recipients).not.toContain(cashierId);
  });

  it("a sale arriving without a confirmation is stored unconfirmed at the higher severity, never refused", async () => {
    const res = await post(sale([{ productId: widgetId, quantity: 1, unitPrice: 3.5 }])).expect(201);
    const [row] = await guardRows(res.body.orderId);
    expect(row).toMatchObject({ reason: null, confirmed: false, severity: "error", unconfirmedLines: 1 });
    const bad = await post(
      sale([{ productId: widgetId, quantity: 1, unitPrice: 3.5 }], { priceGuard: { reason: "nonsense" } }),
    ).expect(201);
    expect((await guardRows(bad.body.orderId))[0].confirmed).toBe(false);
    const [signal] = await signalsFor(res.body.orderId);
    expect(signal.severity).toBe("error");
    expect(signal.message).toContain("unconfirmed");
  });

  it("a manager's own below-minimum sale goes to admins and the owner only", async () => {
    as(morganId);
    const res = await post(
      sale([{ productId: widgetId, quantity: 1, unitPrice: 3 }], {
        priceGuard: confirm("damaged", [{ productId: widgetId, unitPrice: 3 }]),
      }),
    ).expect(201);
    as(cashierId);
    const [signal] = await signalsFor(res.body.orderId);
    expect(signal.recipients).toContain(adminId);
    expect(signal.recipients).not.toContain(alexId);
    expect(signal.recipients).not.toContain(morganId);
  });

  it("offline: the queued confirmation is accepted on replay — one order, one exception", async () => {
    const body = sale([{ productId: widgetId, quantity: 1, unitPrice: 3 }], {
      priceGuard: confirm("price_match", [{ productId: widgetId, unitPrice: 3 }]),
      _offlineOrderReplay: true,
      _offlineQueuedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const first = await post(body).expect(201);
    const again = await post(body).expect(200);
    expect(again.body.orderId).toBe(first.body.orderId);
    const { eq } = await import("drizzle-orm");
    const orders = await db.select().from(schema.orders).where(eq(schema.orders.clientOrderId, body.clientOrderId));
    expect(orders).toHaveLength(1);
    const rows = await guardRows(first.body.orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "price_match", confirmed: true, offline: true });
    const exceptions = await db.select().from(schema.priceExceptions).where(eq(schema.priceExceptions.orderId, first.body.orderId));
    expect(exceptions).toHaveLength(1);
    expect(await signalsFor(first.body.orderId)).toHaveLength(1);
  });

  it("\"Manager agreed: Alex\" asks Alex; only Alex answers, once; a No goes to the owner and the sale stands", async () => {
    const res = await post(
      sale([{ productId: widgetId, quantity: 1, unitPrice: 3 }], {
        priceGuard: confirm("manager_agreed", [{ productId: widgetId, unitPrice: 3 }], { managerUserId: alexId }),
      }),
    ).expect(201);
    const [row] = await guardRows(res.body.orderId);
    expect(row).toMatchObject({ reason: "manager_agreed", managerUserId: alexId, confirmed: true });
    const signals = await signalsFor(res.body.orderId);
    const question = signals.find((s) => s.source === "price_guard_manager_check")!;
    expect(question.recipients).toContain(alexId);
    expect(question.recipients).not.toContain(morganId);
    expect(question.recipients).not.toContain(cashierId);
    expect(signals.find((s) => s.source === "price_guard")!.message).toContain("Manager agreed: Alex Boss");

    as(morganId);
    await request(app).post(`/api/price-guard/checks/${row.id}/answer`).send({ answer: "yes" }).expect(404);
    as(cashierId);
    await request(app).post(`/api/price-guard/checks/${row.id}/answer`).send({ answer: "yes" }).expect(403);
    as(alexId);
    await request(app).post(`/api/price-guard/checks/${row.id}/answer`).send({ answer: "no" }).expect(200);
    await request(app).post(`/api/price-guard/checks/${row.id}/answer`).send({ answer: "yes" }).expect(409);
    as(cashierId);

    const [after] = await guardRows(res.body.orderId);
    expect(after.managerAnswer).toBe("no");
    const no = (await signalsFor(res.body.orderId)).find((s) => s.source === "price_guard_manager_no")!;
    expect(no.message).toMatch(/did not agree .* The sale stands/);
    expect(no.recipients).not.toContain(adminId);
    expect(no.recipients).not.toContain(alexId);
    const { eq } = await import("drizzle-orm");
    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, res.body.orderId));
    expect(order.status).not.toBe("cancelled");
  });

  it("naming someone who is not a manager leaves the lines unconfirmed", async () => {
    const res = await post(
      sale([{ productId: widgetId, quantity: 1, unitPrice: 3 }], {
        priceGuard: confirm("manager_agreed", [{ productId: widgetId, unitPrice: 3 }], { managerUserId: cashierId }),
      }),
    ).expect(201);
    const [row] = await guardRows(res.body.orderId);
    expect(row).toMatchObject({ confirmed: false, managerUserId: null, severity: "error" });
  });

  it("below cost after all discounts flags managers with no step for the cashier", async () => {
    const { eq } = await import("drizzle-orm");
    const [promo] = await db
      .insert(schema.promotions)
      .values({
        orgId,
        name: "Two off",
        code: `TWO${tag.toUpperCase()}`,
        type: "fixed",
        value: "2.00",
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
        isActive: 1,
      })
      .returning();
    try {
      // £10 of thin-margin stock at list, £2 off: £8 in for £9 of cost. No
      // keyed price is below anything, so the till asked nothing.
      const res = await post(
        sale([{ productId: lossId, quantity: 2, unitPrice: 5 }], { promoCode: promo.code, expectedTotal: 8 }),
      ).expect(201);
      const [row] = await guardRows(res.body.orderId);
      expect(row).toMatchObject({ orderBelowCost: true, confirmed: null, severity: "error" });
      expect(row.underCost).toBe("1.00");
      const [signal] = await signalsFor(res.body.orderId);
      expect(signal.title).toMatch(/Below cost/);
      expect(signal.recipients).toEqual(expect.arrayContaining([alexId, adminId]));
      expect(signal.recipients).not.toContain(cashierId);
    } finally {
      await db.execute((await import("drizzle-orm")).sql`DELETE FROM promotion_redemptions WHERE promotion_id = ${promo.id}`).catch(() => {});
      await db.delete(schema.promotions).where(eq(schema.promotions.id, promo.id)).catch(() => {});
    }
  });

  it("personal use keeps its own Signal: no price guard row", async () => {
    const res = await post(
      sale([{ productId: widgetId, quantity: 1, unitPrice: 0 }], { paymentMethod: "personal_use", personalUseReason: "Staff lunch" }),
    ).expect(201);
    expect(await guardRows(res.body.orderId)).toHaveLength(0);
  });

  it("the till's manager list is names only, managers and admins of this shop", async () => {
    const res = await request(app).get("/api/price-guard/managers").expect(200);
    const ids = res.body.map((m: { id: string }) => m.id);
    expect(ids).toEqual(expect.arrayContaining([alexId, morganId, adminId]));
    expect(ids).not.toContain(cashierId);
    expect(Object.keys(res.body[0]).sort()).toEqual(["id", "name"]);
  });
});
