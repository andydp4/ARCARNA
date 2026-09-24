/**
 * "This customer already owes" at order start, and Take a payment at the till
 * (v1.2.1 credit), against a real database.
 *
 *  - Any member of staff who starts an order reads ONE customer's total, tab
 *    count and oldest date, and nothing else; another org's customer is not
 *    found.
 *  - A payment goes through the Phase 1 repayment path: oldest tab first,
 *    the balance comes down by exactly the amount, the payment is stamped to
 *    the recorder's till shift, and cash raises that drawer's expected cash
 *    by exactly the amount (card does not).
 *  - More than is owed, a transfer, a backdate or no method is refused and
 *    nothing is written.
 *  - A card payment below admin raises the same Signal a Credit List one does.
 *  - The Credit List's own part payment still allocates oldest first through
 *    the shared service.
 *  - The usage record stores a 'credit' event (migration 220).
 *
 * In CI's unit-db job by explicit file name. `../db` is imported inside
 * beforeAll, so the no-DATABASE_URL run only skips it.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { shiftIsoDate } from "@shared/time/tradingDay";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("already owes at order start, and Take a payment", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  let today: string;
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const customerId = randomUUID();
  const otherCustomerId = randomUUID();
  const quietCustomerId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const id = (who: string) => `ccr-${who}-${tag}`;
  const roles: Record<string, string> = { cashier: "CASHIER", manager: "MANAGER", admin: "ADMIN" };
  let as = "cashier";
  let locationId = "";
  let oldOrder = "";
  let newOrder = "";

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    const { tradingDayTodayForOrg } = await import("../services/creditLedger");
    await db.insert(schema.organizations).values([
      { id: orgId, name: "ZZ Credit At Till Test" },
      { id: otherOrgId, name: "ZZ Credit At Till Other" },
    ]);
    await db.insert(schema.allowedUsers).values(
      Object.entries(roles).map(([who, role]) => ({
        replitUserId: id(who),
        authUserId: id(who),
        name: who,
        role: role as any,
        orgId,
      })),
    );
    const [loc] = await db
      .insert(schema.locations)
      .values({
        orgId,
        name: "Till Test Shop",
        address: "1 Test Row",
        city: "Testville",
        state: "TS",
        zipCode: "TS1",
        phone: "07700 900001",
        email: "shop@example.invalid",
      })
      .returning();
    locationId = loc.id;
    await db.insert(schema.customers).values([
      { id: customerId, orgId, name: "Tab Customer" },
      { id: quietCustomerId, orgId, name: "No Tab Customer" },
      { id: otherCustomerId, orgId: otherOrgId, name: "Other Org Customer" },
    ]);
    today = await tradingDayTodayForOrg(orgId);

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId, role: roles[as] };
      req.user = { id: id(as), role: roles[as], claims: { sub: id(as) } };
      next();
    };
    const { registerCustomerCreditRoutes } = await import("../routes/customerCredit");
    const { registerTickCustomerRoutes } = await import("../routes/tickCustomers");
    const { registerShiftRoutes } = await import("../routes/shifts");
    app = express();
    app.use(express.json());
    registerCustomerCreditRoutes(app, [scoped]);
    registerTickCustomerRoutes(app, [scoped]);
    registerShiftRoutes(app, [scoped]);
  });

  async function clearMoney() {
    await db.delete(schema.cashierCommissionEntries).where(eq(schema.cashierCommissionEntries.orgId, orgId));
    await db.delete(schema.creditPayments).where(eq(schema.creditPayments.orgId, orgId));
    await db.delete(schema.orderCredit).where(inArray(schema.orderCredit.orgId, [orgId, otherOrgId]));
    await db.delete(schema.invoices).where(eq(schema.invoices.orgId, orgId)).catch(() => undefined);
    await db.delete(schema.orders).where(inArray(schema.orders.orgId, [orgId, otherOrgId]));
    await db.delete(schema.shifts).where(eq(schema.shifts.orgId, orgId));
    await db.delete(schema.orgNotifications).where(eq(schema.orgNotifications.orgId, orgId));
  }

  async function tab(orderId: string, customer: string, org: string, amount: string, daysAgo: number, outstanding = amount) {
    await db.insert(schema.orders).values({
      id: orderId,
      orgId: org,
      customerId: customer,
      total: amount,
      paymentMethod: "tick",
      status: "completed",
    } as never);
    await db.insert(schema.orderCredit).values({
      orderId,
      orgId: org,
      customerId: customer,
      amountGiven: amount,
      amountOutstanding: outstanding,
      status: outstanding === amount ? "outstanding" : "partial",
      givenOn: shiftIsoDate(today, -daysAgo),
    });
  }

  beforeEach(async () => {
    await clearMoney();
    oldOrder = randomUUID();
    newOrder = randomUUID();
    await tab(oldOrder, customerId, orgId, "30.00", 20);
    await tab(newOrder, customerId, orgId, "12.50", 3);
    // Settled and other-org tabs never count.
    const settled = randomUUID();
    await tab(settled, customerId, orgId, "99.00", 40, "0.00");
    await db.update(schema.orderCredit).set({ status: "settled" }).where(eq(schema.orderCredit.orderId, settled));
    await tab(randomUUID(), otherCustomerId, otherOrgId, "50.00", 5);
  });

  afterAll(async () => {
    if (!db) return;
    await clearMoney();
    await db.delete(schema.usageEvents).where(eq(schema.usageEvents.orgId, orgId));
    await db.delete(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.orgId, orgId));
    await db.delete(schema.customers).where(inArray(schema.customers.orgId, [orgId, otherOrgId]));
    await db.delete(schema.locations).where(eq(schema.locations.orgId, orgId));
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, Object.keys(roles).map(id)));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId, otherOrgId]));
  });

  const get = (who: string, path: string) => {
    as = who;
    return request(app).get(path);
  };
  const post = (who: string, path: string, body: Record<string, unknown> = {}) => {
    as = who;
    return request(app).post(path).send(body);
  };

  const summary = async (who = "cashier") => (await get(who, `/api/customers/${customerId}/credit-summary`).expect(200)).body;

  async function outstandingByOrder() {
    const rows = await db
      .select({ orderId: schema.orderCredit.orderId, left: schema.orderCredit.amountOutstanding })
      .from(schema.orderCredit)
      .where(eq(schema.orderCredit.customerId, customerId));
    return Object.fromEntries(rows.map((r) => [r.orderId, Number(r.left)]));
  }

  async function expectedCash(shiftId: string): Promise<number> {
    const res = await get("cashier", `/api/shifts/${shiftId}/report`).expect(200);
    return res.body.report.cashSummary.expectedCash;
  }

  it("tells a cashier this customer's total, tab count and oldest date, and nothing else", async () => {
    const body = await summary("cashier");
    expect(body).toEqual({
      customerId,
      owed: 42.5,
      tabs: 2,
      oldestGivenOn: shiftIsoDate(today, -20),
    });
  });

  it("says nothing is owed for a customer with no tabs", async () => {
    const res = await get("cashier", `/api/customers/${quietCustomerId}/credit-summary`).expect(200);
    expect(res.body).toEqual({ customerId: quietCustomerId, owed: 0, tabs: 0, oldestGivenOn: null });
  });

  it("does not find another org's customer, to read or to pay", async () => {
    await get("cashier", `/api/customers/${otherCustomerId}/credit-summary`).expect(404);
    await post("cashier", `/api/customers/${otherCustomerId}/credit-payments`, { amount: 5, method: "cash" }).expect(404);
    const [other] = await db
      .select({ left: schema.orderCredit.amountOutstanding })
      .from(schema.orderCredit)
      .where(eq(schema.orderCredit.customerId, otherCustomerId));
    expect(Number(other.left)).toBe(50);
  });

  it("a cash payment of £X brings the balance down by exactly £X, oldest tab first, and raises expected cash by £X", async () => {
    // The drawer opens on first use, as the first sale opens it.
    const first = await post("cashier", `/api/customers/${customerId}/credit-payments`, { amount: 0.01, method: "cash" }).expect(201);
    const shiftId = first.body.drawerShiftId as string;
    expect(shiftId).toBeTruthy();
    const cashBefore = await expectedCash(shiftId);
    const owedBefore = (await summary()).owed;

    const res = await post("cashier", `/api/customers/${customerId}/credit-payments`, { amount: 17.37, method: "cash" }).expect(201);
    expect(res.body).toMatchObject({ amountPaid: 17.37, method: "cash", drawerShiftId: shiftId });
    expect(res.body.summary.owed).toBe(Math.round((owedBefore - 17.37) * 100) / 100);
    expect((await summary()).owed).toBe(Math.round((owedBefore - 17.37) * 100) / 100);
    expect(await expectedCash(shiftId)).toBe(Math.round((cashBefore + 17.37) * 100) / 100);

    // Oldest first: £30 tab takes it all, the newer £12.50 is untouched.
    const left = await outstandingByOrder();
    expect(left[oldOrder]).toBe(Math.round((30 - 0.01 - 17.37) * 100) / 100);
    expect(left[newOrder]).toBe(12.5);

    const payments = await db
      .select()
      .from(schema.creditPayments)
      .where(eq(schema.creditPayments.orgId, orgId));
    expect(payments.every((p) => p.shiftId === shiftId && p.method === "cash" && p.recordedByUserId === id("cashier"))).toBe(true);
  });

  it("pays across tabs and clears the account when paid in full", async () => {
    const res = await post("cashier", `/api/customers/${customerId}/credit-payments`, { amount: 42.5, method: "cash" }).expect(201);
    expect(res.body.tabsPaid).toBe(2);
    expect(res.body.summary).toEqual({ customerId, owed: 0, tabs: 0, oldestGivenOn: null });
    const statuses = await db
      .select({ status: schema.orderCredit.status })
      .from(schema.orderCredit)
      .where(inArray(schema.orderCredit.orderId, [oldOrder, newOrder]));
    expect(statuses.map((s) => s.status)).toEqual(["settled", "settled"]);
  });

  it("a card payment brings the balance down but not expected cash, and tells the managers", async () => {
    const first = await post("cashier", `/api/customers/${customerId}/credit-payments`, { amount: 1, method: "cash" }).expect(201);
    const shiftId = first.body.drawerShiftId as string;
    const cashBefore = await expectedCash(shiftId);

    await post("cashier", `/api/customers/${customerId}/credit-payments`, { amount: 10, method: "card" }).expect(201);
    expect((await summary()).owed).toBe(31.5);
    expect(await expectedCash(shiftId)).toBe(cashBefore);

    const signals = await db
      .select()
      .from(schema.orgNotifications)
      .where(and(eq(schema.orgNotifications.orgId, orgId), eq(schema.orgNotifications.source, "credit_payment")));
    expect(signals).toHaveLength(1);
    expect(signals[0].message).toMatch(/£10\.00 from Tab Customer by card/);
  });

  it("refuses more than is owed, a transfer, a backdate or no method, and writes nothing", async () => {
    const bad = [
      [{ amount: 42.51, method: "cash" }, "CREDIT_OVERPAYMENT"],
      [{ amount: 5, method: "transfer" }, "CREDIT_METHOD_INVALID"],
      [{ amount: 5, method: "cash", paidOn: shiftIsoDate(today, -1) }, "CREDIT_BACKDATE_AT_TILL"],
      [{ amount: 5 }, "CREDIT_METHOD_REQUIRED"],
      [{ amount: 0, method: "cash" }, "CREDIT_AMOUNT_INVALID"],
      [{ amount: -5, method: "cash" }, "CREDIT_AMOUNT_INVALID"],
    ] as const;
    for (const [body, code] of bad) {
      const res = await post("cashier", `/api/customers/${customerId}/credit-payments`, body as never);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe(code);
    }
    const payments = await db.select().from(schema.creditPayments).where(eq(schema.creditPayments.orgId, orgId));
    expect(payments).toHaveLength(0);
    expect((await summary()).owed).toBe(42.5);
  });

  it("has nothing to take for a customer who owes nothing", async () => {
    const res = await post("cashier", `/api/customers/${quietCustomerId}/credit-payments`, { amount: 1, method: "cash" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CREDIT_NOTHING_OWED");
  });

  it("keeps the Credit List itself manager and above", async () => {
    await get("cashier", "/api/tick-customers").expect(403);
    await post("cashier", `/api/tick-customers/${customerId}/payments`, { amount: 5 }).expect(403);
  });

  it("the Credit List's part payment still goes oldest tab first through the shared service", async () => {
    const res = await post("manager", `/api/tick-customers/${customerId}/payments`, { amount: 35, method: "cash" }).expect(201);
    expect(res.body.applied).toEqual([
      { orderId: oldOrder, amount: 30 },
      { orderId: newOrder, amount: 5 },
    ]);
    expect(res.body.amountApplied).toBe(35);
    expect(res.body.remainingOwed).toBe(7.5);
    const over = await post("manager", `/api/tick-customers/${customerId}/payments`, { amount: 8, method: "cash" });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe("CREDIT_OVERPAYMENT");
  });

  it("the usage record keeps the notice shown and paid (migration 220)", async () => {
    const { recordUsageBatch } = await import("../services/usage");
    const at = new Date().toISOString();
    const res = await recordUsageBatch({
      orgId,
      role: "CASHIER",
      input: {
        deviceKey: `dev${tag}xyz`,
        events: [
          { kind: "credit", at, screen: "/create-order", step: "shown" },
          { kind: "credit", at, screen: "/create-order", step: "paid" },
        ],
      },
    });
    expect(res.accepted).toBe(2);
    const rows = await db
      .select({ kind: schema.usageEvents.kind, label: schema.usageEvents.label })
      .from(schema.usageEvents)
      .where(eq(schema.usageEvents.orgId, orgId));
    expect(rows.map((r) => `${r.kind}:${r.label}`).sort()).toEqual(["credit:paid", "credit:shown"]);
  });
});
