/**
 * Price guard review and evidence (v1.2 Phase 4: PRC-04, PRC-05, PRC-09,
 * CMP-02, CMP-04) against a real database, through the real routes.
 *
 * Covers: below-minimum Signals now or in a twice-daily round-up (below cost
 * always now); the Needs a look inbox — queue per role, states, reviewer and
 * note, escalation, the weekly "N unreviewed for over 7 days" line; the
 * refunds rule with admin thresholds; Price overrides Evidence cut by role
 * and the repeat-pattern Signal; the cashier's own count on their shift;
 * bulk "Set minimum price" with preview, price history and the owner told;
 * and Weekly Margin flagged by the price policy instead of a 20% rule.
 *
 * Runs in CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("price guard review: Signals, Needs a look, refunds, Evidence, bulk minimum", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const samId = `nal-sam-${tag}`;
  const kimId = `nal-kim-${tag}`;
  const alexId = `nal-alex-${tag}`;
  const morganId = `nal-morgan-${tag}`;
  const adaId = `nal-ada-${tag}`;
  const ownerId = `nal-owner-${tag}`;
  const people = [
    { id: samId, role: "CASHIER", name: "Sam Till", orgId },
    { id: kimId, role: "CASHIER", name: "Kim Till", orgId },
    { id: alexId, role: "MANAGER", name: "Alex Boss", orgId },
    { id: morganId, role: "MANAGER", name: "Morgan Floor", orgId },
    { id: adaId, role: "ADMIN", name: "Ada Admin", orgId },
    // The owner's login has no org (SUPER_ADMIN sees every org).
    { id: ownerId, role: "SUPER_ADMIN", name: "Olive Owner", orgId: null as string | null },
  ];
  let actor = samId;
  let locationId = "";
  let widgetId = "";
  let lossId = "";
  let plainId = "";

  const roleOf = (id: string) => people.find((p) => p.id === id)!.role;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    const s = schema;
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Needs A Look Test", defaultTaxRate: "0", priceGuardEnabled: true });
    const [loc] = await db
      .insert(s.locations)
      .values({ orgId, name: "Look Shop", address: "1 Test Street", city: "Testville", state: "TS", zipCode: "TS1", phone: "0000000000", email: "shop@example.com", isDefault: 1, isActive: 1 })
      .returning();
    locationId = loc.id;
    // Widget: list £5, minimum £4, cost £2. Thin: list £5, cost £4.50. Plain: list £10, cost £6, no minimum.
    const mk = async (name: string, sku: string, sale: string, min: string | null, cost: string | null) => {
      const [p] = await db
        .insert(s.products)
        .values({ orgId, locationId, name, productId: `${sku}-${tag}`, defaultSalePrice: sale, minPrice: min, costPrice: cost, stock: 1000 })
        .returning();
      await db.insert(s.productLocationStock).values({ orgId, productId: p.id, locationId, stock: 1000 });
      return p.id;
    };
    widgetId = await mk("Look Widget", "NAL-W", "5.00", "4.00", "2.00");
    lossId = await mk("Look Thin", "NAL-L", "5.00", null, "4.50");
    plainId = await mk("Look Plain", "NAL-P", "10.00", null, "6.00");
    await db.insert(s.allowedUsers).values(
      people.map((p) => ({ replitUserId: p.id, authUserId: p.id, name: p.name, role: p.role as any, orgId: p.orgId })),
    );

    const scoped: RequestHandler = (req: any, _res, next) => {
      const role = roleOf(actor);
      req.orgContext = { orgId, locationId, role };
      req.user = { id: actor, role, claims: { sub: actor } };
      next();
    };
    const { registerOrderRoutes } = await import("../routes/orders");
    const { registerNeedsALookRoutes } = await import("../routes/needsALook");
    const { registerRefundRoutes } = await import("../routes/refunds");
    const { registerCashierRoutes } = await import("../routes/cashiers");
    app = express();
    app.use(express.json());
    registerOrderRoutes(app, [scoped]);
    registerNeedsALookRoutes(app, [scoped]);
    registerRefundRoutes(app, [scoped]);
    registerCashierRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    const { sql, eq, inArray } = await import("drizzle-orm");
    for (const statement of [
      `DELETE FROM event_outbox WHERE correlation_id IN (SELECT id::text FROM orders WHERE org_id = '${orgId}')`,
      `DELETE FROM loyalty_ledger WHERE order_id IN (SELECT id FROM orders WHERE org_id = '${orgId}')`,
      `DELETE FROM refund_lines WHERE refund_id IN (SELECT id FROM refunds WHERE org_id = '${orgId}')`,
      `DELETE FROM org_notification_recipients WHERE org_id = '${orgId}'`,
    ]) {
      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        console.warn("[needsALook] cleanup", (e as Error).message);
      }
    }
    for (const table of [
      "exception_reviews",
      "refunds",
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
      "cashier_shift_summaries",
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
        console.warn("[needsALook] cleanup", table, (e as Error).message);
      }
    }
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, people.map((p) => p.id)));
    try {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    } catch (e) {
      console.warn("[needsALook] could not remove the test org", (e as Error).message);
    }
  });

  const as = (id: string) => {
    actor = id;
  };
  const sale = (lines: Array<{ productId: string; quantity: number; unitPrice: number }>, extra: Record<string, unknown> = {}) => ({
    clientOrderId: randomUUID(),
    lines,
    paymentMethod: "cash",
    ...extra,
  });
  const confirm = (reason: string, lines: Array<{ productId: string; unitPrice: number }>) => ({
    reason,
    lines,
    confirmedAt: new Date().toISOString(),
  });
  const underMinSale = (who: string, reason = "trade") => {
    as(who);
    return request(app)
      .post("/api/orders")
      .send(sale([{ productId: widgetId, quantity: 1, unitPrice: 3 }], { priceGuard: confirm(reason, [{ productId: widgetId, unitPrice: 3 }]) }))
      .expect(201);
  };
  // Only a settled sale can be refunded (v1.2.1 money, M3): mark it handed over.
  const settle = async (orderId: string) => {
    const { eq, sql } = await import("drizzle-orm");
    await db
      .update(schema.orders)
      .set({ status: "completed", settledAt: new Date(), settledTotal: sql`${schema.orders.total}` } as never)
      .where(eq(schema.orders.id, orderId));
  };
  const setRules = async (patch: Record<string, unknown>) => {
    as(adaId);
    const current = (await request(app).get("/api/settings/review-rules").expect(200)).body;
    await request(app).put("/api/settings/review-rules").send({ ...current, ...patch }).expect(200);
  };

  async function signals(where: { orderId?: string; source?: string; subject?: string }) {
    const { and, eq, sql } = await import("drizzle-orm");
    const n = schema.orgNotifications;
    const conds = [eq(n.orgId, orgId)];
    if (where.orderId) conds.push(sql`(${n.metadata}->>'orderId' = ${where.orderId} OR ${n.metadata}->'orderIds' ? ${where.orderId})`);
    if (where.source) conds.push(eq(n.source, where.source));
    if (where.subject) conds.push(eq(n.subjectUserId, where.subject));
    const rows = await db.select().from(n).where(and(...conds));
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
  async function reviewFor(kind: string, sourceOrOrder: { orderId?: string; sourceId?: string }) {
    const { and, eq } = await import("drizzle-orm");
    const r = schema.exceptionReviews;
    const rows = await db
      .select()
      .from(r)
      .where(and(eq(r.orgId, orgId), eq(r.kind, kind), sourceOrOrder.orderId ? eq(r.orderId, sourceOrOrder.orderId) : eq(r.sourceId, sourceOrOrder.sourceId!)));
    return rows;
  }

  it("the rules are admin only, logged, and start at £50 / 14 days / 24 hours / straight away", async () => {
    as(alexId);
    const rules = (await request(app).get("/api/settings/review-rules").expect(200)).body;
    expect(rules).toEqual({ priceGuardMinSignal: "immediate", refundCashOver: 50, refundAfterDays: 14, refundSameCashierHours: 24 });
    await request(app).put("/api/settings/review-rules").send(rules).expect(403);
    as(samId);
    await request(app).get("/api/settings/review-rules").expect(403);
    as(adaId);
    await request(app).put("/api/settings/review-rules").send({ ...rules, refundAfterDays: 0 }).expect(400);
    await request(app).put("/api/settings/review-rules").send({ ...rules, refundSameCashierHours: 48 }).expect(200);
    await request(app).put("/api/settings/review-rules").send(rules).expect(200);
    const { and, eq } = await import("drizzle-orm");
    const logged = await db
      .select()
      .from(schema.adminAuditLogs)
      .where(and(eq(schema.adminAuditLogs.orgId, orgId), eq(schema.adminAuditLogs.action, "review_rules.updated")));
    expect(logged).toHaveLength(2);
  });

  it("each flagged sale is one exception, queued by the role of whoever rang it", async () => {
    const res = await underMinSale(samId);
    const [row] = await reviewFor("price", { orderId: res.body.orderId });
    expect(row).toMatchObject({ subjectUserId: samId, subjectRole: "CASHIER", state: "open", severity: "warning" });
    expect(row.summary).toMatch(/£1\.00 under minimum on order #\w+ by Sam Till/);
    expect(row.amount).toBe("1.00");
  });

  it("Needs a look: managers see cashiers' queue only, admins managers' too; cashiers are refused", async () => {
    const managersOwn = await underMinSale(morganId, "damaged");
    as(samId);
    await request(app).get("/api/needs-a-look").expect(403);

    as(alexId);
    const forAlex = (await request(app).get("/api/needs-a-look").expect(200)).body;
    expect(forAlex.queues.map((q: { role: string }) => q.role)).toEqual(["CASHIER"]);
    expect(forAlex.items.every((i: { subjectRole: string }) => i.subjectRole === "CASHIER")).toBe(true);
    expect(forAlex.items.some((i: { orderId: string }) => i.orderId === managersOwn.body.orderId)).toBe(false);

    as(morganId);
    const forMorgan = (await request(app).get("/api/needs-a-look?state=all").expect(200)).body;
    expect(forMorgan.items.some((i: { orderId: string }) => i.orderId === managersOwn.body.orderId)).toBe(false);

    as(adaId);
    const forAda = (await request(app).get("/api/needs-a-look?queue=MANAGER").expect(200)).body;
    expect(forAda.queues.map((q: { role: string }) => q.role)).toEqual(["CASHIER", "MANAGER"]);
    expect(forAda.items.map((i: { orderId: string }) => i.orderId)).toContain(managersOwn.body.orderId);
    expect(forAda.items.every((i: { subjectRole: string }) => i.subjectRole === "MANAGER")).toBe(true);
  });

  it("a manager marks a cashier's exception explained, with a note; a manager's own is not theirs to review", async () => {
    const res = await underMinSale(samId);
    const [row] = await reviewFor("price", { orderId: res.body.orderId });
    as(alexId);
    const done = await request(app).post(`/api/needs-a-look/${row.id}/review`).send({ state: "explained", note: "Regular trade customer" }).expect(200);
    expect(done.body.state).toBe("explained");
    const [after] = await reviewFor("price", { orderId: res.body.orderId });
    expect(after).toMatchObject({ state: "explained", reviewerId: alexId, note: "Regular trade customer" });
    expect(after.reviewedAt).not.toBeNull();
    const listed = (await request(app).get("/api/needs-a-look?state=explained").expect(200)).body.items.find((i: { id: string }) => i.id === row.id);
    expect(listed).toMatchObject({ reviewerName: "Alex Boss", note: "Regular trade customer" });

    const mine = await underMinSale(morganId);
    const [managerRow] = await reviewFor("price", { orderId: mine.body.orderId });
    as(alexId);
    await request(app).post(`/api/needs-a-look/${managerRow.id}/review`).send({ state: "explained" }).expect(404);
    as(morganId);
    await request(app).post(`/api/needs-a-look/${managerRow.id}/review`).send({ state: "explained" }).expect(404);
    as(alexId);
    await request(app).post(`/api/needs-a-look/${row.id}/review`).send({ state: "closed" }).expect(400);
  });

  it("escalating tells the people above the reviewer, not their peers", async () => {
    const res = await underMinSale(kimId);
    const [row] = await reviewFor("price", { orderId: res.body.orderId });
    as(alexId);
    await request(app).post(`/api/needs-a-look/${row.id}/review`).send({ state: "escalated", note: "Third time this week" }).expect(200);
    const [signal] = await signals({ source: "exception_escalated", orderId: res.body.orderId });
    expect(signal.message).toContain("Alex Boss escalated");
    expect(signal.message).toContain("Third time this week");
    expect(signal.recipients).toContain(adaId);
    expect(signal.recipients).toContain(ownerId);
    expect(signal.recipients).not.toContain(morganId);
    expect(signal.recipients).not.toContain(alexId);
  });

  it("below-minimum Signals twice daily: held, then one round-up per person; below cost still goes now", async () => {
    await setRules({ priceGuardMinSignal: "twice_daily" });
    const held = await underMinSale(samId);
    const { eq } = await import("drizzle-orm");
    const [guard] = await db.select().from(schema.priceGuardOrders).where(eq(schema.priceGuardOrders.orderId, held.body.orderId));
    expect(guard.signalPending).toBe(true);
    expect((await signals({ orderId: held.body.orderId, source: "price_guard" })).length).toBe(0);

    // Below cost after discounts is not held.
    as(samId);
    const thin = await request(app)
      .post("/api/orders")
      .send(sale([{ productId: lossId, quantity: 1, unitPrice: 4 }], { priceGuard: confirm("damaged", [{ productId: lossId, unitPrice: 4 }]) }))
      .expect(201);
    const now = await signals({ orderId: thin.body.orderId, source: "price_guard" });
    expect(now).toHaveLength(1);
    expect(now[0].title).toMatch(/Below cost/);

    const { sendDigestForOrg } = await import("../services/priceGuardDigest");
    // A round-up time before the sale sends nothing.
    expect(await sendDigestForOrg(orgId, new Date(Date.now() - 3_600_000))).toBe(0);
    expect(await sendDigestForOrg(orgId, new Date(Date.now() + 1000))).toBe(1);
    const digest = await signals({ orderId: held.body.orderId, source: "price_guard_digest" });
    expect(digest).toHaveLength(1);
    expect(digest[0].message).toMatch(/under minimum on 1 order by Sam Till/);
    expect(digest[0].recipients).toEqual(expect.arrayContaining([alexId, morganId, adaId]));
    expect(digest[0].recipients).not.toContain(samId);
    // Exactly once.
    expect(await sendDigestForOrg(orgId, new Date(Date.now() + 1000))).toBe(0);
    const [after] = await db.select().from(schema.priceGuardOrders).where(eq(schema.priceGuardOrders.orderId, held.body.orderId));
    expect(after.signalPending).toBe(false);
    expect(after.signalId).toBe(digest[0].id);
    await setRules({ priceGuardMinSignal: "immediate" });
  });

  it("repeat patterns raise one Signal to admins", async () => {
    // Kim has one flagged sale already (the escalation test). Two more make three.
    await underMinSale(kimId);
    expect(await signals({ source: "price_guard_repeat", subject: kimId })).toHaveLength(0);
    await underMinSale(kimId);
    const repeat = await signals({ source: "price_guard_repeat", subject: kimId });
    expect(repeat).toHaveLength(1);
    expect(repeat[0].message).toMatch(/Kim Till has 3 sales flagged in the last 7 days/);
    expect(repeat[0].recipients).toContain(adaId);
    expect(repeat[0].recipients).not.toContain(alexId);
    await underMinSale(kimId);
    expect(await signals({ source: "price_guard_repeat", subject: kimId })).toHaveLength(1);
  });

  it("refunds: never blocked; the rules raise one exception and one Signal; Other needs a note", async () => {
    // Kim rang it, Sam refunds it: another cashier's sale.
    as(kimId);
    const sold = await request(app).post("/api/orders").send(sale([{ productId: plainId, quantity: 8, unitPrice: 10 }])).expect(201);
    const { eq } = await import("drizzle-orm");
    const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, sold.body.orderId));
    await settle(sold.body.orderId);
    as(samId);
    await request(app)
      .post(`/api/orders/${sold.body.orderId}/refunds`)
      .send({ reason: "other", refundMethod: "cash", lines: [{ orderLineId: lines[0].id, qty: 1 }] })
      .expect(400);
    const refund = await request(app)
      .post(`/api/orders/${sold.body.orderId}/refunds`)
      .send({ reason: "other", notes: "Customer said it was the wrong size", refundMethod: "cash", lines: [{ orderLineId: lines[0].id, qty: 6 }] })
      .expect(201);
    const [row] = await reviewFor("refund", { sourceId: refund.body.refund.id });
    expect(row.rules).toEqual(["cash_over", "other_cashier", "reason_other"]);
    expect(row).toMatchObject({ subjectUserId: samId, subjectRole: "CASHIER", severity: "error", amount: "60.00" });
    expect(row.summary).toMatch(/£60\.00 refund on order #\w+ by Sam Till: Cash refund over £50\.00; Refund on Kim Till's sale; Reason: Other/);
    const [signal] = await signals({ source: "refund_exception", orderId: sold.body.orderId });
    expect(signal.recipients).toEqual(expect.arrayContaining([alexId, morganId, adaId]));
    expect(signal.recipients).not.toContain(samId);

    // An ordinary refund by the cashier who rang it raises nothing.
    as(kimId);
    const plain = await request(app)
      .post(`/api/orders/${sold.body.orderId}/refunds`)
      .send({ reason: "damaged", refundMethod: "cash", lines: [{ orderLineId: lines[0].id, qty: 1 }] })
      .expect(201);
    expect(await reviewFor("refund", { sourceId: plain.body.refund.id })).toHaveLength(0);

    // A manager's refund goes to admins and the owner only.
    as(alexId);
    const mgr = await request(app)
      .post(`/api/orders/${sold.body.orderId}/refunds`)
      .send({ reason: "damaged", refundMethod: "cash", lines: [{ orderLineId: lines[0].id, qty: 1 }] })
      .expect(201);
    const [mgrRow] = await reviewFor("refund", { sourceId: mgr.body.refund.id });
    expect(mgrRow.subjectRole).toBe("MANAGER");
    const mgrSignal = (await signals({ source: "refund_exception", subject: alexId }))[0];
    expect(mgrSignal.recipients).toEqual(expect.arrayContaining([adaId, ownerId]));
    expect(mgrSignal.recipients).not.toContain(morganId);
  });

  it("the weekly line: N unreviewed for over 7 days, and the Monday Signal once", async () => {
    const res = await underMinSale(samId);
    const { eq, sql } = await import("drizzle-orm");
    await db
      .update(schema.exceptionReviews)
      .set({ createdAt: sql`now() - interval '8 days'` })
      .where(eq(schema.exceptionReviews.orderId, res.body.orderId));
    as(alexId);
    const inbox = (await request(app).get("/api/needs-a-look").expect(200)).body;
    expect(inbox.stale).toBeGreaterThanOrEqual(1);
    expect(inbox.staleLine).toBe(`${inbox.stale} unreviewed for over 7 days`);

    const { runWeeklyNeedsALook } = await import("../services/exceptionReviews");
    // Run as if a few days on (so the row is over 7 days old then too).
    // A Wednesday: nothing. Monday 10:00 London: once, however often it runs.
    // The first Monday (UTC calendar) at least 7 days on.
    const monday = new Date(Date.now() + 7 * 86_400_000);
    monday.setUTCHours(0, 0, 0, 0);
    while (monday.getUTCDay() !== 1) monday.setUTCDate(monday.getUTCDate() + 1);
    const atLocal = (d: Date, hourUtc: number) => new Date(`${d.toISOString().slice(0, 10)}T${String(hourUtc).padStart(2, "0")}:00:00Z`);
    await runWeeklyNeedsALook(atLocal(new Date(monday.getTime() + 2 * 86_400_000), 12));
    expect(await signals({ source: "needs_a_look_weekly" })).toHaveLength(0);
    // 06:00Z is before 09:00 local in either GMT or BST.
    await runWeeklyNeedsALook(atLocal(monday, 6));
    expect(await signals({ source: "needs_a_look_weekly" })).toHaveLength(0);
    await runWeeklyNeedsALook(atLocal(monday, 10));
    await runWeeklyNeedsALook(atLocal(monday, 11));
    const weekly = await signals({ source: "needs_a_look_weekly" });
    expect(weekly).toHaveLength(2);
    const managers = weekly.find((w) => (w.metadata as any).queue === "CASHIER")!;
    expect(managers.message).toMatch(/^\d+ unreviewed for over 7 days \(cashiers\)\.$/);
    expect(managers.recipients).toContain(alexId);
    expect(managers.recipients).not.toContain(samId);
  });

  it("Price overrides Evidence: by cashier, product and reason, cut by role", async () => {
    as(alexId);
    const ev = (await request(app).get("/api/evidence/price-overrides").expect(200)).body;
    const cashiers = ev.byCashier.map((g: { key: string }) => g.key);
    expect(cashiers).toEqual(expect.arrayContaining([samId, kimId]));
    expect(cashiers).not.toContain(morganId);
    expect(cashiers).not.toContain(alexId);
    const trade = ev.byReason.find((g: { key: string }) => g.key === "trade");
    expect(trade.name).toBe("Trade customer");
    expect(trade.lines).toBeGreaterThan(0);
    const widget = ev.byProduct.find((g: { key: string }) => g.key === widgetId);
    expect(widget.underList).toBeGreaterThan(0);
    expect(ev.refundWindowHours).toBe(24);

    as(adaId);
    const forAda = (await request(app).get("/api/evidence/price-overrides").expect(200)).body;
    expect(forAda.byCashier.map((g: { key: string }) => g.key)).toContain(morganId);
    as(samId);
    await request(app).get("/api/evidence/price-overrides").expect(403);
  });

  it("refunds by the same cashier within N hours of a flagged sale are counted", async () => {
    const res = await underMinSale(kimId);
    const { eq } = await import("drizzle-orm");
    const [line] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, res.body.orderId));
    await settle(res.body.orderId);
    as(kimId);
    await request(app)
      .post(`/api/orders/${res.body.orderId}/refunds`)
      .send({ reason: "damaged", refundMethod: "cash", lines: [{ orderLineId: line.id, qty: 1 }] })
      .expect(201);
    as(adaId);
    const ev = (await request(app).get("/api/evidence/price-overrides").expect(200)).body;
    const kim = ev.byCashier.find((g: { key: string }) => g.key === kimId);
    expect(kim.refundsWithinHours).toBe(1);
  });

  it("a cashier's shift summary carries their own count only", async () => {
    const openedAt = new Date(Date.now() - 3_600_000);
    const [shift] = await db
      .insert(schema.cashierShifts)
      .values({ orgId, userId: samId, openedByUserId: samId, openedAt, status: "open", tradingDay: "2000-01-01" })
      .returning();
    as(samId);
    const summary = (await request(app).get(`/api/cashier-shifts/${shift.id}/summary`).expect(200)).body;
    const { ownExceptionCount } = await import("../services/exceptionReviews");
    const expected = await ownExceptionCount(orgId, samId, openedAt, null);
    expect(expected).toBeGreaterThan(0);
    expect(summary.priceOverrideCount).toBe(expected);
    // A count, nothing else about the flagged sales.
    expect(JSON.stringify(summary)).not.toMatch(/under minimum|underCost/);
  });

  it("a cashier's own count leaves out a sale flagged only as below cost (the till never warned)", async () => {
    // Minimum £3 but cost £5: £4 is above the till floor, below cost.
    const [under] = await db
      .insert(schema.products)
      .values({ orgId, locationId, name: "Look Under", productId: `NAL-U-${tag}`, defaultSalePrice: "6.00", minPrice: "3.00", costPrice: "5.00", stock: 1000 })
      .returning();
    await db.insert(schema.productLocationStock).values({ orgId, productId: under.id, locationId, stock: 1000 });
    const openedAt = new Date(Date.now() - 60_000);
    const { ownExceptionCount } = await import("../services/exceptionReviews");
    const before = await ownExceptionCount(orgId, samId, openedAt, null);
    as(samId);
    const res = await request(app).post("/api/orders").send(sale([{ productId: under.id, quantity: 1, unitPrice: 4 }])).expect(201);
    // Managers are told; it is in Needs a look about Sam.
    const [row] = await reviewFor("price", { orderId: res.body.orderId });
    expect(row).toMatchObject({ subjectUserId: samId, severity: "error" });
    expect(row.summary).toMatch(/below cost/);
    // Sam's own count does not move: it would tell Sam the item's cost.
    expect(await ownExceptionCount(orgId, samId, openedAt, null)).toBe(before);
    // A sale the till did warn about still counts.
    await underMinSale(samId);
    expect(await ownExceptionCount(orgId, samId, openedAt, null)).toBe(before + 1);
  });

  // Its own product, so these edits stay out of the Weekly Margin figures below.
  let editId = "";
  const editProduct = async () => {
    if (editId) return editId;
    const [p] = await db
      .insert(schema.products)
      .values({ orgId, locationId, name: "Look Edit", productId: `NAL-E-${tag}`, defaultSalePrice: "10.00", costPrice: "6.00", stock: 1000 })
      .returning();
    await db.insert(schema.productLocationStock).values({ orgId, productId: p.id, locationId, stock: 1000 });
    editId = p.id;
    return editId;
  };

  it("a manager's edit below minimum and cost is their own exception: admins and the owner are told", async () => {
    await editProduct();
    as(samId);
    const sold = await request(app).post("/api/orders").send(sale([{ productId: editId, quantity: 1, unitPrice: 10 }])).expect(201);
    const orderId = sold.body.orderId;
    expect(await reviewFor("price", { orderId })).toHaveLength(0);

    as(alexId);
    await request(app).put(`/api/orders/${orderId}`).send({ lines: [{ productId: editId, quantity: 1, unitPrice: 2 }] }).expect(200);
    const { eq } = await import("drizzle-orm");
    const guards = await db.select().from(schema.priceGuardOrders).where(eq(schema.priceGuardOrders.orderId, orderId));
    expect(guards).toHaveLength(1);
    expect(guards[0]).toMatchObject({ source: "edit", userId: alexId, reason: null, confirmed: null, severity: "error", linesBelowCost: 1 });
    const [row] = await reviewFor("price", { orderId });
    expect(row).toMatchObject({ subjectUserId: alexId, subjectRole: "MANAGER", state: "open" });
    expect(row.summary).toMatch(/under minimum on order #\w+ edited by Alex Boss: 1 line, reason: price changed after the sale/);
    const told = await signals({ orderId, source: "price_guard" });
    expect(told).toHaveLength(1);
    expect(told[0].title).toMatch(/after an edit — Alex Boss/);
    expect(told[0].recipients).toEqual(expect.arrayContaining([adaId, ownerId]));
    expect(told[0].recipients).not.toContain(morganId);
    expect(told[0].recipients).not.toContain(samId);

    // The same lines again is not a new breach: recorded once.
    await request(app).put(`/api/orders/${orderId}`).send({ lines: [{ productId: editId, quantity: 1, unitPrice: 2 }] }).expect(200);
    expect(await db.select().from(schema.priceGuardOrders).where(eq(schema.priceGuardOrders.orderId, orderId))).toHaveLength(1);

    // A breach the sale already had stays the cashier's; the edit adds its own.
    const flagged = await underMinSale(samId);
    as(alexId);
    await request(app)
      .put(`/api/orders/${flagged.body.orderId}`)
      .send({ lines: [{ productId: widgetId, quantity: 1, unitPrice: 3 }, { productId: editId, quantity: 1, unitPrice: 1 }] })
      .expect(200);
    const both = await db.select().from(schema.priceGuardOrders).where(eq(schema.priceGuardOrders.orderId, flagged.body.orderId));
    expect(both.map((g) => [g.source, g.userId, g.flaggedLines]).sort()).toEqual([
      ["edit", alexId, 1],
      ["sale", samId, 1],
    ]);
  });

  it("with the switch off, an edit is left to silent recording and held round-ups are dropped", async () => {
    await editProduct();
    const { eq } = await import("drizzle-orm");
    await setRules({ priceGuardMinSignal: "twice_daily" });
    const held = await underMinSale(samId);
    await db.update(schema.organizations).set({ priceGuardEnabled: false }).where(eq(schema.organizations.id, orgId));
    try {
      as(samId);
      const sold = await request(app).post("/api/orders").send(sale([{ productId: editId, quantity: 1, unitPrice: 10 }])).expect(201);
      as(alexId);
      await request(app).put(`/api/orders/${sold.body.orderId}`).send({ lines: [{ productId: editId, quantity: 1, unitPrice: 2 }] }).expect(200);
      expect(await db.select().from(schema.priceGuardOrders).where(eq(schema.priceGuardOrders.orderId, sold.body.orderId))).toHaveLength(0);
      // Silent recording still has the manager's line.
      const silent = await db.select().from(schema.priceExceptions).where(eq(schema.priceExceptions.orderId, sold.body.orderId));
      expect(silent.map((r) => [r.source, r.userId])).toEqual([["edit", alexId]]);

      // Signals have stopped: the held round-up is not sent, and not kept for later.
      const { sendDigestForOrg } = await import("../services/priceGuardDigest");
      expect(await sendDigestForOrg(orgId, new Date(Date.now() + 1000))).toBe(0);
      expect(await signals({ orderId: held.body.orderId, source: "price_guard_digest" })).toHaveLength(0);
      const [guard] = await db.select().from(schema.priceGuardOrders).where(eq(schema.priceGuardOrders.orderId, held.body.orderId));
      expect(guard.signalPending).toBe(false);
      // Still in Needs a look.
      expect(await reviewFor("price", { orderId: held.body.orderId })).toHaveLength(1);
    } finally {
      await db.update(schema.organizations).set({ priceGuardEnabled: true }).where(eq(schema.organizations.id, orgId));
      await setRules({ priceGuardMinSignal: "immediate" });
    }
  });

  it('bulk "Set minimum price": manager and above, preview then apply, price history, the owner told', async () => {
    const body = { productIds: [plainId, lossId], rule: { kind: "sale_minus_pct", percent: 10 } };
    as(samId);
    await request(app).post("/api/products/min-price/preview").send(body).expect(403);
    as(alexId);
    const preview = (await request(app).post("/api/products/min-price/preview").send(body).expect(200)).body.rows;
    expect(preview.map((r: any) => [r.name, r.oldMin, r.newMin, r.changed])).toEqual([
      ["Look Plain", null, 9, true],
      ["Look Thin", null, 4.5, true],
    ]);
    const { eq, inArray } = await import("drizzle-orm");
    const [untouched] = await db.select().from(schema.products).where(eq(schema.products.id, plainId));
    expect(untouched.minPrice).toBeNull();

    const applied = (await request(app).post("/api/products/min-price/apply").send(body).expect(200)).body;
    expect(applied).toMatchObject({ changed: 2, skipped: 0 });
    const after = await db.select().from(schema.products).where(inArray(schema.products.id, [plainId, lossId]));
    expect(after.map((p) => p.minPrice).sort()).toEqual(["4.50", "9.00"]);
    const history = await db.select().from(schema.productPriceHistory).where(eq(schema.productPriceHistory.productId, plainId));
    expect(history.find((h) => h.source === "bulk")).toMatchObject({ field: "min", oldValue: null, newValue: "9.00", changedBy: alexId });
    const told = await signals({ source: "bulk_min_price" });
    expect(told).toHaveLength(1);
    expect(told[0].recipients).toContain(ownerId);
    for (const id of [alexId, morganId, adaId, samId]) expect(told[0].recipients).not.toContain(id);
    expect(told[0].message).toMatch(/Alex Boss set the minimum price on 2 products to sale price −10%/);

    // An admin's bulk change does not ping the owner; cost + x% without a cost is skipped.
    as(adaId);
    const again = (await request(app).post("/api/products/min-price/apply").send({ productIds: [plainId], rule: { kind: "follow" } }).expect(200)).body;
    expect(again.changed).toBe(1);
    expect(await signals({ source: "bulk_min_price" })).toHaveLength(1);
  });

  it("Weekly Margin is flagged by the price policy, not a 20% margin rule", async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`UPDATE orders SET status = 'completed', settled_at = COALESCE(settled_at, created_at) WHERE org_id = ${orgId}`);
    // A plain sale at list: a healthy margin, within policy.
    as(samId);
    const atList = await request(app).post("/api/orders").send(sale([{ productId: plainId, quantity: 1, unitPrice: 10 }])).expect(201);
    await db.execute(sql`UPDATE orders SET status = 'completed', settled_at = created_at WHERE id = ${atList.body.orderId}`);
    const { weeklyMarginSummary } = await import("../services/reportsEngine");
    const from = new Date(Date.now() - 2 * 86_400_000);
    const to = new Date(Date.now() + 86_400_000);
    const report: any = await weeklyMarginSummary(orgId, from, to);
    const widget = report.rows.find((r: any) => r.product === "Look Widget");
    expect(widget.policyFlag).toBe("below_minimum");
    expect(widget.belowMinimumLines).toBeGreaterThan(0);
    const thin = report.rows.find((r: any) => r.product === "Look Thin");
    expect(thin.policyFlag).toBe("below_cost");
    // "Look Plain" sold at list with a 40% margin: within policy, no flag.
    const plain = report.rows.find((r: any) => r.product === "Look Plain");
    expect(plain.policyFlag).toBe("ok");
    expect(report.redFlags.some((f: string) => /below 20%/.test(f))).toBe(false);
    expect(report.redFlags.some((f: string) => /Look Thin: \d+ sale line\(s\) below cost/.test(f))).toBe(true);
  });
});
