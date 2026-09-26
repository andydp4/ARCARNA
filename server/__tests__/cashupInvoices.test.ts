/**
 * Cash-up and invoices (v1.2 Phase 1C, WID-01 / WID-03 / CMP-07) against a
 * real database:
 *  - a cash tab repayment is stamped to the recorder's open till shift and
 *    raises that drawer's expected cash, on its own Z-report line; card,
 *    backdated and no-till payments do not;
 *  - "Clear account" needs Paid by;
 *  - a Z-report closed before the rule says so;
 *  - a tab sale gets a numbered invoice on the org's terms, made out to the
 *    customer's name as it was, whose status follows the one rule;
 *  - a plain till sale has a receipt, not an invoice, until the customer asks.
 * In CI's unit-db job by explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { shiftIsoDate } from "@shared/time/tradingDay";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("cash-up and invoices (1C)", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  let today = "";
  const orgId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const managerId = `c1c-manager-${tag}`;
  const otherManagerId = `c1c-other-${tag}`;
  let as = managerId;
  let locationId = "";
  let shiftId = "";

  async function customer(name: string) {
    const [row] = await db.insert(schema.customers).values({ orgId, name }).returning();
    return row.id;
  }

  /** A sale; `tick` of it on the customer's tab, the rest paid in cash. */
  async function sale(opts: { total: number; tick: number; customerId: string | null }) {
    const orderId = randomUUID();
    await db.insert(schema.orders).values({
      id: orderId,
      orgId,
      customerId: opts.customerId,
      total: opts.total.toFixed(2),
      paymentMethod: opts.tick > 0 ? "tick" : "cash",
      status: "completed",
      vatRate: "0",
      vatAmount: "0",
    } as never);
    const legs = [
      ...(opts.tick > 0 ? [{ method: "tick", amount: opts.tick }] : []),
      ...(opts.total - opts.tick > 0 ? [{ method: "cash", amount: opts.total - opts.tick }] : []),
    ];
    if (legs.length > 1) {
      await db.insert(schema.orderPayments).values(
        legs.map((l) => ({ orgId, orderId, method: l.method, amount: l.amount.toFixed(2) })) as never,
      );
    }
    if (opts.tick > 0) {
      const { openCreditForOrder } = await import("../services/creditLedger");
      await db.transaction((tx) =>
        openCreditForOrder(orgId, { id: orderId, customerId: opts.customerId, amount: opts.tick }, tx),
      );
    }
    return orderId;
  }

  const post = (path: string, body: Record<string, unknown> = {}, who = managerId) => {
    as = who;
    return request(app).post(path).send(body);
  };
  const get = (path: string, who = managerId) => {
    as = who;
    return request(app).get(path);
  };

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    await db.insert(schema.organizations).values({
      id: orgId,
      name: "ZZ Cash-up Invoices Test",
      defaultTaxRate: "0",
      invoicePrefix: "ARC",
      invoiceStartNumber: 500,
      paymentTerms: "Net 14",
    });
    const [loc] = await db
      .insert(schema.locations)
      .values({
        orgId,
        name: "Cash-up Shop",
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
    await db.insert(schema.allowedUsers).values(
      [managerId, otherManagerId].map((u) => ({ replitUserId: u, authUserId: u, name: u, role: "MANAGER" as any, orgId })),
    );
    const [shift] = await db
      .insert(schema.shifts)
      .values({ orgId, locationId, userId: managerId, openingFloat: "100", status: "open" })
      .returning();
    shiftId = shift.id;
    const { tradingDayTodayForOrg } = await import("../services/creditLedger");
    today = await tradingDayTodayForOrg(orgId);

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId, role: "MANAGER" };
      req.user = { id: as, role: "MANAGER", claims: { sub: as } };
      next();
    };
    const { registerTickCustomerRoutes } = await import("../routes/tickCustomers");
    const { registerCreditRoutes } = await import("../routes/credit");
    const { registerInvoiceRoutes } = await import("../routes/invoices");
    const { registerShiftRoutes } = await import("../routes/shifts");
    app = express();
    app.use(express.json());
    registerTickCustomerRoutes(app, [scoped]);
    registerCreditRoutes(app, [scoped]);
    registerInvoiceRoutes(app, [scoped]);
    registerShiftRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.cashierCommissionEntries).where(eq(schema.cashierCommissionEntries.orgId, orgId));
    await db.delete(schema.creditPayments).where(eq(schema.creditPayments.orgId, orgId));
    await db.delete(schema.orderCredit).where(eq(schema.orderCredit.orgId, orgId));
    await db.delete(schema.invoices).where(eq(schema.invoices.orgId, orgId));
    await db.delete(schema.orderPayments).where(eq(schema.orderPayments.orgId, orgId));
    await db.delete(schema.orders).where(eq(schema.orders.orgId, orgId));
    await db.delete(schema.shifts).where(eq(schema.shifts.orgId, orgId));
    await db.delete(schema.orgNotifications).where(eq(schema.orgNotifications.orgId, orgId));
    await db.delete(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.orgId, orgId));
    await db.delete(schema.customers).where(eq(schema.customers.orgId, orgId));
    await db.delete(schema.locations).where(eq(schema.locations.orgId, orgId));
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, [managerId, otherManagerId]));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  describe("cash-up", () => {
    it("a £50 cash tab repayment raises expected cash by £50, on its own line", async () => {
      const before = (await get(`/api/shifts/${shiftId}/report`).expect(200)).body.report;
      const who = await customer("Cash Payer");
      await sale({ total: 80, tick: 80, customerId: who });

      const paid = await post(`/api/tick-customers/${who}/payments`, { amount: 50, method: "cash" }).expect(201);
      expect(paid.body.drawerShiftId).toBe(shiftId);
      const [payment] = await db.select().from(schema.creditPayments).where(eq(schema.creditPayments.orgId, orgId));
      expect(payment.shiftId).toBe(shiftId);

      const after = (await get(`/api/shifts/${shiftId}/report`).expect(200)).body.report;
      expect(after.cashSummary.cashTabRepayments).toBe(50);
      expect(after.cashSummary.expectedCash).toBe(before.cashSummary.expectedCash + 50);
      // A repayment is not a sale.
      expect(after.netSales).toBe(before.netSales);
    });

    it("card, backdated and no-till repayments do not touch this drawer", async () => {
      const before = (await get(`/api/shifts/${shiftId}/report`).expect(200)).body.report.cashSummary.expectedCash;
      const who = await customer("Other Payer");
      const orderId = await sale({ total: 90, tick: 90, customerId: who });

      await post(`/api/credit/${orderId}/payments`, { amount: 10, method: "card" }).expect(201);
      const backdated = await post(`/api/credit/${orderId}/payments`, {
        amount: 10,
        method: "cash",
        paidOn: shiftIsoDate(today, -1),
      }).expect(201);
      expect(backdated.body.drawerShiftId).toBeNull();
      // Another manager with no till open: recorded, but in nobody's drawer.
      const noTill = await post(`/api/credit/${orderId}/payments`, { amount: 10, method: "cash" }, otherManagerId).expect(201);
      expect(noTill.body.drawerShiftId).toBeNull();

      const rows = await db.select().from(schema.creditPayments).where(eq(schema.creditPayments.orderId, orderId));
      const byMethod = rows.map((r) => [r.method, r.paidOn === today, r.shiftId]);
      expect(byMethod).toContainEqual(["card", true, shiftId]);
      expect(byMethod).toContainEqual(["cash", false, null]);
      expect(byMethod).toContainEqual(["cash", true, null]);

      const after = (await get(`/api/shifts/${shiftId}/report`).expect(200)).body.report.cashSummary.expectedCash;
      expect(after).toBe(before);
    });

    it("Clear account needs Paid by, and a cash clear goes into the drawer", async () => {
      const who = await customer("Clearer");
      await sale({ total: 25, tick: 25, customerId: who });
      const refused = await post(`/api/tick-customers/${who}/mark-paid`, { expectedBalance: 25 }).expect(400);
      expect(refused.body.code).toBe("CREDIT_METHOD_REQUIRED");

      const before = (await get(`/api/shifts/${shiftId}/report`).expect(200)).body.report.cashSummary;
      const cleared = await post(`/api/tick-customers/${who}/mark-paid`, { expectedBalance: 25, method: "cash" }).expect(200);
      expect(cleared.body.drawerShiftId).toBe(shiftId);
      const after = (await get(`/api/shifts/${shiftId}/report`).expect(200)).body.report.cashSummary;
      expect(after.cashTabRepayments).toBe(before.cashTabRepayments + 25);
      expect(after.expectedCash).toBe(before.expectedCash + 25);
    });

    it("closing stores expected cash with the repayments in; later payments go nowhere near it", async () => {
      const live = (await get(`/api/shifts/${shiftId}/report`).expect(200)).body.report.cashSummary;
      const closed = await post(`/api/shifts/${shiftId}/close`, { closingCount: live.expectedCash }).expect(200);
      expect(closed.body.shift.tabCashInExpected).toBe(true);
      expect(Number(closed.body.shift.expectedCash)).toBe(live.expectedCash);
      expect(Number(closed.body.shift.variance)).toBe(0);
      expect(closed.body.report.cashSummary.expectedCashExcludesTabRepayments).toBe(false);

      const who = await customer("After Close");
      await sale({ total: 30, tick: 30, customerId: who });
      const paid = await post(`/api/tick-customers/${who}/payments`, { amount: 30, method: "cash" }).expect(201);
      expect(paid.body.drawerShiftId).toBeNull();
    });

    it("a Z-report closed before the rule carries a note", async () => {
      const [old] = await db
        .insert(schema.shifts)
        .values({
          orgId,
          locationId,
          userId: otherManagerId,
          openingFloat: "0",
          status: "closed",
          openedAt: new Date(Date.now() - 3 * 86_400_000),
          closedAt: new Date(Date.now() - 3 * 86_400_000 + 3_600_000),
          closingCount: "20",
          expectedCash: "20",
          variance: "0",
        })
        .returning();
      expect(old.tabCashInExpected).toBe(false);
      const report = (await get(`/api/shifts/${old.id}/report`, otherManagerId).expect(200)).body.report;
      expect(report.cashSummary.expectedCashExcludesTabRepayments).toBe(true);
      expect(report.cashSummary.expectedCash).toBe(20);
    });
  });

  describe("invoices", () => {
    it("a tab sale gets the next number, the org's terms and the customer's name as it was — and shows owed", async () => {
      const who = await customer("Ivy Account");
      const orderId = await sale({ total: 40, tick: 40, customerId: who });
      const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, orderId));
      expect(invoice.sequenceNumber).toBeGreaterThanOrEqual(500);
      expect(invoice.invoiceNumber).toBe(`ARC-${invoice.sequenceNumber}`);
      expect(invoice.paymentTerms).toBe("Net 14");
      expect(invoice.dueDate).toBe(shiftIsoDate(today, 14));
      expect(invoice.billingName).toBe("Ivy Account");
      expect(Number(invoice.tax)).toBe(0);

      // Renaming the customer does not rewrite an invoice already made out.
      await db.update(schema.customers).set({ name: "Ivy Renamed" }).where(eq(schema.customers.id, who));

      const list = (await get("/api/invoices").expect(200)).body as Array<Record<string, any>>;
      const row = list.find((r) => r.orderId === orderId)!;
      expect(row.status).toBe("owed");
      expect(row.amountDue).toBe(40);
      expect(row.customerName).toBe("Ivy Account");

      await post(`/api/credit/${orderId}/payments`, { amount: 15, method: "card" }).expect(201);
      const partial = ((await get("/api/invoices").expect(200)).body as any[]).find((r) => r.orderId === orderId);
      expect(partial.status).toBe("part-paid");
      expect(partial.amountDue).toBe(25);

      await db.update(schema.invoices).set({ dueDate: shiftIsoDate(today, -1) }).where(eq(schema.invoices.id, invoice.id));
      const late = ((await get("/api/invoices").expect(200)).body as any[]).find((r) => r.orderId === orderId);
      expect(late.status).toBe("overdue");

      await post(`/api/credit/${orderId}/payments`, { amount: 25, method: "card" }).expect(201);
      const paid = ((await get("/api/invoices").expect(200)).body as any[]).find((r) => r.orderId === orderId);
      expect(paid.status).toBe("paid");
      expect(paid.amountDue).toBe(0);
    });

    it("numbers run in sequence with no gaps or repeats", async () => {
      const who = await customer("Sequence Customer");
      const ids = [];
      for (let i = 0; i < 3; i++) ids.push(await sale({ total: 10 + i, tick: 10 + i, customerId: who }));
      const rows = await db.select().from(schema.invoices).where(inArray(schema.invoices.orderId, ids));
      const numbers = rows.map((r) => r.sequenceNumber!).sort((a, b) => a - b);
      expect(numbers[1]).toBe(numbers[0] + 1);
      expect(numbers[2]).toBe(numbers[0] + 2);
      const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
      expect(org.invoiceLastNumber).toBe(numbers[2]);
    });

    it("a plain till sale has a receipt, not an invoice, until the customer asks", async () => {
      const orderId = await sale({ total: 12, tick: 0, customerId: null });
      expect(await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, orderId))).toHaveLength(0);
      const list = (await get("/api/invoices").expect(200)).body as any[];
      expect(list.find((r) => r.orderId === orderId)).toBeUndefined();

      const pdf = await get(`/api/invoices/${orderId}/pdf`).expect(404);
      expect(pdf.body.code).toBe("INVOICE_NOT_ISSUED");

      const issued = await post(`/api/invoices/for-order/${orderId}`).expect(201);
      const again = await post(`/api/invoices/for-order/${orderId}`).expect(201);
      expect(again.body.id).toBe(issued.body.id);
      expect(issued.body.invoiceNumber).toMatch(/^ARC-\d+$/);

      const row = ((await get("/api/invoices").expect(200)).body as any[]).find((r) => r.orderId === orderId);
      expect(row.status).toBe("paid");
      expect(row.customerName).toBe("Walk-in customer");
      const doc = await get(`/api/invoices/${issued.body.id}/pdf`).expect(200);
      expect(doc.headers["content-type"]).toContain("application/pdf");
    });

    it("a voided tab shows void", async () => {
      const who = await customer("Void Customer");
      const orderId = await sale({ total: 18, tick: 18, customerId: who });
      await post(`/api/credit/${orderId}/void`).expect(200);
      const row = ((await get("/api/invoices").expect(200)).body as any[]).find((r) => r.orderId === orderId);
      expect(row.status).toBe("void");
      expect(row.amountDue).toBe(0);
    });

    it("another org cannot issue or read this org's invoices", async () => {
      const who = await customer("Scoped Customer");
      const orderId = await sale({ total: 9, tick: 9, customerId: who });
      const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.orderId, orderId));
      const { loadInvoiceDocument, issueInvoiceOnRequest } = await import("../services/invoices");
      expect(await loadInvoiceDocument(randomUUID(), invoice.id)).toBeNull();
      await expect(issueInvoiceOnRequest(randomUUID(), orderId)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
      expect((await loadInvoiceDocument(orgId, invoice.id)) && true).toBe(true);
    });
  });
});
