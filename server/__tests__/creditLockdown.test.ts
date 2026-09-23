/**
 * Credit, invoices and gift cards (v1.2 Phase 0B part 7, FIX-12 / FIX-13,
 * owner decision Q11) against a real database: the Credit List and Invoices
 * are manager and above, payments are validated and dated within the order
 * window, a card or transfer payment below admin raises a Signal for the
 * people above the recorder, and gift cards are issued by managers with a
 * reason. In CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { shiftIsoDate } from "@shared/time/tradingDay";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("credit, invoices and gift cards lock-down", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let today: string;
  let app: express.Express;
  const orgId = randomUUID();
  const customerId = randomUUID();
  let orderId = "";
  const tag = randomUUID().slice(0, 8);
  const id = (who: string) => `crd-${who}-${tag}`;
  const roles: Record<string, string> = { cashier: "CASHIER", manager: "MANAGER", admin: "ADMIN" };
  let as = "manager";

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    const { tradingDayTodayForOrg } = await import("../services/creditLedger");
    await db.insert(schema.organizations).values({ id: orgId, name: "ZZ Credit Lockdown Test" });
    await db.insert(schema.allowedUsers).values(
      Object.entries(roles).map(([who, role]) => ({
        replitUserId: id(who),
        authUserId: id(who),
        name: who,
        role: role as any,
        orgId,
      })),
    );
    await db.insert(schema.customers).values({ id: customerId, orgId, name: "Tab Customer" });
    today = await tradingDayTodayForOrg(orgId);

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role: roles[as] };
      req.user = { id: id(as), role: roles[as], claims: { sub: id(as) } };
      next();
    };
    const { registerTickCustomerRoutes } = await import("../routes/tickCustomers");
    const { registerCreditRoutes } = await import("../routes/credit");
    const { registerInvoiceRoutes } = await import("../routes/invoices");
    const { registerGiftCardRoutes } = await import("../routes/giftCards");
    app = express();
    app.use(express.json());
    registerTickCustomerRoutes(app, [scoped]);
    registerCreditRoutes(app, [scoped]);
    registerInvoiceRoutes(app, [scoped]);
    registerGiftCardRoutes(app, [scoped]);
  });

  beforeEach(async () => {
    await db.delete(schema.cashierCommissionEntries).where(eq(schema.cashierCommissionEntries.orgId, orgId));
    await db.delete(schema.creditPayments).where(eq(schema.creditPayments.orgId, orgId));
    await db.delete(schema.orderCredit).where(eq(schema.orderCredit.orgId, orgId));
    await db.delete(schema.orders).where(eq(schema.orders.orgId, orgId));
    await db.delete(schema.orgNotifications).where(eq(schema.orgNotifications.orgId, orgId));
    orderId = randomUUID();
    await db.insert(schema.orders).values({
      id: orderId,
      orgId,
      customerId,
      total: "100.00",
      paymentMethod: "tick",
      status: "completed",
    } as never);
    await db.insert(schema.orderCredit).values({
      orderId,
      orgId,
      customerId,
      amountGiven: "100.00",
      amountOutstanding: "100.00",
      status: "outstanding",
      givenOn: shiftIsoDate(today, -10),
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.cashierCommissionEntries).where(eq(schema.cashierCommissionEntries.orgId, orgId));
    await db.delete(schema.creditPayments).where(eq(schema.creditPayments.orgId, orgId));
    await db.delete(schema.orderCredit).where(eq(schema.orderCredit.orgId, orgId));
    await db.delete(schema.orders).where(eq(schema.orders.orgId, orgId));
    const cards = await db.select({ id: schema.giftCards.id }).from(schema.giftCards).where(eq(schema.giftCards.orgId, orgId));
    if (cards.length) {
      await db.delete(schema.giftCardMovements).where(inArray(schema.giftCardMovements.giftCardId, cards.map((c) => c.id)));
      await db.delete(schema.giftCards).where(eq(schema.giftCards.orgId, orgId));
    }
    await db.delete(schema.orgNotifications).where(eq(schema.orgNotifications.orgId, orgId));
    await db.delete(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.orgId, orgId));
    await db.delete(schema.customers).where(eq(schema.customers.orgId, orgId));
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, Object.keys(roles).map(id)));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  const post = (who: string, path: string, body: Record<string, unknown> = {}) => {
    as = who;
    return request(app).post(path).send(body);
  };
  const get = (who: string, path: string) => {
    as = who;
    return request(app).get(path);
  };

  async function creditSignals() {
    const signals = await db
      .select()
      .from(schema.orgNotifications)
      .where(and(eq(schema.orgNotifications.orgId, orgId), eq(schema.orgNotifications.source, "credit_payment")));
    const recipients = signals.length
      ? await db
          .select({ userId: schema.orgNotificationRecipients.userId })
          .from(schema.orgNotificationRecipients)
          .where(inArray(schema.orgNotificationRecipients.notificationId, signals.map((s) => s.id)))
      : [];
    return { signals, recipients: recipients.map((r) => r.userId).filter((u) => u.endsWith(tag)).sort() };
  }

  it("refuses a cashier every Credit List, invoice and gift-card issue route", async () => {
    await get("cashier", "/api/tick-customers").expect(403);
    await get("cashier", "/api/credit/outstanding").expect(403);
    await post("cashier", `/api/credit/${orderId}/payments`, { amount: 5 }).expect(403);
    await post("cashier", `/api/tick-customers/${customerId}/payments`, { amount: 5 }).expect(403);
    await post("cashier", `/api/tick-customers/${customerId}/mark-paid`, { expectedBalance: 100 }).expect(403);
    await get("cashier", "/api/invoices").expect(403);
    await get("cashier", `/api/invoices/${orderId}/pdf`).expect(403);
    await post("cashier", "/api/gift-cards", { amount: 10, reason: "a present" }).expect(403);
    await get("manager", "/api/tick-customers").expect(200);
    await get("manager", "/api/invoices").expect(200);
  });

  it("refuses a payment method that is not cash, card or transfer", async () => {
    const res = await post("manager", `/api/credit/${orderId}/payments`, { amount: 5, method: "bitcoin" }).expect(400);
    expect(res.body.code).toBe("CREDIT_METHOD_INVALID");
    await post("manager", `/api/tick-customers/${customerId}/payments`, { amount: 5, method: "gift" }).expect(400);
    const payments = await db.select().from(schema.creditPayments).where(eq(schema.creditPayments.orgId, orgId));
    expect(payments).toHaveLength(0);
  });

  it("lets a manager backdate within the window, and no further or into the future", async () => {
    const threeBack = shiftIsoDate(today, -3);
    await post("manager", `/api/tick-customers/${customerId}/payments`, { amount: 10, method: "cash", paidOn: threeBack }).expect(201);
    const [payment] = await db.select().from(schema.creditPayments).where(eq(schema.creditPayments.orgId, orgId));
    expect(payment.paidOn).toBe(threeBack);

    const tooFar = await post("manager", `/api/credit/${orderId}/payments`, { amount: 5, paidOn: shiftIsoDate(today, -8) }).expect(400);
    expect(tooFar.body.code).toBe("CREDIT_DATE_OUT_OF_RANGE");
    const future = await post("manager", `/api/credit/${orderId}/payments`, { amount: 5, paidOn: shiftIsoDate(today, 1) }).expect(400);
    expect(future.body.code).toBe("CREDIT_DATE_FUTURE");
  });

  it("a card payment by a manager tells the people above them, not the manager", async () => {
    await post("manager", `/api/tick-customers/${customerId}/payments`, { amount: 20, method: "card" }).expect(201);
    const { signals, recipients } = await creditSignals();
    expect(signals).toHaveLength(1);
    expect(signals[0].subjectUserId).toBe(id("manager"));
    expect(signals[0].message).toContain("£20.00");
    expect(signals[0].message).toContain("Tab Customer");
    expect(recipients).toEqual([id("admin")]);
  });

  it("cash payments, and card payments by an admin, raise no Signal", async () => {
    await post("manager", `/api/credit/${orderId}/payments`, { amount: 5, method: "cash" }).expect(201);
    await post("admin", `/api/credit/${orderId}/payments`, { amount: 5, method: "transfer" }).expect(201);
    expect((await creditSignals()).signals).toHaveLength(0);
  });

  it("clearing a whole tab needs the exact balance", async () => {
    const stale = await post("manager", `/api/tick-customers/${customerId}/mark-paid`, { expectedBalance: 80 }).expect(409);
    expect(stale.body.code).toBe("CREDIT_BALANCE_CHANGED");
    await post("manager", `/api/tick-customers/${customerId}/mark-paid`, {}).expect(400);
    const ok = await post("manager", `/api/tick-customers/${customerId}/mark-paid`, { expectedBalance: 100, method: "transfer" }).expect(200);
    expect(ok.body.amountSettled).toBe(100);
    expect((await creditSignals()).signals).toHaveLength(1);
  });

  describe("gift cards", () => {
    it("are issued by managers with a reason, which is logged", async () => {
      const noReason = await post("manager", "/api/gift-cards", { amount: 10 }).expect(400);
      expect(JSON.stringify(noReason.body)).toMatch(/reason/i);
      await post("manager", "/api/gift-cards", { amount: 10, reason: "  " }).expect(400);

      const issued = await post("manager", "/api/gift-cards", { amount: 10, reason: "Goodwill after a late order" }).expect(201);
      const [audit] = await db
        .select()
        .from(schema.adminAuditLogs)
        .where(and(eq(schema.adminAuditLogs.orgId, orgId), eq(schema.adminAuditLogs.action, "gift_card.issued")));
      expect((audit.metadata as any).reason).toBe("Goodwill after a late order");

      // /redeem is now /validate, same behaviour: it checks, it moves nothing.
      as = "cashier";
      await request(app).post(`/api/gift-cards/${issued.body.code}/redeem`).send({ amount: 5 }).expect(404);
      const validated = await request(app).post(`/api/gift-cards/${issued.body.code}/validate`).send({ amount: 5 }).expect(200);
      expect(validated.body.giftCard.balance).toBe(10);
    });
  });
});
