/**
 * The customer view and delivery addresses (v1.2 Phase 5), against the real
 * route table and a real database: what each role reads, the phone lookup and
 * duplicate prompt, edit without reading, the bounded order history, the
 * driver's call and the board's delivery address.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml). Like
 * roleMatrix.test.ts it mocks ../db without a database, so the no-DB run
 * still checks the select lists and skips the rest.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatUkPhone } from "@shared/customerView";

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
    const id = String(req.headers["x-test-user"] ?? `views-${String(role).toLowerCase()}`);
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

describe("the view's select lists never name a contact column below admin", () => {
  it("cashier and manager columns hold no phone, email, address or formatted phone", async () => {
    const { customerViewColumns } = await import("../services/customerView");
    const { customers } = await import("@shared/schema");
    const contact = [customers.phone, customers.email, customers.address, customers.phoneE164];
    for (const role of ["CASHIER", "MANAGER"]) {
      const cols = Object.values(customerViewColumns(role));
      for (const column of contact) expect(cols.includes(column as never), `${role} ${column.name}`).toBe(false);
    }
    const admin = Object.values(customerViewColumns("ADMIN"));
    expect(admin.includes(customers.phone as never)).toBe(true);
  });
});

describe.skipIf(!hasDb)("customer view, phone lookup, delivery (database)", () => {
  let app: express.Express;
  let db: any;
  let s: typeof import("@shared/schema");
  const orgId = randomUUID();
  const CASHIER = "views-cashier";
  const OTHER = "views-other-cashier";
  const ids = { jane: "", liveDelivery: "", doneDelivery: "", oldMine: "", recentOther: "", recentMine: "" };

  function as(role: string, user?: string) {
    const agent = (method: "get" | "post" | "put" | "patch", url: string) =>
      request(app)
        [method](url)
        .set("x-test-role", role)
        .set("x-test-org", orgId)
        .set("x-org-id", orgId)
        .set("x-test-user", user ?? `views-${role.toLowerCase()}`);
    return {
      get: (url: string) => agent("get", url),
      post: (url: string, body: unknown = {}) => agent("post", url).send(body as object),
      put: (url: string, body: unknown = {}) => agent("put", url).send(body as object),
      patch: (url: string, body: unknown = {}) => agent("patch", url).send(body as object),
    };
  }

  beforeAll(async () => {
    ({ db } = await import("../db"));
    s = await import("@shared/schema");
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Customer Views Org" });
    const [jane] = await db
      .insert(s.customers)
      .values({
        orgId,
        name: "Jane Smith",
        phone: "07700 904821",
        email: "jane.smith@gmail.com",
        address: "9 Saved Street",
        loyaltyPoints: 40,
        totalSpent: "88.00",
      })
      .returning();
    ids.jane = jane.id;
    const day = 86_400_000;
    const now = Date.now();
    const order = (values: Record<string, unknown>) =>
      db.insert(s.orders).values({ orgId, total: "10.00", paymentMethod: "cash", ...values }).returning();
    [{ id: ids.liveDelivery }] = await order({
      customerId: jane.id,
      status: "out_for_delivery",
      fulfilmentMethod: "delivery",
      deliveryAddress: "5 Live Lane",
      deliveryPostcode: "LV1 1VE",
      assignedUserId: CASHIER,
      outForDeliveryAt: new Date(),
      inputUserId: OTHER,
    });
    [{ id: ids.doneDelivery }] = await order({
      customerId: jane.id,
      status: "completed",
      settledAt: new Date(),
      fulfilmentMethod: "delivery",
      deliveryAddress: "6 Done Drive",
      deliveryPostcode: "DN1 1DN",
      assignedUserId: CASHIER,
      outForDeliveryAt: new Date(),
      inputUserId: OTHER,
    });
    [{ id: ids.recentMine }] = await order({ status: "completed", createdAt: new Date(now - 3 * day), inputUserId: CASHIER });
    [{ id: ids.recentOther }] = await order({ status: "completed", createdAt: new Date(now - 3 * day), inputUserId: OTHER });
    [{ id: ids.oldMine }] = await order({ status: "completed", createdAt: new Date(now - 10 * day), completedUserId: CASHIER });

    const { registerRoutes } = await import("../routes");
    app = express();
    app.use(express.json());
    await registerRoutes(app as any);
  });

  afterAll(async () => {
    if (!db) return;
    const { eq } = await import("drizzle-orm");
    for (const table of [s.adminAuditLogs, s.apiKeys, s.orderEvents, s.orders, s.customers] as any[]) {
      try {
        await db.delete(table).where(eq(table.orgId, orgId));
      } catch (e) {
        console.warn("[customerViews] cleanup", (e as Error).message);
      }
    }
    await db.delete(s.organizations).where(eq(s.organizations.id, orgId)).catch(() => {});
  });

  it("the database formats a phone exactly as formatUkPhone does", async () => {
    const { sql } = await import("drizzle-orm");
    const samples = [
      "07700 904821", "+44 7700 904821", "+44 (0)7700 904821", "0044 7700 904821", "447700904821",
      "7700904821", "020 7946 0018", "0123", "", "+1 415 555 0100", "904821",
    ];
    for (const raw of samples) {
      const result = await db.execute(sql`select arcarna_format_uk_phone(${raw}) as f`);
      const rows = (result.rows ?? result) as Array<{ f: string | null }>;
      expect(rows[0].f, raw).toBe(formatUkPhone(raw));
    }
  });

  it("the trigger keeps the formatted phone in step with every write", async () => {
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select({ f: s.customers.phoneE164 }).from(s.customers).where(eq(s.customers.id, ids.jane));
    expect(row.f).toBe("+447700904821");
  });

  it("a cashier reads name, tier, points and masks — no contact, no order summary (Q7)", async () => {
    const res = await as("CASHIER").get(`/api/customers/${ids.jane}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Jane Smith",
      loyaltyPoints: 40,
      hasPhone: true,
      hasEmail: true,
      phoneLast4: "4821",
      phoneMasked: "••4821",
      emailMasked: "j•••@gmail.com",
    });
    for (const field of ["phone", "email", "address", "phoneE164", "totalSpent", "orderCount"]) {
      expect(res.body, field).not.toHaveProperty(field);
    }
    expect(JSON.stringify(res.body)).not.toContain("904821\"");
    expect(JSON.stringify(res.body)).not.toContain("Saved Street");
  });

  it("a manager also reads the past-order summary, still no phone", async () => {
    const res = await as("MANAGER").get(`/api/customers/${ids.jane}`);
    expect(res.body).toMatchObject({ totalSpent: "88.00", orderCount: 2, phoneMasked: "••4821" });
    expect(res.body).not.toHaveProperty("phone");
    const list = await as("MANAGER").get("/api/customers");
    expect(JSON.stringify(list.body)).not.toContain("07700 904821");
  });

  it("an admin reads everything", async () => {
    const res = await as("ADMIN").get(`/api/customers/${ids.jane}`);
    expect(res.body).toMatchObject({ phone: "07700 904821", email: "jane.smith@gmail.com", address: "9 Saved Street" });
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("Jane's full number finds her at the till, in any format; part of it finds nobody", async () => {
    const found = await as("CASHIER").post("/api/customers/lookup-phone", { phone: "+44 7700 904821" });
    expect(found.status).toBe(200);
    expect(found.body.matches).toEqual([{ id: ids.jane, displayName: "Jane S.", phoneMasked: "••4821" }]);
    expect(found.headers["cache-control"]).toContain("no-store");
    const partial = await as("CASHIER").post("/api/customers/lookup-phone", { phone: "904821" });
    expect(partial.status).toBe(400);
  });

  it("the lookup is rate-limited per person, not per till", async () => {
    const { phoneLookupLimit } = await import("../routes/customers");
    phoneLookupLimit.reset();
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await as("CASHIER", "views-hammer").post("/api/customers/lookup-phone", { phone: "07700 900000" })).status;
    }
    expect(last).toBe(429);
    // Someone else on the same till is not held up.
    expect((await as("CASHIER", "views-colleague").post("/api/customers/lookup-phone", { phone: "07700 900000" })).status).toBe(200);
    phoneLookupLimit.reset();
  });

  it("creating Jane again prompts; confirmed, the new record stores who made it", async () => {
    const again = await as("CASHIER").post("/api/customers", { name: "Jane Smith", phone: "07700904821" });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({
      code: "CUSTOMER_POSSIBLE_DUPLICATE",
      message: "Already on the system: Jane S. (••4821), use them?",
    });
    expect(JSON.stringify(again.body)).not.toContain("07700904821");

    const created = await as("CASHIER").post("/api/customers", {
      name: "Jane Smythe",
      phone: "07700904821",
      loyaltyPoints: 5000,
      category: "Platinum",
      confirmNew: true,
    });
    expect(created.status).toBe(200);
    expect(created.body).not.toHaveProperty("phone");
    expect(created.body.loyaltyPoints).toBe(0);
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(s.customers).where(eq(s.customers.id, created.body.id));
    expect(row).toMatchObject({ createdByUserId: "views-cashier", phone: "07700904821", category: "Bronze", loyaltyPoints: 0 });
  });

  it("edit without reading: points not typeable, receipt switch saves, masked values ignored, blanks keep", async () => {
    const res = await as("MANAGER").put(`/api/customers/${ids.jane}`, {
      name: "Jane Smith",
      loyaltyPoints: 99999,
      totalSpent: "1.00",
      phone: "••4821",
      email: "",
      receiptEmailOptIn: false,
    });
    expect(res.status).toBe(200);
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(s.customers).where(eq(s.customers.id, ids.jane));
    expect(row).toMatchObject({
      loyaltyPoints: 40,
      totalSpent: "88.00",
      phone: "07700 904821",
      email: "jane.smith@gmail.com",
      receiptEmailOptIn: false,
    });
  });

  it("a manager's Replace number writes without reading, and is logged", async () => {
    const { and, eq } = await import("drizzle-orm");
    const res = await as("MANAGER").post(`/api/customers/${ids.jane}/replace-phone`, { phone: "07700 904822" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ phoneMasked: "••4822" });
    expect(res.body).not.toHaveProperty("phone");
    const [row] = await db.select().from(s.customers).where(eq(s.customers.id, ids.jane));
    expect(row.phoneE164).toBe("+447700904822");
    const logs = await db
      .select()
      .from(s.adminAuditLogs)
      .where(and(eq(s.adminAuditLogs.orgId, orgId), eq(s.adminAuditLogs.action, "customer.phone_replaced")));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0].metadata)).not.toContain("904822\"");
    expect((await as("CASHIER").post(`/api/customers/${ids.jane}/replace-phone`, { phone: "07700 904823" })).status).toBe(403);
    // Put it back for the tests that follow.
    await db.update(s.customers).set({ phone: "07700 904821" }).where(eq(s.customers.id, ids.jane));
  });

  it("Use saved address hands the till the address and logs it", async () => {
    const { and, eq } = await import("drizzle-orm");
    const res = await as("CASHIER").post(`/api/customers/${ids.jane}/saved-address`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ address: "9 Saved Street" });
    expect(res.headers["cache-control"]).toContain("no-store");
    const logs = await db
      .select()
      .from(s.adminAuditLogs)
      .where(and(eq(s.adminAuditLogs.orgId, orgId), eq(s.adminAuditLogs.action, "customer.saved_address_used")));
    expect(logs.length).toBeGreaterThan(0);
  });

  it("a cashier's history is today plus their own last seven days (Q10a); a manager's is all of it", async () => {
    const cashier = await as("CASHIER", CASHIER).get("/api/orders");
    const seen = new Set((cashier.body as Array<{ id: string }>).map((o) => o.id));
    expect(seen.has(ids.liveDelivery)).toBe(true);
    expect(seen.has(ids.recentMine)).toBe(true);
    expect(seen.has(ids.recentOther)).toBe(false);
    expect(seen.has(ids.oldMine)).toBe(false);
    const manager = await as("MANAGER").get("/api/orders");
    const all = new Set((manager.body as Array<{ id: string }>).map((o) => o.id));
    for (const id of Object.values(ids).filter((v) => v !== ids.jane)) expect(all.has(id)).toBe(true);
  });

  it("the palette's order search runs on the server, inside the same bound", async () => {
    const byName = await as("CASHIER", CASHIER).get("/api/orders/search?q=jane");
    expect((byName.body as Array<{ id: string }>).map((o) => o.id).sort()).toEqual([ids.doneDelivery, ids.liveDelivery].sort());
    const byPhone = await as("CASHIER", CASHIER).get(`/api/orders/search?q=${encodeURIComponent("07700 904821")}`);
    expect((byPhone.body as unknown[]).length).toBe(2);
    expect(JSON.stringify(byPhone.body)).not.toContain("904821");
    const old = await as("CASHIER", CASHIER).get(`/api/orders/search?q=${ids.oldMine.slice(0, 8)}`);
    expect(old.body).toEqual([]);
    const managerOld = await as("MANAGER").get(`/api/orders/search?q=${ids.oldMine.slice(0, 8)}`);
    expect((managerOld.body as Array<{ id: string }>).map((o) => o.id)).toEqual([ids.oldMine]);
  });

  it("the board: no phone for anyone; a live delivery's address for all; a finished one for managers", async () => {
    const cashier = await as("CASHIER", CASHIER).get("/api/orders/board");
    expect(cashier.status).toBe(200);
    const byId = new Map((cashier.body.orders as any[]).map((o) => [o.id, o]));
    expect(byId.get(ids.liveDelivery)).toMatchObject({ deliveryAddress: "5 Live Lane", deliveryPostcode: "LV1 1VE" });
    expect(byId.get(ids.doneDelivery)).toMatchObject({ deliveryAddress: null, deliveryPostcode: null });
    expect(JSON.stringify(cashier.body)).not.toContain("904821");
    for (const order of cashier.body.orders as any[]) expect(order).not.toHaveProperty("customerPhone");
    const manager = await as("MANAGER").get("/api/orders/board");
    const m = new Map((manager.body.orders as any[]).map((o) => [o.id, o]));
    expect(m.get(ids.doneDelivery)).toMatchObject({ deliveryAddress: "6 Done Drive" });
  });

  it("the board's phone search finds the customer's orders without sending the number", async () => {
    const res = await as("CASHIER", CASHIER).post("/api/orders/board/phone-search", { phone: "+447700904821" });
    expect(res.status).toBe(200);
    expect((res.body.orderIds as string[]).sort()).toEqual([ids.doneDelivery, ids.liveDelivery].sort());
  });

  it("the driver's call: the assigned driver while out for delivery, admins always; every reveal logged (Q8a)", async () => {
    const { and, eq } = await import("drizzle-orm");
    const driver = await as("CASHIER", CASHIER).post(`/api/orders/${ids.liveDelivery}/customer-phone`);
    expect(driver.status).toBe(200);
    expect(driver.body).toEqual({ phone: "07700 904821" });
    expect(driver.headers["cache-control"]).toContain("no-store");
    expect((await as("CASHIER", OTHER).post(`/api/orders/${ids.liveDelivery}/customer-phone`)).status).toBe(403);
    expect((await as("MANAGER").post(`/api/orders/${ids.liveDelivery}/customer-phone`)).status).toBe(403);
    expect((await as("CASHIER", CASHIER).post(`/api/orders/${ids.doneDelivery}/customer-phone`)).status).toBe(403);
    expect((await as("ADMIN").post(`/api/orders/${ids.doneDelivery}/customer-phone`)).status).toBe(200);
    const logs = await db
      .select()
      .from(s.adminAuditLogs)
      .where(and(eq(s.adminAuditLogs.orgId, orgId), eq(s.adminAuditLogs.action, "order.customer_phone_revealed")));
    expect(logs).toHaveLength(2);
  });

  it("the order detail: a finished delivery's address for managers, not cashiers", async () => {
    const cashier = await as("CASHIER", CASHIER).get(`/api/orders/${ids.doneDelivery}`);
    expect(cashier.body).not.toHaveProperty("deliveryAddress");
    const live = await as("CASHIER", CASHIER).get(`/api/orders/${ids.liveDelivery}`);
    expect(live.body).toMatchObject({ deliveryAddress: "5 Live Lane" });
    const manager = await as("MANAGER").get(`/api/orders/${ids.doneDelivery}`);
    expect(manager.body).toMatchObject({ deliveryAddress: "6 Done Drive" });
  });

  it("the API needs customers:read_contact for contact details", async () => {
    const { storage } = await import("../storage");
    const plain = await storage.createApiKeyForOrg(orgId, "views-plain", ["customers:read"]);
    const contact = await storage.createApiKeyForOrg(orgId, "views-contact", ["customers:read", "customers:read_contact"]);
    const read = (key: string) =>
      request(app).get(`/v1/orgs/${orgId}/customers/${ids.jane}`).set("Authorization", `Bearer ${key}`);
    const masked = await read(plain.plainKey);
    expect(masked.status).toBe(200);
    expect(masked.body).toMatchObject({ name: "Jane Smith", phoneMasked: "••4821" });
    expect(masked.body).not.toHaveProperty("phone");
    expect(masked.body).not.toHaveProperty("email");
    const full = await read(contact.plainKey);
    expect(full.body).toMatchObject({ phone: "07700 904821", email: "jane.smith@gmail.com" });
  });

  it("a live delivery's address can be corrected by anyone on the counter; a finished one cannot", async () => {
    const fixed = await as("CASHIER", OTHER).patch(`/api/orders/${ids.liveDelivery}/delivery`, {
      deliveryAddress: "5 Live Lane, Flat 2",
      deliveryPostcode: "lv11ve",
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ deliveryAddress: "5 Live Lane, Flat 2", deliveryPostcode: "LV1 1VE" });
    const blank = await as("CASHIER", OTHER).patch(`/api/orders/${ids.liveDelivery}/delivery`, { deliveryAddress: "" });
    expect(blank.status).toBe(400);
    expect((await as("MANAGER").patch(`/api/orders/${ids.doneDelivery}/delivery`, { deliveryAddress: "x", deliveryPostcode: "y" })).status).toBe(409);
  });
});
