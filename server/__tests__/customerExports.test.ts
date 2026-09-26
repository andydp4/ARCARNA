/**
 * Safe exports, device-facing headers and outbound webhooks (v1.2 Phase 5:
 * FIX-14, PRV-07, CMP-14), against the real route table and a real database.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml). Like
 * customerViews.test.ts it mocks ../db without a database, so the no-DB run
 * skips cleanly.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = !!process.env.DATABASE_URL;
process.env.DEV_AUTH_BYPASS = "0";

vi.mock("../db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {}, pool: {} },
);

// Delivery is to a stand-in: no DNS, no network.
vi.mock("../lib/safeUrl", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return { ...real, assertPublicHttpsUrl: async (url: string) => url };
});

vi.mock("../auth", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  const fakeAuth = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    const id = `exports-${String(role).toLowerCase()}`;
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

const HOSTILE_NAME = '=HYPERLINK("http://evil.example","Click")';

describe.skipIf(!hasDb)("exports, device headers and webhooks (database)", () => {
  let app: express.Express;
  let db: any;
  let s: typeof import("@shared/schema");
  const orgId = randomUUID();
  const ids = { hostile: "", order: "" };

  const as = (role: string) => ({
    get: (url: string) => request(app).get(url).set("x-test-role", role).set("x-test-org", orgId).set("x-org-id", orgId),
    post: (url: string, body: object = {}) =>
      request(app).post(url).set("x-test-role", role).set("x-test-org", orgId).set("x-org-id", orgId).send(body),
  });

  beforeAll(async () => {
    ({ db } = await import("../db"));
    s = await import("@shared/schema");
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Customer Exports Org" });
    const [hostile] = await db
      .insert(s.customers)
      .values({ orgId, name: HOSTILE_NAME, phone: "07700 900555", email: "evil@example.com", loyaltyPoints: 1 })
      .returning();
    ids.hostile = hostile.id;
    const [order] = await db
      .insert(s.orders)
      .values({
        orgId,
        customerId: hostile.id,
        total: "12.50",
        paymentMethod: "cash",
        status: "pending",
        fulfilmentMethod: "delivery",
        deliveryAddress: "1 Secret Street",
      })
      .returning();
    ids.order = order.id;
    const { registerRoutes } = await import("../routes");
    app = express();
    app.use(express.json());
    await registerRoutes(app as any);
  });

  afterAll(async () => {
    if (!db) return;
    const { eq } = await import("drizzle-orm");
    for (const table of [s.adminAuditLogs, s.outboundWebhooks, s.orders, s.customers] as any[]) {
      try {
        await db.delete(table).where(eq(table.orgId, orgId));
      } catch (e) {
        console.warn("[customerExports] cleanup", (e as Error).message);
      }
    }
    await db.delete(s.organizations).where(eq(s.organizations.id, orgId)).catch(() => {});
  });

  it('a customer named "=HYPERLINK(…)" exports as plain text, with the UTF-8 marker (owner check 6)', async () => {
    const res = await as("ADMIN")
      .post("/api/customers/bulk", { ids: [ids.hostile], action: "export" })
      .buffer(true)
      .parse((r, cb) => {
        let data = "";
        r.setEncoding("utf8");
        r.on("data", (chunk: string) => (data += chunk));
        r.on("end", () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["cache-control"]).toContain("no-store");
    const text = res.body as string;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
    expect(text).not.toMatch(/(^|,|\n)=HYPERLINK/);
  });

  it("customer lists and the WhatsApp inbox tell every browser and the service worker not to store them", async () => {
    for (const role of ["CASHIER", "MANAGER", "ADMIN"]) {
      const list = await as(role).get("/api/customers");
      expect(list.status, role).toBe(200);
      expect(list.headers["cache-control"], role).toContain("no-store");
      const one = await as(role).get(`/api/customers/${ids.hostile}`);
      expect(one.headers["cache-control"], role).toContain("no-store");
      const inbox = await as(role).get("/api/whatsapp/conversations");
      expect(inbox.status, role).toBe(200);
      expect(inbox.headers["cache-control"], role).toContain("no-store");
    }
  });

  it("a webhook receives the explicit order payload: no name, phone or address, and it finds the org from the order", async () => {
    await db.insert(s.outboundWebhooks).values({
      orgId,
      url: "https://hooks.example.test/arcarna",
      secret: "a-secret-of-sixteen+",
      eventTypes: ["OrderCreated"],
    });
    const sent: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      sent.push({ url: String(url), body: String(init?.body ?? ""), headers: init?.headers ?? {} });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      const { notifyOutboundWebhooksForEvent } = await import("../webhooks/outboundNotify");
      await notifyOutboundWebhooksForEvent({
        eventId: randomUUID(),
        eventType: "OrderCreated",
        payload: {
          order: {
            orderId: ids.order,
            status: "pending",
            customerId: ids.hostile,
            total: 12.5,
            paymentMethod: "cash",
            sendEmailReceipt: true,
            deliveryAddress: "1 Secret Street",
            customerPhone: "07700 900555",
            items: [{ lineId: "l1", productId: "p1", qty: 1, unitPrice: 12.5, lineTotal: 12.5 }],
          },
        },
      });
      // A staff matter is never sent, whoever subscribes.
      await notifyOutboundWebhooksForEvent({
        eventId: randomUUID(),
        eventType: "PersonalUseRecorded",
        payload: { orgId, reason: "lunch" },
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0].body);
    expect(body.eventType).toBe("OrderCreated");
    expect(body.payload).toEqual({
      orderId: ids.order,
      status: "pending",
      customerId: ids.hostile,
      total: 12.5,
      paymentMethod: "cash",
      items: [{ productId: "p1", qty: 1, unitPrice: 12.5, lineTotal: 12.5 }],
    });
    for (const leaked of ["Secret Street", "900555", "HYPERLINK", "sendEmailReceipt"]) {
      expect(sent[0].body, leaked).not.toContain(leaked);
    }
  });

  it("a webhook can only be registered for events that have an explicit payload", async () => {
    const res = await as("ADMIN").post("/api/webhooks", {
      url: "https://hooks.example.test/arcarna",
      secret: "a-secret-of-sixteen+",
      eventTypes: ["PersonalUseRecorded"],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("PersonalUseRecorded");
  });
});
