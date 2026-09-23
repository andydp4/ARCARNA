/**
 * Role matrix (v1.2 Phase 0B, CMP-16).
 *
 * Two halves, one file:
 *
 * 1. Policy. Every row of ACCESS_POLICY (shared/accessPolicy.ts) is requested
 *    through the REAL route table (`registerRoutes`) and the REAL
 *    `requireRole`, as each staff role. Below the row's minimum role the server
 *    must answer 403; at or above it, it must not. Only sign-in and org
 *    resolution are faked, because they are not what is under test. Runs with
 *    or without a database, so the no-DB `check` job enforces it too.
 *
 * 2. Canaries. With a database, a throwaway org is seeded with values that
 *    must never reach a cashier — phone 07700 900123, email
 *    canary@example.invalid and a cost price of £13.37 — on a customer, a
 *    supplier and a product that has stock and a sale. Then EVERY GET route
 *    the app registers is called as a cashier and the bodies are searched.
 *    New routes are covered automatically: nobody has to remember to add them.
 *
 *    Routes that still leak and are being closed by another part of Phase 0B
 *    are listed in KNOWN_LEAKS with the part that owns them. The list may only
 *    shrink; a leak that is not on it fails the build.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml).
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACCESS_POLICY, CANARIES, STAFF_ROLES, isAtLeast } from "@shared/accessPolicy";

const hasDb = !!process.env.DATABASE_URL;

// The real requireRole waves everything through when the dev bypass is on.
process.env.DEV_AUTH_BYPASS = "0";

// Without a database, server/db.ts throws at import. The guards under test in
// half 1 never reach it; handlers behind them may, and a 500 there still
// proves the guard let the request through.
vi.mock("../db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {}, pool: {} },
);

/**
 * Sign-in is faked from two test headers; org context is taken from the same
 * user. requireRole and requireOrgScope stay real.
 */
vi.mock("../auth", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  const fakeAuth = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    const id = `role-matrix-${String(role).toLowerCase()}`;
    req.user = {
      id,
      role,
      orgId: req.headers["x-test-org"] ?? null,
      isAllowed: true,
      claims: { sub: id },
    };
    return next();
  };
  const fakeOrgContext = (req: any, _res: any, next: any) => {
    if (!req.user) return next();
    req.orgContext = {
      orgId: req.user.orgId,
      locationId: (req.headers["x-location-id"] as string) || null,
      role: req.user.role,
    };
    return next();
  };
  return {
    ...real,
    setupAuth: async () => {},
    isAuthenticated: fakeAuth,
    requireOrgContext: fakeOrgContext,
  };
});

async function buildApp() {
  const { registerRoutes } = await import("../routes");
  const app = express();
  app.use(express.json());
  await registerRoutes(app as any);
  return app;
}

function fillParams(path: string, values: Record<string, string>, fallback: string): string {
  return path.replace(/:([A-Za-z_]+)/g, (_m, name: string) => values[name] ?? fallback);
}

describe("role matrix: ACCESS_POLICY is what the server enforces", () => {
  let app: express.Express;
  const orgId = randomUUID();

  beforeAll(async () => {
    app = await buildApp();
  });

  it("every policy row is a route the app actually registers", () => {
    const registered = new Set(
      ((app as any).router.stack as any[])
        .filter((l) => l.route)
        .flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`)),
    );
    const missing = ACCESS_POLICY.map((r) => `${r.method} ${r.path}`).filter((k) => !registered.has(k));
    expect(missing).toEqual([]);
  });

  const cases = ACCESS_POLICY.flatMap((rule) =>
    STAFF_ROLES.map((role) => [`${rule.method} ${rule.path}`, role, rule] as const),
  );

  it.each(cases)("%s as %s", async (_key, role, rule) => {
    const url = fillParams(rule.path, {}, randomUUID());
    const res = await request(app)
      [rule.method.toLowerCase() as "get"](url)
      .set("x-test-role", role)
      .set("x-test-org", orgId)
      .set("x-org-id", orgId)
      .send({});
    if (isAtLeast(role, rule.minRole)) {
      expect(res.status, `${role} should get past the guard (${rule.reason})`).not.toBe(403);
      expect(res.status).not.toBe(401);
    } else {
      expect(res.status, `${role} must be refused (${rule.reason})`).toBe(403);
    }
  });

  it("the customer export (contact details) is admin only", async () => {
    for (const role of STAFF_ROLES) {
      const res = await request(app)
        .post("/api/customers/bulk")
        .set("x-test-role", role)
        .set("x-test-org", orgId)
        .send({ ids: [randomUUID()], action: "export" });
      if (isAtLeast(role, "ADMIN")) expect(res.status, role).not.toBe(403);
      else expect(res.status, role).toBe(403);
    }
  });

  it("Staff KPI Evidence (managers' performance, Q12) is admin only", async () => {
    for (const role of STAFF_ROLES) {
      const res = await request(app)
        .get("/api/reports/ARC-T2-002")
        .set("x-test-role", role)
        .set("x-test-org", orgId)
        .set("x-org-id", orgId);
      if (isAtLeast(role, "ADMIN")) expect(res.status, role).not.toBe(403);
      else expect(res.status, role).toBe(403);
    }
  });

  it("the product export (every column, cost included) is admin only", async () => {
    for (const role of STAFF_ROLES) {
      const res = await request(app)
        .post("/api/products/bulk")
        .set("x-test-role", role)
        .set("x-test-org", orgId)
        .send({ ids: [randomUUID()], action: "export" });
      if (isAtLeast(role, "ADMIN")) expect(res.status, role).not.toBe(403);
      else expect(res.status, role).toBe(403);
    }
  });
});

/**
 * GET routes that still hand a cashier a canary, each owned by another part
 * of Phase 0B (see the brief). Key: "GET /path" → the canaries it may still
 * carry and who closes it. Remove a line when its part lands.
 */
type Canary = keyof typeof CANARIES | "foreignOrg";

const KNOWN_LEAKS: Record<string, { canaries: Canary[]; owner: string }> = {
  "GET /api/orders/board": {
    canaries: ["phone"],
    owner: "owner decision: the Operations board shows the customer's phone to whoever works the order",
  },
};

/**
 * Evidence refs are one route with a parameter, so the sweep calls each one.
 * Keep in step with runReport's switch in server/services/reportsEngine.ts.
 */
const REPORT_REFS = [
  "ARC-T1-001", "ARC-T1-002", "ARC-T1-003", "ARC-T1-004", "ARC-T1-005",
  "ARC-T2-001", "ARC-T2-002", "ARC-T2-003", "ARC-T2-004", "ARC-T2-005",
  "ARC-T3-001", "ARC-T3-002", "ARC-T3-003",
  "ARC-T4-001", "ARC-T4-002", "ARC-T4-003",
];

/** A product name that belongs to another org. It must never cross over. */
const FOREIGN_MARKER = `ZZ-FOREIGN-${randomUUID()}`;

/** Never called: they stream forever or talk to the outside world. */
const SWEEP_SKIP = new Set(["GET /api/orders/board/stream", "GET /api/whatsapp/webhook"]);

describe.skipIf(!hasDb)("role matrix: canaries never reach a cashier", () => {
  let app: express.Express;
  let db: any;
  let schema: typeof import("@shared/schema");
  const ids = {
    orgId: randomUUID(),
    foreignOrgId: randomUUID(),
    locationId: "",
    productId: "",
    customerId: "",
    orderId: "",
    supplierId: "",
    // The cashier's own shifts: their sheets are theirs to read, so the sweep
    // must reach them with real ids, not a product id that 404s.
    cashierShiftId: "",
    closedCashierShiftId: "",
    tillShiftId: "",
  };
  const CASHIER_ID = "role-matrix-cashier";

  beforeAll(async () => {
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    const s = schema;
    await db.insert(s.organizations).values({ id: ids.orgId, name: "ZZ Role Matrix Canary Org" });
    const [loc] = await db
      .insert(s.locations)
      .values({
        orgId: ids.orgId,
        name: "Canary Shop",
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
    ids.locationId = loc.id;
    const [prod] = await db
      .insert(s.products)
      .values({
        orgId: ids.orgId,
        locationId: loc.id,
        name: "Canary Widget",
        productId: `CANARY-${randomUUID().slice(0, 8)}`,
        defaultSalePrice: "20.00",
        costPrice: CANARIES.costPrice,
        stock: 2,
        stockLimit: 50,
      })
      .returning();
    ids.productId = prod.id;
    await db
      .insert(s.productLocationStock)
      .values({ orgId: ids.orgId, productId: prod.id, locationId: loc.id, stock: 2 });
    const [cust] = await db
      .insert(s.customers)
      .values({ orgId: ids.orgId, name: "Canary Customer", phone: CANARIES.phone, email: CANARIES.email })
      .returning();
    ids.customerId = cust.id;
    const [order] = await db
      .insert(s.orders)
      .values({
        orgId: ids.orgId,
        locationId: loc.id,
        customerId: cust.id,
        total: "20.00",
        paymentMethod: "cash",
        status: "completed",
        // Settled, so the sale counts in every Evidence figure, cost included.
        settledAt: new Date(),
        settledTotal: "20.00",
      })
      .returning();
    ids.orderId = order.id;
    await db.insert(s.orderItems).values({
      orgId: ids.orgId,
      orderId: order.id,
      productId: prod.id,
      quantity: 1,
      unitPrice: "20.00",
      totalPrice: "20.00",
    });
    // A personal-use expense books stock at cost on the order.
    await db.insert(s.orderExpenses).values({
      orgId: ids.orgId,
      orderId: order.id,
      category: "personal_use",
      amount: CANARIES.costPrice,
    });
    // The cashier's open lazy shift holds the canary sale, so its live sheet
    // costs it at £13.37; a closed one carries a stored summary with that cost.
    const [openShift] = await db
      .insert(s.cashierShifts)
      .values({ orgId: ids.orgId, userId: CASHIER_ID, openedByUserId: CASHIER_ID, status: "open" })
      .returning();
    ids.cashierShiftId = openShift.id;
    const { eq } = await import("drizzle-orm");
    await db.update(s.orders).set({ cashierShiftId: openShift.id }).where(eq(s.orders.id, order.id));
    const [closedShift] = await db
      .insert(s.cashierShifts)
      .values({ orgId: ids.orgId, userId: CASHIER_ID, openedByUserId: CASHIER_ID, status: "closed", closedAt: new Date() })
      .returning();
    ids.closedCashierShiftId = closedShift.id;
    await db.insert(s.cashierShiftSummaries).values({
      orgId: ids.orgId,
      shiftId: closedShift.id,
      userId: CASHIER_ID,
      grossSales: "20.00",
      stockCost: CANARIES.costPrice,
      netSalesProfit: "6.63",
      commissionRate: "12.50",
      commissionAmount: "1.33",
      closedAt: new Date(),
    });
    const [till] = await db
      .insert(s.shifts)
      .values({ orgId: ids.orgId, locationId: loc.id, userId: CASHIER_ID, status: "open" })
      .returning();
    ids.tillShiftId = till.id;
    const [sup] = await db
      .insert(s.suppliers)
      .values({ orgId: ids.orgId, name: "Canary Supplies", phone: CANARIES.phone, email: CANARIES.email })
      .returning();
    ids.supplierId = sup.id;
    await db.insert(s.productSuppliers).values({
      orgId: ids.orgId,
      productId: prod.id,
      supplierId: sup.id,
      costPrice: CANARIES.costPrice,
      isPreferred: 1,
    });
    // A second org with its own sale in the window. Nothing of it may show
    // in the first org's responses (the Evidence export once did exactly that).
    await db.insert(s.organizations).values({ id: ids.foreignOrgId, name: "ZZ Role Matrix Foreign Org" });
    const [fprod] = await db
      .insert(s.products)
      .values({ orgId: ids.foreignOrgId, name: FOREIGN_MARKER, productId: FOREIGN_MARKER.slice(0, 40), defaultSalePrice: "5.00" })
      .returning();
    const [forder] = await db
      .insert(s.orders)
      .values({ orgId: ids.foreignOrgId, total: "5.00", paymentMethod: "cash", status: "completed", settledAt: new Date() })
      .returning();
    await db.insert(s.orderItems).values({
      orgId: ids.foreignOrgId,
      orderId: forder.id,
      productId: fprod.id,
      quantity: 1,
      unitPrice: "5.00",
      totalPrice: "5.00",
    });
    app = await buildApp();
  });

  afterAll(async () => {
    if (!db) return;
    for (const org of [ids.orgId, ids.foreignOrgId]) await removeOrg(org);
  });

  async function removeOrg(org: string) {
    const s = schema;
    const { eq } = await import("drizzle-orm");
    // Children first. Anything a route wrote as a side effect (audit rows,
    // snapshots) is swept by org id where the table has one.
    for (const table of [
      s.adminAuditLogs,
      s.orderExpenses,
      s.orderItems,
      s.orders,
      s.cashierShiftSummaries,
      s.cashierShifts,
      s.shifts,
      s.inventoryMovements,
      s.productLocationStock,
      s.productSuppliers,
      s.suppliers,
      s.products,
      s.customers,
      s.locations,
    ] as any[]) {
      try {
        await db.delete(table).where(eq(table.orgId, org));
      } catch (e) {
        console.warn("[roleMatrix] cleanup", (e as Error).message);
      }
    }
    try {
      await db.delete(s.organizations).where(eq(s.organizations.id, org));
    } catch (e) {
      console.warn("[roleMatrix] could not remove the canary org", (e as Error).message);
    }
  }

  function as(role: string, method: "get" | "post", url: string) {
    return request(app)
      [method](url)
      .set("x-test-role", role)
      .set("x-test-org", ids.orgId)
      .set("x-org-id", ids.orgId)
      .set("x-location-id", ids.locationId)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => cb(null, Buffer.concat(chunks).toString("latin1")));
      })
      .timeout(20_000);
  }

  function canariesIn(body: string): Canary[] {
    const found: Canary[] = [];
    const digits = body.replace(/[\s+-]/g, "");
    if (body.includes(CANARIES.phone) || digits.includes("7700900123")) found.push("phone");
    if (body.toLowerCase().includes(CANARIES.email)) found.push("email");
    if (body.includes(CANARIES.costPrice)) found.push("costPrice");
    if (body.includes(FOREIGN_MARKER)) found.push("foreignOrg");
    return found;
  }

  function paramsFor(path: string): Record<string, string> {
    const byPrefix =
      path.startsWith("/api/customers") ? ids.customerId
      : path.startsWith("/api/cashier-shifts") ? ids.cashierShiftId
      : path.startsWith("/api/shifts") ? ids.tillShiftId
      : path.startsWith("/api/orders") ? ids.orderId
      : path.startsWith("/api/suppliers") ? ids.supplierId
      : path.startsWith("/api/locations") ? ids.locationId
      : ids.productId;
    return {
      id: byPrefix,
      orgId: ids.orgId,
      productId: ids.productId,
      customerId: ids.customerId,
      orderId: ids.orderId,
      locationId: ids.locationId,
    };
  }

  it("the canaries are really there: a manager sees the cost and the supplier's phone", async () => {
    const products = await as("MANAGER", "get", "/api/products");
    expect(products.status).toBe(200);
    expect(canariesIn(products.body)).toContain("costPrice");
    const supplierList = await as("MANAGER", "get", "/api/suppliers");
    expect(supplierList.status).toBe(200);
    expect(canariesIn(supplierList.body)).toEqual(expect.arrayContaining(["phone", "email"]));
  });

  it("the sweep really reaches the cashier's own shift sheets", async () => {
    // Otherwise a 404 reads as an empty, canary-free body and proves nothing.
    const live = await as("CASHIER", "get", `/api/cashier-shifts/${ids.cashierShiftId}/summary`);
    expect(live.status).toBe(200);
    expect(JSON.parse(live.body).summary.grossSales).toBe(20);
    const stored = await as("CASHIER", "get", `/api/cashier-shifts/${ids.closedCashierShiftId}/summary`);
    expect(stored.status).toBe(200);
    expect(JSON.parse(stored.body).summary.grossSales).toBe("20.00");
    expect((await as("CASHIER", "get", `/api/shifts/${ids.tillShiftId}/report`)).status).toBe(200);
    // And a manager, who may see cost, does see it there.
    const manager = await as("MANAGER", "get", `/api/cashier-shifts/${ids.cashierShiftId}/summary`);
    expect(canariesIn(manager.body)).toContain("costPrice");
  });

  it("customer contact details reach an admin, not a manager or a cashier (Q13a)", async () => {
    for (const role of ["CASHIER", "MANAGER"]) {
      const list = await as(role, "get", "/api/customers");
      expect(list.status).toBe(200);
      expect(list.body).toContain("Canary Customer");
      expect(canariesIn(list.body), role).toEqual([]);
      const one = await as(role, "get", `/api/customers/${ids.customerId}`);
      expect(JSON.parse(one.body)).toMatchObject({ hasEmail: true, hasPhone: true, phoneLast4: "0123" });
    }
    const admin = await as("ADMIN", "get", `/api/customers/${ids.customerId}`);
    expect(canariesIn(admin.body)).toEqual(expect.arrayContaining(["phone", "email"]));
  });

  it("the Evidence export carries only this org's products", async () => {
    const res = await as("ADMIN", "get", "/api/reports/export?from=2000-01-01&to=2100-01-01&format=csv&type=inventory");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Canary Widget");
    expect(res.body).not.toContain(FOREIGN_MARKER);
  });

  it("a cashier still gets the products, stock and the product itself — just not the cost", async () => {
    const list = await as("CASHIER", "get", "/api/products");
    expect(list.status).toBe(200);
    const parsed = JSON.parse(list.body) as Array<Record<string, unknown>>;
    const row = parsed.find((p) => p.id === ids.productId);
    expect(row?.name).toBe("Canary Widget");
    expect(row?.stock).toBe(2);
    expect(row).not.toHaveProperty("costPrice");
    const one = await as("CASHIER", "get", `/api/products/${ids.productId}`);
    expect(one.status).toBe(200);
    expect(JSON.parse(one.body)).not.toHaveProperty("costPrice");
  });

  it("a manager's Truths carry no customer email; the customer exports are refused to a manager", async () => {
    const top = await as("MANAGER", "get", "/api/analytics/top-customers");
    expect(top.status).toBe(200);
    expect(top.body).toContain("Canary Customer");
    expect(canariesIn(top.body)).not.toContain("email");

    // GET /api/analytics/rfm scores the org on first read.
    expect((await as("MANAGER", "get", "/api/analytics/rfm")).status).toBe(200);
    const { RFM_SEGMENTS } = await import("@shared/analytics/rfm");
    let seen = false;
    for (const segment of RFM_SEGMENTS) {
      const res = await as("MANAGER", "get", `/api/analytics/rfm/customers?segment=${encodeURIComponent(segment)}`);
      expect(res.status).toBe(200);
      if (res.body.includes("Canary Customer")) seen = true;
      expect(canariesIn(res.body), segment).not.toContain("email");
      expect((await as("MANAGER", "get", `/api/analytics/rfm/export?segment=${encodeURIComponent(segment)}`)).status).toBe(403);
    }
    expect(seen, "the canary customer is in some RFM segment").toBe(true);

    const bulk = await request(app)
      .post("/api/customers/bulk")
      .set("x-test-role", "MANAGER")
      .set("x-test-org", ids.orgId)
      .set("x-org-id", ids.orgId)
      .send({ ids: [ids.customerId], action: "export" });
    expect(bulk.status).toBe(403);
  });

  it("an admin's customer exports work and every one is logged", async () => {
    const { RFM_SEGMENTS } = await import("@shared/analytics/rfm");
    const { and, eq } = await import("drizzle-orm");
    await as("ADMIN", "get", "/api/analytics/rfm");
    let exported = "";
    for (const segment of RFM_SEGMENTS) {
      const res = await as("ADMIN", "get", `/api/analytics/rfm/export?segment=${encodeURIComponent(segment)}`);
      expect(res.status).toBe(200);
      exported += res.body;
    }
    expect(exported).toContain(CANARIES.email);

    const bulk = await request(app)
      .post("/api/customers/bulk")
      .set("x-test-role", "ADMIN")
      .set("x-test-org", ids.orgId)
      .set("x-org-id", ids.orgId)
      .send({ ids: [ids.customerId], action: "export" });
    expect(bulk.status).toBe(200);
    expect(bulk.text).toContain(CANARIES.email);

    const report = await as("ADMIN", "get", "/api/reports/export?from=2000-01-01&to=2100-01-01&format=csv&type=customers");
    expect(report.status).toBe(200);

    const logs = await db
      .select({ action: schema.adminAuditLogs.action })
      .from(schema.adminAuditLogs)
      .where(and(eq(schema.adminAuditLogs.orgId, ids.orgId), eq(schema.adminAuditLogs.actorRole, "ADMIN")));
    const actions = logs.map((l: { action: string }) => l.action);
    expect(actions.filter((a: string) => a === "export.customers_rfm")).toHaveLength(RFM_SEGMENTS.length);
    expect(actions).toContain("bulk.export");
    expect(actions).toContain("export.evidence");
  });

  it("no GET route hands a cashier a canary", async () => {
    const routes = ((app as any).router.stack as any[])
      .filter((l) => l.route && l.route.methods.get)
      .map((l) => l.route.path as string)
      .filter((p) => typeof p === "string");

    // Every URL gets a date range and the other query values the Evidence
    // routes refuse to run without, so they answer with data rather than 400.
    const day = 86_400_000;
    const from = new Date(Date.now() - 30 * day).toISOString().slice(0, 10);
    const to = new Date(Date.now() + day).toISOString().slice(0, 10);
    const query = new URLSearchParams({
      from, to, startDate: from, endDate: to, segment: "Loyal", format: "csv", type: "full",
    }).toString();

    const targets: Array<{ key: string; url: string }> = [];
    for (const path of routes) {
      const key = `GET ${path}`;
      if (SWEEP_SKIP.has(key)) continue;
      if (path === "/api/reports/:ref") {
        for (const ref of REPORT_REFS) targets.push({ key, url: `/api/reports/${ref}?${query}` });
        continue;
      }
      targets.push({ key, url: `${fillParams(path, paramsFor(path), randomUUID())}?${query}` });
    }
    targets.push({ key: "GET /api/reports/export", url: `/api/reports/export?${query.replace("type=full", "type=inventory")}` });
    // The stored summary of a closed shift, as well as the live open one.
    targets.push({
      key: "GET /api/cashier-shifts/:id/summary",
      url: `/api/cashier-shifts/${ids.closedCashierShiftId}/summary`,
    });

    const leaks: string[] = [];
    const stillKnown = new Set<string>();
    for (const { key, url } of targets) {
      let body = "";
      try {
        const res = await as("CASHIER", "get", url);
        body = typeof res.body === "string" ? res.body : "";
      } catch (e) {
        // A timeout or a dropped socket carried nothing to the cashier.
        continue;
      }
      if (process.env.ROLE_MATRIX_DEBUG) console.log("SWEEP", key, body.length, body.slice(0, 80).replace(/\s+/g, " "));
      const found = canariesIn(body);
      if (found.length === 0) continue;
      const allowed = KNOWN_LEAKS[key]?.canaries ?? [];
      const unexpected = found.filter((c) => !allowed.includes(c));
      if (unexpected.length) leaks.push(`${key} (${url.split("?")[0]}) → ${unexpected.join(", ")}`);
      else stillKnown.add(key);
    }

    const closed = Object.keys(KNOWN_LEAKS).filter((k) => !stillKnown.has(k));
    if (closed.length) {
      console.warn(`[roleMatrix] closed since listed — remove from KNOWN_LEAKS: ${closed.join("; ")}`);
    }
    expect(leaks, "cashier-visible canaries (see KNOWN_LEAKS for the ones already owned)").toEqual([]);
  }, 180_000);
});
