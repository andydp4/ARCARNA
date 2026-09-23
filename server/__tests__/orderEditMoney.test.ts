/**
 * Manager edits and the other order paths (v1.2 Phase 1B) against a real
 * database.
 *
 * An edit re-prices the order at the org's VAT rate and keeps the sale's
 * discounts, rewrites the payment record so the tick amount on the Credit List
 * is right, and writes an "edited" event with the money before and after.
 * Orders paid in several parts are refused. No create path can make a
 * "completed" order; the public API prices at the org rate, in one
 * transaction, and settles status changes through the completion path. An
 * org with no VAT rate is refused everywhere. In CI's unit-db job by name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = !!process.env.DATABASE_URL;
const api = vi.hoisted(() => ({ orgId: "" }));

vi.mock("../middleware/apiKeyAuth", () => ({
  requireApiKey: (req: any, _res: any, next: any) => {
    req.apiKeyContext = { orgId: api.orgId, scopes: ["orders:write"] };
    next();
  },
  requireScope: () => (_req: any, _res: any, next: any) => next(),
}));

describe.skipIf(!hasDb)("manager edits and order paths keep charged = recorded", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgId = randomUUID();
  api.orgId = orgId;
  let locationId = "";
  let productId = "";
  const tag = randomUUID().slice(0, 8);
  const cashierId = `edit-cashier-${tag}`;
  const managerId = `edit-manager-${tag}`;

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    const s = schema;
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Order Edit Test", defaultTaxRate: "0" });
    const [loc] = await db
      .insert(s.locations)
      .values({
        orgId,
        name: "Edit Shop",
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
        name: "Edit Widget",
        productId: `EDIT-${tag}`,
        defaultSalePrice: "25.00",
        costPrice: "10.00",
        stock: 1000,
        stockLimit: 5,
      })
      .returning();
    productId = prod.id;
    await db.insert(s.productLocationStock).values({ orgId, productId, locationId, stock: 1000 });
    for (const [id, role] of [
      [cashierId, "CASHIER"],
      [managerId, "MANAGER"],
    ] as const) {
      await db.insert(s.allowedUsers).values({ replitUserId: id, authUserId: id, name: id, role: role as any, orgId });
    }
    await db.insert(s.loyaltyTiers).values({ orgId, name: "Bronze", pointsRequired: 0, discountPercentage: "0" });
    await db.insert(s.loyaltyTiers).values({ orgId, name: "Silver", pointsRequired: 500, discountPercentage: "10" });
    await db.insert(s.loyaltySettings).values({ orgId, redemptionRate: "0.01", minRedeemPoints: 100 });

    // `x-test-role: MANAGER` acts as the manager; anything else is the cashier.
    const scoped: RequestHandler = (req: any, _res, next) => {
      const manager = req.get("x-test-role") === "MANAGER";
      const id = manager ? managerId : cashierId;
      const role = manager ? "MANAGER" : "CASHIER";
      req.orgContext = { orgId, locationId, role };
      req.user = { id, role, claims: { sub: id } };
      next();
    };
    const { registerOrderRoutes } = await import("../routes/orders");
    const { registerV1Routes } = await import("../routes/v1");
    app = express();
    app.use(express.json());
    registerOrderRoutes(app, [scoped]);
    registerV1Routes(app);
  });

  afterAll(async () => {
    if (!db) return;
    const { sql, eq } = await import("drizzle-orm");
    for (const statement of [
      `DELETE FROM event_outbox WHERE correlation_id IN (SELECT id::text FROM orders WHERE org_id = '${orgId}')`,
      `DELETE FROM loyalty_ledger WHERE order_id IN (SELECT id FROM orders WHERE org_id = '${orgId}')`,
      `DELETE FROM commission_ledger WHERE org_id = '${orgId}'`,
    ]) {
      try {
        await db.execute(sql.raw(statement));
      } catch (e) {
        console.warn("[orderEditMoney] cleanup", statement, (e as Error).message);
      }
    }
    for (const table of [
      "loyalty_ledger",
      "order_events",
      "order_payments",
      "order_credit",
      "order_expenses",
      "order_items",
      "inventory_movements",
      "ops_alerts",
      "invoices",
      "orders",
      "cashier_shifts",
      "shifts",
      "promotions",
      "customers",
      "loyalty_tiers",
      "loyalty_settings",
      "product_location_stock",
      "products",
      "locations",
    ]) {
      try {
        await db.execute(sql.raw(`DELETE FROM ${table} WHERE org_id = '${orgId}'`));
      } catch (e) {
        console.warn("[orderEditMoney] cleanup", table, (e as Error).message);
      }
    }
    for (const id of [cashierId, managerId]) {
      await db.delete(schema.allowedUsers).where(eq(schema.allowedUsers.replitUserId, id));
    }
    try {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    } catch (e) {
      console.warn("[orderEditMoney] could not remove the test org", (e as Error).message);
    }
  });

  const sale = (extra: Record<string, unknown> = {}) => ({
    clientOrderId: randomUUID(),
    lines: [{ productId, quantity: 2, unitPrice: 25 }],
    paymentMethod: "cash",
    ...extra,
  });
  const post = (body: Record<string, unknown>) => request(app).post("/api/orders").send(body);
  const edit = (id: string, lines: unknown, extra: Record<string, unknown> = {}) =>
    request(app).put(`/api/orders/${id}`).set("x-test-role", "MANAGER").send({ lines, ...extra });
  const widgets = (quantity: number, unitPrice: number | null = 25) => [{ productId, quantity, unitPrice }];

  async function setRate(rate: string | null) {
    const { eq } = await import("drizzle-orm");
    await db.update(schema.organizations).set({ defaultTaxRate: rate }).where(eq(schema.organizations.id, orgId));
  }
  async function customer(points: number) {
    const [c] = await db
      .insert(schema.customers)
      .values({ orgId, name: `Edit Customer ${randomUUID().slice(0, 6)}`, loyaltyPoints: points })
      .returning();
    return c;
  }
  async function orderRow(id: string) {
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    return row;
  }
  async function legs(id: string) {
    const { eq } = await import("drizzle-orm");
    return db.select().from(schema.orderPayments).where(eq(schema.orderPayments.orderId, id));
  }
  async function events(id: string, kind: string) {
    const { and, eq } = await import("drizzle-orm");
    return db
      .select()
      .from(schema.orderEvents)
      .where(and(eq(schema.orderEvents.orderId, id), eq(schema.orderEvents.kind, kind)));
  }

  it("an edit keeps the tier discount, rewrites the tick leg, and the Credit List carries the new amount", async () => {
    const c = await customer(600);
    const res = await post(sale({ customerId: c.id, paymentMethod: "tick", expectedTotal: 45 })).expect(201);
    const id = res.body.orderId;

    const edited = await edit(id, widgets(3)).expect(200);
    expect(edited.body.pricing).toMatchObject({ subtotal: 75, tierDiscount: 7.5, vatAmount: 0, total: 67.5 });

    const row = await orderRow(id);
    expect(row.total).toBe("67.50");
    expect(row.subtotal).toBe("75.00");
    expect(row.tierDiscount).toBe("7.50");
    expect(row.tierDiscountPercent).toBe("10.00");
    const paid = await legs(id);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ method: "tick", amount: "67.50" });

    const [ev] = await events(id, "edited");
    expect(ev.userId).toBe(managerId);
    const meta = ev.meta as any;
    expect(meta.before.total).toBe(45);
    expect(meta.before.lines).toEqual([{ productId, quantity: 2, unitPrice: 25, lineTotal: 50 }]);
    expect(meta.before.payments).toEqual([{ method: "tick", amount: 45 }]);
    expect(meta.after.total).toBe(67.5);
    expect(meta.after.tierDiscount).toBe(7.5);
    expect(meta.after.payments).toEqual([{ method: "tick", amount: 67.5 }]);

    // Handing the goods over puts what is now owed on the Credit List.
    await request(app).patch(`/api/orders/${id}`).set("x-test-role", "MANAGER").send({ status: "completed" }).expect(200);
    const { eq } = await import("drizzle-orm");
    const [credit] = await db.select().from(schema.orderCredit).where(eq(schema.orderCredit.orderId, id));
    expect(credit.amountGiven).toBe("67.50");
    expect((await orderRow(id)).settledTotal).toBe("67.50");
  });

  it("uses the org's VAT rate, whatever the request says", async () => {
    await setRate("20");
    try {
      const res = await post(sale({ expectedTotal: 60 })).expect(201);
      const edited = await edit(res.body.orderId, widgets(1), { taxRatePercent: 0 }).expect(200);
      expect(edited.body.pricing).toMatchObject({ subtotal: 25, vatRate: 20, vatAmount: 5, total: 30 });
      const row = await orderRow(res.body.orderId);
      expect(row.total).toBe("30.00");
      expect(row.vatAmount).toBe("5.00");
      expect((await legs(row.id))[0].amount).toBe("30.00");
    } finally {
      await setRate("0");
    }
  });

  it("keeps a percentage promotion by its own rule, and points at their full value", async () => {
    const { eq } = await import("drizzle-orm");
    const code = `TEN${tag.toUpperCase()}`;
    const [promo] = await db
      .insert(schema.promotions)
      .values({
        orgId,
        name: "Ten percent",
        code,
        type: "percentage",
        value: "10",
        usageLimit: 1,
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
        isActive: 1,
      })
      .returning();
    const c = await customer(300); // Bronze: no tier discount
    // £50 − 10% promo = £45 − 200 points (£2) = £43.
    const res = await post(sale({ customerId: c.id, promoCode: code, redeemPoints: 200, expectedTotal: 43 })).expect(201);
    // The promotion's single use was spent by the sale; the edit still keeps it.
    const edited = await edit(res.body.orderId, widgets(4)).expect(200);
    expect(edited.body.pricing).toMatchObject({ subtotal: 100, promoDiscount: 10, pointsDiscount: 2, total: 88 });
    const row = await orderRow(res.body.orderId);
    expect(row.promotionId).toBe(promo.id);
    expect(row.pointsRedeemed).toBe(200);
    expect(row.total).toBe("88.00");
    const [p] = await db.select().from(schema.promotions).where(eq(schema.promotions.id, promo.id));
    expect(p.usageCount).toBe(1);

    // Cut below what the points were worth: refused, not shrunk.
    const tooSmall = await edit(res.body.orderId, widgets(1, 1)).expect(409);
    expect(tooSmall.body.code).toBe("ORDER_EDIT_POINTS_EXCEED_TOTAL");
    expect((await orderRow(res.body.orderId)).total).toBe("88.00");
  });

  it("refuses an order paid in several parts, and changes nothing", async () => {
    const res = await post(
      sale({ payments: [{ method: "cash", amount: 20 }, { method: "card", amount: 30 }], expectedTotal: 50 }),
    ).expect(201);
    const refused = await edit(res.body.orderId, widgets(3)).expect(409);
    expect(refused.body.code).toBe("ORDER_EDIT_MULTI_PART");
    expect(refused.body.message).toMatch(/more than one part/);
    expect((await orderRow(res.body.orderId)).total).toBe("50.00");
    expect(await events(res.body.orderId, "edited")).toHaveLength(0);

    const preview = await request(app)
      .post(`/api/orders/${res.body.orderId}/edit-preview`)
      .set("x-test-role", "MANAGER")
      .send({ lines: widgets(3) })
      .expect(200);
    expect(preview.body).toMatchObject({ editable: false, code: "ORDER_EDIT_MULTI_PART" });
  });

  it("an empty price box is refused, never saved as £0", async () => {
    const res = await post(sale({ expectedTotal: 50 })).expect(201);
    const refused = await edit(res.body.orderId, widgets(2, null)).expect(400);
    expect(refused.body.code).toBe("ORDER_LINES_INVALID");
    expect((await orderRow(res.body.orderId)).total).toBe("50.00");
  });

  it("previews Subtotal, VAT and Total exactly as the save prices them", async () => {
    await setRate("20");
    try {
      const c = await customer(600);
      const res = await post(sale({ customerId: c.id, expectedTotal: 54 })).expect(201);
      const preview = await request(app)
        .post(`/api/orders/${res.body.orderId}/edit-preview`)
        .set("x-test-role", "MANAGER")
        .send({ lines: widgets(1) })
        .expect(200);
      expect(preview.body.editable).toBe(true);
      // £25 − 10% = £22.50 + 20% VAT £4.50 = £27.
      expect(preview.body.pricing).toMatchObject({ subtotal: 25, tierDiscount: 2.5, vatAmount: 4.5, total: 27 });
      const saved = await edit(res.body.orderId, widgets(1)).expect(200);
      expect(saved.body.pricing.total).toBe(preview.body.pricing.total);
    } finally {
      await setRate("0");
    }
  });

  it("refuses edits and sales when the org has no VAT rate", async () => {
    const res = await post(sale({ expectedTotal: 50 })).expect(201);
    await setRate(null);
    try {
      const refusedEdit = await edit(res.body.orderId, widgets(1)).expect(422);
      expect(refusedEdit.body.code).toBe("ORG_VAT_RATE_MISSING");
      const refusedSale = await post(sale()).expect(422);
      expect(refusedSale.body.message).toMatch(/Set your VAT rate/);
      const refusedApi = await request(app)
        .post(`/v1/orgs/${orgId}/orders`)
        .send({ lines: widgets(1), paymentMethod: "cash" })
        .expect(422);
      expect(refusedApi.body.error).toBe("vat_rate_missing");
    } finally {
      await setRate("0");
    }
  });

  it("no create path makes a completed order", async () => {
    const till = await post(sale({ status: "completed" })).expect(400);
    expect(till.body.message).toBeTruthy();
    const viaApi = await request(app)
      .post(`/v1/orgs/${orgId}/orders`)
      .send({ lines: widgets(1), paymentMethod: "cash", status: "completed" })
      .expect(400);
    expect(viaApi.body.error).toBe("validation_error");
    // Scrubbed: one plain sentence, not the validator's JSON dump.
    expect(viaApi.body.message).not.toMatch(/[{[]/);
  });

  it("an API order is priced at the org rate and recorded whole, in one transaction", async () => {
    await setRate("20");
    try {
      const c = await customer(600); // Silver — the API still gives no discount
      const res = await request(app)
        .post(`/v1/orgs/${orgId}/orders`)
        .send({ lines: widgets(2), paymentMethod: "tick", customerId: c.id, taxRatePercent: 0 })
        .expect(201);
      const row = await orderRow(res.body.orderId);
      expect(row.total).toBe("60.00");
      expect(row.vatAmount).toBe("10.00");
      expect(row.tierDiscount).toBe("0.00");
      expect(row.status).toBe("pending");
      expect(await legs(row.id)).toMatchObject([{ method: "tick", amount: "60.00" }]);
      expect(await events(row.id, "received")).toHaveLength(1);
      const { eq } = await import("drizzle-orm");
      const outbox = await db.select().from(schema.eventOutbox).where(eq(schema.eventOutbox.correlationId, row.id));
      expect(outbox.map((e) => e.eventType)).toContain("OrderCreated");

      // Completing through the API settles: settled total and the Credit List.
      await request(app).patch(`/v1/orgs/${orgId}/orders/${row.id}`).send({ status: "completed" }).expect(200);
      const settled = await orderRow(row.id);
      expect(settled.settledTotal).toBe("60.00");
      const [credit] = await db.select().from(schema.orderCredit).where(eq(schema.orderCredit.orderId, row.id));
      expect(credit.amountGiven).toBe("60.00");
      expect(await events(row.id, "completed")).toHaveLength(1);

      // Reopening moves settled money: not from the API.
      const reopen = await request(app).patch(`/v1/orgs/${orgId}/orders/${row.id}`).send({ status: "pending" }).expect(409);
      expect(reopen.body.error).toBe("ORDER_TRANSITION_INVALID");
      expect((await orderRow(row.id)).status).toBe("completed");
    } finally {
      await setRate("0");
    }
  });

  it("an API order cannot name another organisation's customer", async () => {
    const { eq } = await import("drizzle-orm");
    const otherOrg = randomUUID();
    await db.insert(schema.organizations).values({ id: otherOrg, name: "ZZ Order Edit Other Org", defaultTaxRate: "0" });
    const [foreign] = await db
      .insert(schema.customers)
      .values({ orgId: otherOrg, name: "Someone Else's Customer", loyaltyPoints: 0 })
      .returning();
    try {
      const before = await db.select().from(schema.orders).where(eq(schema.orders.orgId, orgId));
      const res = await request(app)
        .post(`/v1/orgs/${orgId}/orders`)
        .send({ lines: widgets(1), paymentMethod: "cash", customerId: foreign.id })
        .expect(400);
      expect(res.body.error).toBe("validation_error");
      const after = await db.select().from(schema.orders).where(eq(schema.orders.orgId, orgId));
      expect(after.length).toBe(before.length);
    } finally {
      await db.delete(schema.customers).where(eq(schema.customers.id, foreign.id));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, otherOrg));
    }
  });

  it("an API order whose lines are refused leaves nothing behind", async () => {
    const { eq } = await import("drizzle-orm");
    const before = await db.select().from(schema.orders).where(eq(schema.orders.orgId, orgId));
    await request(app)
      .post(`/v1/orgs/${orgId}/orders`)
      .send({ lines: [{ productId: randomUUID(), quantity: 1, unitPrice: 5 }], paymentMethod: "cash" })
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
    const after = await db.select().from(schema.orders).where(eq(schema.orders.orgId, orgId));
    expect(after.length).toBe(before.length);
  });

  it("lists past edited orders for review, including totals that gained 20% VAT", async () => {
    const { eq } = await import("drizzle-orm");
    const { listEditedOrders, reviewFlags } = await import("../services/editedOrderReview");
    // An order the old edit re-priced: £50 of lines, £60 total at a 0% shop,
    // its payment record still at £50.
    const res = await post(sale({ expectedTotal: 50 })).expect(201);
    await db.update(schema.orders).set({ total: "60.00" }).where(eq(schema.orders.id, res.body.orderId));
    const rows = await listEditedOrders(db, { orgId });
    const found = rows.find((r) => r.orderId === res.body.orderId);
    expect(found?.foundBy).toBe("total is lines + 20%");
    expect(reviewFlags(found!)).toEqual(expect.arrayContaining(["gained_20pct_vat", "payments_differ"]));
    // And an order edited through the new path is listed by its event.
    const editedAny = rows.some((r) => r.foundBy === "edit event");
    expect(editedAny).toBe(true);
  });
});
