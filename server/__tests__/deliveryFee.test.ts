/**
 * The delivery fee (v1.2.1) against a real database: charged on top of the
 * goods, recorded on the order, VAT'd at the org rate, out of commission and
 * margin unless the admin counts it, never a price exception, its own line on
 * the invoice, and shown apart in the Evidence. In CI's unit-db job by name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("the delivery fee", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgId = randomUUID();
  let locationId = "";
  let productId = "";
  const tag = randomUUID().slice(0, 8);
  const userId = `fee-cashier-${tag}`;
  let role = "CASHIER";

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    const s = schema;
    await db
      .insert(s.organizations)
      .values({ id: orgId, name: "ZZ Delivery Fee Test", defaultTaxRate: "0", cashierCommissionEnabled: true });
    const [loc] = await db
      .insert(s.locations)
      .values({
        orgId,
        name: "Fee Shop",
        address: "1 Test Street",
        city: "Testville",
        state: "TS",
        zipCode: "TS1",
        phone: "07700900001",
        email: "shop@example.invalid",
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
        name: "Fee Widget",
        productId: `FEE-${tag}`,
        defaultSalePrice: "25.00",
        // Sold at its minimum: any extra money must not make it look cheaper or dearer.
        minPrice: "25.00",
        costPrice: "10.00",
        stock: 1000,
        stockLimit: 5,
      })
      .returning();
    productId = prod.id;
    await db.insert(s.productLocationStock).values({ orgId, productId, locationId, stock: 1000 });
    await db.insert(s.allowedUsers).values({
      replitUserId: userId,
      authUserId: userId,
      name: "Fee Cashier",
      role: "CASHIER" as any,
      orgId,
    });

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId, role };
      req.user = { id: userId, role, claims: { sub: userId } };
      next();
    };
    const { registerOrderRoutes } = await import("../routes/orders");
    const { registerDeliveryFeeRoutes } = await import("../routes/deliveryFee");
    const { registerSettingsOrgRoutes } = await import("../routes/settingsOrg");
    const { registerRefundRoutes } = await import("../routes/refunds");
    app = express();
    app.use(express.json());
    registerOrderRoutes(app, [scoped]);
    registerDeliveryFeeRoutes(app, [scoped]);
    registerSettingsOrgRoutes(app, [scoped]);
    registerRefundRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    const { sql, eq } = await import("drizzle-orm");
    for (const statement of [
      `DELETE FROM event_outbox WHERE correlation_id IN (SELECT id::text FROM orders WHERE org_id = '${orgId}')`,
      `DELETE FROM loyalty_ledger WHERE order_id IN (SELECT id FROM orders WHERE org_id = '${orgId}')`,
    ]) {
      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        console.warn("[deliveryFee] cleanup", statement, (e as Error).message);
      }
    }
    for (const table of [
      "admin_audit_logs",
      "invoices",
      "price_exceptions",
      "refunds",
      "order_events",
      "order_payments",
      "order_credit",
      "order_expenses",
      "order_items",
      "inventory_movements",
      "ops_alerts",
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
        console.warn("[deliveryFee] cleanup", table, (e as Error).message);
      }
    }
    await db.delete(schema.allowedUsers).where(eq(schema.allowedUsers.replitUserId, userId));
    try {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    } catch (e) {
      console.warn("[deliveryFee] could not remove the test org", (e as Error).message);
    }
  });

  /** Two £25 widgets delivered: £50 of goods. */
  const deliverySale = (extra: Record<string, unknown> = {}) => ({
    clientOrderId: randomUUID(),
    lines: [{ productId, quantity: 2, unitPrice: 25 }],
    paymentMethod: "cash",
    fulfilmentMethod: "delivery",
    deliveryAddress: "1 Fictional Road",
    deliveryPostcode: "ZZ1 1ZZ",
    ...extra,
  });
  const post = (body: Record<string, unknown>) => request(app).post("/api/orders").send(body);

  async function orderRow(id: string) {
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    return row;
  }
  async function setOrg(values: Partial<typeof schema.organizations.$inferInsert>) {
    const { eq } = await import("drizzle-orm");
    await db.update(schema.organizations).set(values).where(eq(schema.organizations.id, orgId));
  }
  async function settle(id: string) {
    const { eq } = await import("drizzle-orm");
    const row = await orderRow(id);
    await db
      .update(schema.orders)
      .set({ status: "completed", settledAt: new Date(), settledTotal: row.total })
      .where(eq(schema.orders.id, id));
  }

  it("charges the fee on top of the goods, records it, and every tender adds up to it", async () => {
    const res = await post(deliverySale({ deliveryFee: 3.5, expectedTotal: 53.5 })).expect(201);
    const row = await orderRow(res.body.orderId);
    expect(row.subtotal).toBe("50.00");
    expect(row.deliveryFee).toBe("3.50");
    expect(row.total).toBe("53.50");
    const { eq } = await import("drizzle-orm");
    const legs = await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, row.id));
    expect(legs.map((l) => l.amount)).toEqual(["53.50"]);
  });

  it("a split tender must add up to the total with the fee in it", async () => {
    const short = await post(
      deliverySale({ deliveryFee: 3.5, payments: [{ method: "cash", amount: 25 }, { method: "card", amount: 25 }] }),
    ).expect(422);
    expect(short.body.message).toMatch(/£50\.00 but the order is £53\.50/);
    await post(
      deliverySale({ deliveryFee: 3.5, payments: [{ method: "cash", amount: 28.5 }, { method: "card", amount: 25 }] }),
    ).expect(201);
  });

  it("VATs the fee at the org rate, the same as the till shows", async () => {
    await setOrg({ defaultTaxRate: "20" });
    try {
      const { priceOrder } = await import("@shared/pricing/priceOrder");
      const till = priceOrder({ lines: [{ quantity: 2, unitPrice: 25 }], taxRatePercent: 20, deliveryFee: 3.5 });
      const res = await post(deliverySale({ deliveryFee: 3.5, expectedTotal: till.total })).expect(201);
      const row = await orderRow(res.body.orderId);
      expect(row.vatAmount).toBe("10.70");
      expect(row.total).toBe("64.20");
      expect(Number(row.total)).toBe(till.total);
    } finally {
      await setOrg({ defaultTaxRate: "0" });
    }
  });

  it("an order without a fee is recorded exactly as before (no fee, not a £0 one)", async () => {
    const res = await post(deliverySale({ expectedTotal: 50 })).expect(201);
    const row = await orderRow(res.body.orderId);
    expect(row.deliveryFee).toBeNull();
    expect(row.total).toBe("50.00");
    const collection = await post({
      clientOrderId: randomUUID(),
      lines: [{ productId, quantity: 1, unitPrice: 25 }],
      paymentMethod: "cash",
    }).expect(201);
    expect((await orderRow(collection.body.orderId)).deliveryFee).toBeNull();
  });

  it("refuses a fee on a collection, on personal use, and one that is negative or too high", async () => {
    const collection = await post({
      clientOrderId: randomUUID(),
      lines: [{ productId, quantity: 1, unitPrice: 25 }],
      paymentMethod: "cash",
      deliveryFee: 3,
    }).expect(400);
    expect(collection.body.code).toBe("DELIVERY_FEE_NOT_DELIVERY");
    const personal = await post(
      deliverySale({ paymentMethod: "personal_use", personalUseReason: "Staff lunch", deliveryFee: 3 }),
    ).expect(400);
    expect(personal.body.code).toBe("DELIVERY_FEE_NOT_DELIVERY");
    expect((await post(deliverySale({ deliveryFee: -2 })).expect(400)).body.code).toBe("DELIVERY_FEE_INVALID");
    expect((await post(deliverySale({ deliveryFee: 250 })).expect(400)).body.code).toBe("DELIVERY_FEE_TOO_HIGH");
  });

  it("is never a price exception: goods sold at their minimum with a fee record nothing", async () => {
    const res = await post(deliverySale({ deliveryFee: 5, expectedTotal: 55 })).expect(201);
    const { eq } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(schema.priceExceptions)
      .where(eq(schema.priceExceptions.orderId, res.body.orderId));
    expect(rows).toEqual([]);
  });

  it("earns no commission by default, and does when the admin counts it", async () => {
    const res = await post(deliverySale({ deliveryFee: 4, expectedTotal: 54 })).expect(201);
    const row = await orderRow(res.body.orderId);
    const { eq } = await import("drizzle-orm");
    const [shift] = await db.select().from(schema.cashierShifts).where(eq(schema.cashierShifts.id, row.cashierShiftId!));
    const { computeCashierShiftBalanceSheet } = await import("../services/cashierShiftEngine");
    const off = await computeCashierShiftBalanceSheet(orgId, shift);
    const offRow = off.commissionOrders.find((o) => o.orderId === row.id)!;
    // £50 of goods at a known cost: the fee's £4 is not in what commission is paid on.
    expect(offRow.paidContribution).toBeCloseTo(50, 6);
    await setOrg({ deliveryFeeCommissionable: true });
    try {
      const on = await computeCashierShiftBalanceSheet(orgId, shift);
      expect(on.commissionOrders.find((o) => o.orderId === row.id)!.paidContribution).toBeCloseTo(54, 6);
    } finally {
      await setOrg({ deliveryFeeCommissionable: false });
    }
  });

  it("the till's live 'commission so far' leaves the fee out too, as the closed shift does", async () => {
    const res = await post(deliverySale({ deliveryFee: 4, expectedTotal: 54 })).expect(201);
    const row = await orderRow(res.body.orderId);
    const { eq, sql } = await import("drizzle-orm");
    const [shift] = await db.select().from(schema.cashierShifts).where(eq(schema.cashierShifts.id, row.cashierShiftId!));
    const [{ fees }] = (
      await db.execute(sql`
        SELECT COALESCE(SUM(ROUND(delivery_fee * (1 + COALESCE(vat_rate, 0) / 100), 2)), 0)::float AS fees FROM orders
        WHERE COALESCE(completed_cashier_shift_id, cashier_shift_id) = ${shift.id}
          AND payment_method <> 'personal_use'`)
    ).rows as Array<{ fees: number }>;
    expect(fees).toBeGreaterThanOrEqual(4);
    const { computeCashierShiftBalanceSheet } = await import("../services/cashierShiftEngine");
    const off = await computeCashierShiftBalanceSheet(orgId, shift);
    await setOrg({ deliveryFeeCommissionable: true });
    try {
      const on = await computeCashierShiftBalanceSheet(orgId, shift);
      const rate = off.sheet.commissionRate / 100;
      expect(rate).toBeGreaterThan(0);
      // The fee money is in net profit either way; only its commission differs.
      expect(on.sheet.netSalesProfit).toBeCloseTo(off.sheet.netSalesProfit, 6);
      expect(Math.abs(on.sheet.commissionAmount - off.sheet.commissionAmount - fees * rate)).toBeLessThanOrEqual(0.011);
    } finally {
      await setOrg({ deliveryFeeCommissionable: false });
    }
  });

  it("a manager's edit keeps the fee, can change it, and can remove it", async () => {
    const res = await post(deliverySale({ deliveryFee: 3, expectedTotal: 53 })).expect(201);
    const id = res.body.orderId;
    role = "MANAGER";
    try {
      await request(app)
        .put(`/api/orders/${id}`)
        .send({ lines: [{ productId, quantity: 1, unitPrice: 25 }] })
        .expect(200);
      let row = await orderRow(id);
      expect(row.deliveryFee).toBe("3.00");
      expect(row.total).toBe("28.00");

      const preview = await request(app)
        .post(`/api/orders/${id}/edit-preview`)
        .send({ lines: [{ productId, quantity: 1, unitPrice: 25 }] })
        .expect(200);
      expect(preview.body.pricing.deliveryFee).toBe(3);

      await request(app)
        .put(`/api/orders/${id}`)
        .send({ lines: [{ productId, quantity: 1, unitPrice: 25 }], deliveryFee: 4.5 })
        .expect(200);
      row = await orderRow(id);
      expect(row.deliveryFee).toBe("4.50");
      expect(row.total).toBe("29.50");

      await request(app)
        .put(`/api/orders/${id}`)
        .send({ lines: [{ productId, quantity: 1, unitPrice: 25 }], deliveryFee: 0 })
        .expect(200);
      row = await orderRow(id);
      expect(row.deliveryFee).toBeNull();
      expect(row.total).toBe("25.00");

      const bad = await request(app)
        .put(`/api/orders/${id}`)
        .send({ lines: [{ productId, quantity: 1, unitPrice: 25 }], deliveryFee: -1 })
        .expect(400);
      expect(bad.body.code).toBe("DELIVERY_FEE_INVALID");
    } finally {
      role = "CASHIER";
    }
  });

  it("shows on its own line on the invoice and the order, and the invoice adds up", async () => {
    const res = await post(deliverySale({ deliveryFee: 3.5, expectedTotal: 53.5 })).expect(201);
    const { issueInvoiceOnRequest, loadInvoiceDocument } = await import("../services/invoices");
    const invoice = await issueInvoiceOnRequest(orgId, res.body.orderId);
    expect(invoice.subtotal).toBe("53.50");
    expect(invoice.total).toBe("53.50");
    const loaded = await loadInvoiceDocument(orgId, invoice.id);
    if (!loaded || "receiptOnly" in loaded) throw new Error("expected an invoice document");
    expect(loaded.document.subtotal).toBe(50);
    expect(loaded.document.deliveryFee).toBe(3.5);
    expect(loaded.document.deliveryFeeName).toBe("Delivery fee");
    const d = loaded.document;
    expect(Math.round((d.subtotal - d.discount + d.deliveryFee + d.tax - d.pointsDiscount) * 100) / 100).toBe(d.total);

    const detail = await request(app).get(`/api/orders/${res.body.orderId}`).expect(200);
    expect(detail.body.deliveryFee).toBe(3.5);
    // Named as the receipt names it: the Ops sheet and the refund page read this.
    expect(detail.body.deliveryFeeName).toBe("Delivery fee");
    await setOrg({ deliveryFeeName: "Van charge" });
    try {
      const renamed = await request(app).get(`/api/orders/${res.body.orderId}`).expect(200);
      expect(renamed.body.deliveryFeeName).toBe("Van charge");
    } finally {
      await setOrg({ deliveryFeeName: "Delivery fee" });
    }
    const pdf = await request(app).get(`/api/orders/${res.body.orderId}/receipt.pdf`).expect(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
  });

  it("the Evidence shows delivery fee takings apart, inside takings, and margin leaves them out", async () => {
    const a = await post(deliverySale({ deliveryFee: 3, expectedTotal: 53 })).expect(201);
    const b = await post(deliverySale({ deliveryFee: 2.5, expectedTotal: 52.5 })).expect(201);
    await settle(a.body.orderId);
    await settle(b.body.orderId);
    const { deliveryFeeTakingsBetween, deliveryFeeTakingsByDate } = await import("../services/deliveryFeeTakings");
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 60 * 1000);
    const fees = await deliveryFeeTakingsBetween(orgId, start, end);
    expect(fees).toEqual({ total: 5.5, orders: 2 });

    const { sql } = await import("drizzle-orm");
    const [check] = (
      await db.execute(sql`
        SELECT COALESCE(SUM(delivery_fee), 0)::float AS fees
        FROM orders WHERE org_id = ${orgId} AND status = 'completed'`)
    ).rows as Array<{ fees: number }>;
    expect(fees.total).toBe(check.fees);

    const today = new Date().toISOString().slice(0, 10);
    const byDate = await deliveryFeeTakingsByDate(orgId, today, today);
    expect(byDate.total).toBe(5.5);

    const { storage } = await import("../storage");
    const from = new Date(`${today}T00:00:00.000Z`);
    const to = new Date(`${today}T23:59:59.999Z`);
    const profit = await storage.getProfitAnalysis(from, to, orgId);
    // £105.50 taken: £100 of goods costing £40, and £5.50 of fees.
    expect(profit.summary.revenue).toBeCloseTo(105.5, 6);
    expect(profit.summary.deliveryFees).toBe(5.5);
    expect(profit.summary.grossProfit).toBeCloseTo(60, 6);
    expect(profit.summary.grossMargin).toBeCloseTo(60, 6);
    // Operating profit still counts the fee money.
    expect(profit.summary.operatingProfit).toBeCloseTo(65.5 - profit.summary.operatingExpenses, 6);

    const hub = await storage.getReportData(from, to, orgId);
    expect(hub.revenue.deliveryFees).toBe(5.5);
  });

  it("the fee can be refunded once, with or without the goods, and fee takings net it off", async () => {
    const { eq, sql } = await import("drizzle-orm");
    const refund = (id: string, body: Record<string, unknown>) =>
      request(app)
        .post(`/api/orders/${id}/refunds`)
        .send({ reason: "customer_changed_mind", refundMethod: "cash", lines: [], ...body });
    const { deliveryFeeTakingsBetween } = await import("../services/deliveryFeeTakings");
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 60 * 1000);
    const before = await deliveryFeeTakingsBetween(orgId, start, end);

    // The whole order back: two widgets and the £3 fee.
    const whole = await post(deliverySale({ deliveryFee: 3, expectedTotal: 53 })).expect(201);
    await settle(whole.body.orderId);
    const [line] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, whole.body.orderId));
    const full = await refund(whole.body.orderId, { lines: [{ orderLineId: line.id, qty: 2 }], deliveryFee: true }).expect(201);
    expect(full.body.refund.total).toBe("53.00");
    expect(full.body.refund.deliveryFee).toBe("3.00");
    // Once only.
    const again = await refund(whole.body.orderId, { deliveryFee: true }).expect(400);
    expect(again.body.message).toMatch(/already been refunded/);
    const detail = await request(app).get(`/api/orders/${whole.body.orderId}`).expect(200);
    expect(detail.body.deliveryFeeRefunded).toBe(3);
    expect(detail.body.deliveryFeeRefundable).toBe(0);
    expect(detail.body.refundedTotal).toBe(53);

    // The fee alone (the delivery never came), and never on an order without one.
    const feeOnly = await post(deliverySale({ deliveryFee: 2.5, expectedTotal: 52.5 })).expect(201);
    await settle(feeOnly.body.orderId);
    expect((await request(app).get(`/api/orders/${feeOnly.body.orderId}`).expect(200)).body.deliveryFeeRefundable).toBe(2.5);
    const alone = await refund(feeOnly.body.orderId, { deliveryFee: true }).expect(201);
    expect(alone.body.refund.total).toBe("2.50");
    const none = await post(deliverySale({ expectedTotal: 50 })).expect(201);
    await settle(none.body.orderId);
    expect((await refund(none.body.orderId, { deliveryFee: true }).expect(400)).body.message).toMatch(/no delivery fee/);
    // Nothing chosen is still refused.
    await refund(none.body.orderId, {}).expect(400);

    // Fee takings: the fees charged, less the fees refunded in the window.
    const after = await deliveryFeeTakingsBetween(orgId, start, end);
    expect(after.total).toBeCloseTo(before.total + 3 + 2.5 - 3 - 2.5, 6);
    const [check] = (
      await db.execute(sql`
        SELECT
          (SELECT COALESCE(SUM(ROUND(delivery_fee * (1 + COALESCE(vat_rate, 0) / 100), 2)), 0) FROM orders
            WHERE org_id = ${orgId} AND status = 'completed' AND settled_at >= ${start} AND settled_at < ${end})
          - (SELECT COALESCE(SUM(delivery_fee), 0) FROM refunds
            WHERE org_id = ${orgId} AND created_at >= ${start} AND created_at < ${end}) AS fees`)
    ).rows as Array<{ fees: string }>;
    expect(after.total).toBeCloseTo(Number(check.fees), 6);

    // Commission: the fee earned none, so refunding it takes none back.
    const row = await orderRow(whole.body.orderId);
    const [shift] = await db.select().from(schema.cashierShifts).where(eq(schema.cashierShifts.id, row.cashierShiftId!));
    const { computeCashierShiftBalanceSheet } = await import("../services/cashierShiftEngine");
    const sheet = await computeCashierShiftBalanceSheet(orgId, shift);
    const entry = sheet.commissionOrders.find((o) => o.orderId === whole.body.orderId)!;
    expect(entry.paidContribution).toBeCloseTo(50, 6);
    expect(entry.refunds).toBeCloseTo(50, 6);
  });

  it("a discounted sale with a fee: goods refunds share the discount, the fee is left out of the share", async () => {
    const { eq } = await import("drizzle-orm");
    const res = await post(deliverySale({ deliveryFee: 3, expectedTotal: 53 })).expect(201);
    await settle(res.body.orderId);
    // As if £5 came off the goods at the till: collected £48, of which £3 is the fee.
    await db.update(schema.orders).set({ settledTotal: "48.00" }).where(eq(schema.orders.id, res.body.orderId));
    const [line] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, res.body.orderId));
    const refund = (body: Record<string, unknown>) =>
      request(app)
        .post(`/api/orders/${res.body.orderId}/refunds`)
        .send({ reason: "customer_changed_mind", refundMethod: "cash", lines: [], ...body });
    // One of two widgets: (48 - 3) / 50 of its £25, not a share of the fee.
    const one = await refund({ lines: [{ orderLineId: line.id, qty: 1 }] }).expect(201);
    expect(one.body.refund.total).toBe("22.50");
    // The other widget and the fee: what is left of the goods, plus the fee as charged.
    const rest = await refund({ lines: [{ orderLineId: line.id, qty: 1 }], deliveryFee: true }).expect(201);
    expect(rest.body.refund.total).toBe("25.50");
    expect(rest.body.refund.deliveryFee).toBe("3.00");
    // Everything collected has now gone back, and nothing more can.
    await refund({ deliveryFee: true }).expect(400);
  });

  it("only an admin changes the fee's settings, every change is logged, and every role reads them", async () => {
    role = "MANAGER";
    await request(app).put("/api/settings/delivery-fee").send({ defaultPrice: 4 }).expect(403);
    role = "ADMIN";
    try {
      await request(app).put("/api/settings/delivery-fee").send({ defaultPrice: -1 }).expect(400);
      await request(app).put("/api/settings/delivery-fee").send({ unknownColumn: "x" }).expect(400);
      const saved = await request(app)
        .put("/api/settings/delivery-fee")
        .send({ name: "Van charge", defaultPrice: 4.25 })
        .expect(200);
      expect(saved.body).toEqual({ deliveryFeeName: "Van charge", deliveryFeePrice: 4.25, deliveryFeeCommissionable: false });
      const { and, eq } = await import("drizzle-orm");
      const logs = await db
        .select()
        .from(schema.adminAuditLogs)
        .where(and(eq(schema.adminAuditLogs.orgId, orgId), eq(schema.adminAuditLogs.action, "delivery_fee.updated")));
      expect(logs).toHaveLength(1);
      expect(logs[0].metadata).toMatchObject({ name: { from: "Delivery fee", to: "Van charge" } });
    } finally {
      role = "CASHIER";
    }
    const settings = await request(app).get("/api/settings").expect(200);
    expect(settings.body).toMatchObject({
      deliveryFeeName: "Van charge",
      deliveryFeePrice: 4.25,
      deliveryFeeCommissionable: false,
    });
    await setOrg({ deliveryFeeName: "Delivery fee", deliveryFeePrice: "3.00" });
  });
});
