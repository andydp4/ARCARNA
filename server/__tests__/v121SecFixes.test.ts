/**
 * v1.2.1 sec — regression tests for the fixes that live below or beside the
 * route handlers (no DB: `../db`, `../storage` and the WhatsApp collaborators
 * are faked). The journey half is tests/journeys/security/v121Sweep.spec.ts.
 * Each block fails on the v1.2 code (d31d2e0).
 */
import express from "express";
import request from "supertest";
import proxyaddr from "proxy-addr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roleRows = vi.hoisted(() => ({ current: null as null | { role: string; orgId: string | null } }));

vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({
  storage: { getUserRoleAndOrg: vi.fn(async () => roleRows.current) },
}));
vi.mock("../whatsapp/config", () => ({
  getWhatsappConfig: () => ({ enabled: true, verifyToken: "vt_sectest" }),
  canSendWhatsapp: () => true,
}));
vi.mock("../whatsapp/client", () => ({ sendTextMessage: vi.fn(), fetchTemplates: vi.fn(), sendTemplateMessage: vi.fn() }));
vi.mock("../whatsapp/store", () => ({}));
vi.mock("../whatsapp/service", () => ({ ingestWebhook: vi.fn(), isWithinServiceWindow: vi.fn() }));
vi.mock("../adminAudit", () => ({ recordAdminAudit: async () => {} }));

// ---------------------------------------------------------------------------
// SEC-XFF (rate-limit half): which address Express believes.
// ---------------------------------------------------------------------------
describe("SEC-XFF: X-Forwarded-For is believed only from a loopback proxy", () => {
  const saved = process.env.TRUST_PROXY;
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved;
  });

  async function clientIp(remoteAddress: string, xff: string): Promise<string> {
    const { trustProxySetting } = await import("../lib/trustProxy");
    const app = express();
    app.set("trust proxy", trustProxySetting());
    const fn = app.get("trust proxy fn");
    const req = { socket: { remoteAddress }, connection: { remoteAddress }, headers: { "x-forwarded-for": xff } };
    return proxyaddr(req as any, fn);
  }

  it("a direct caller cannot choose its own address (rate limits, localhost checks)", async () => {
    delete process.env.TRUST_PROXY;
    expect(await clientIp("192.0.2.2", "127.0.0.1")).toBe("192.0.2.2");
    expect(await clientIp("192.0.2.2", "198.51.100.7")).toBe("192.0.2.2");
  });

  it("nginx on the same box is still believed, and only its own appended hop", async () => {
    delete process.env.TRUST_PROXY;
    // Caller forged "127.0.0.1"; nginx appended the real peer 203.0.113.9.
    expect(await clientIp("127.0.0.1", "127.0.0.1, 203.0.113.9")).toBe("203.0.113.9");
  });

  it("TRUST_PROXY overrides it for a proxy on another host", async () => {
    process.env.TRUST_PROXY = "1";
    expect(await clientIp("10.0.0.5", "203.0.113.9")).toBe("203.0.113.9");
  });
});

// ---------------------------------------------------------------------------
// SEC-CSRF-FORM / SEC-BODY-PREAUTH: the body parser and the cross-site check.
// ---------------------------------------------------------------------------
describe("SEC-CSRF-FORM and SEC-BODY-PREAUTH: what the API parses, and from whom", () => {
  async function appWith() {
    const { createJsonBodyParser, rejectCrossSiteMutations } = await import("../security");
    const app = express();
    app.use(createJsonBodyParser("/arcarna"));
    const sub = express();
    sub.use(rejectCrossSiteMutations);
    sub.post("/api/customers", (req, res) => res.json({ body: req.body ?? null }));
    sub.post("/api/customers/import/preview-rows", (req, res) => res.json({ n: Array.isArray(req.body?.rows) ? req.body.rows.length : -1 }));
    app.use("/arcarna", sub);
    return app;
  }

  it("a form-encoded body is never parsed into fields", async () => {
    const app = await appWith();
    const res = await request(app)
      .post("/arcarna/api/customers")
      .set("content-type", "application/x-www-form-urlencoded")
      .send("name=CSRF+Form+Customer");
    expect(res.body.body?.name).toBeUndefined();
  });

  it("a cross-site browser post is refused (Origin, and Sec-Fetch-Site from a same-site sibling)", async () => {
    const app = await appWith();
    const evil = await request(app)
      .post("/arcarna/api/customers")
      .set("origin", "https://evil.example.invalid")
      .send({ name: "x" });
    expect(evil.status).toBe(403);
    const sibling = await request(app)
      .post("/arcarna/api/customers")
      .set("sec-fetch-site", "same-site")
      .send({ name: "x" });
    expect(sibling.status).toBe(403);
    const opaque = await request(app).post("/arcarna/api/customers").set("origin", "null").send({ name: "x" });
    expect(opaque.status).toBe(403);
  });

  it("the app's own page, and a caller with no browser headers, still get through", async () => {
    const app = await appWith();
    const same = await request(app)
      .post("/arcarna/api/customers")
      .set("host", "shop.example.invalid")
      .set("origin", "https://shop.example.invalid")
      .set("sec-fetch-site", "same-origin")
      .send({ name: "ok" });
    expect(same.status).toBe(200);
    expect(same.body.body).toEqual({ name: "ok" });
    const server = await request(app).post("/arcarna/api/customers").send({ name: "hook" });
    expect(server.status).toBe(200);
  });

  it("only the import and bulk routes take a large body; others refuse it before any handler", async () => {
    const app = await appWith();
    const big = JSON.stringify({ rows: Array.from({ length: 40_000 }, (_, i) => ({ name: `Row ${i} ${"x".repeat(60)}` })) });
    expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
    const refused = await request(app).post("/arcarna/api/customers").set("content-type", "application/json").send(big);
    expect(refused.status).toBe(413);
    const imported = await request(app)
      .post("/arcarna/api/customers/import/preview-rows")
      .set("content-type", "application/json")
      .send(big);
    expect(imported.status).toBe(200);
    expect(imported.body.n).toBe(40_000);
  });
});

// ---------------------------------------------------------------------------
// SEC-XSS-PREVIEW / SEC-CSP-HEADERS: every /api response is script-free.
// ---------------------------------------------------------------------------
describe("SEC-CSP-HEADERS: API responses carry a no-script policy", () => {
  it("sets a CSP with default-src 'none' and nosniff on /api, and leaves pages alone", async () => {
    const { apiResponseHardening } = await import("../security");
    const app = express();
    app.use(apiResponseHardening);
    app.get("/api/receipts/preview", (_req, res) => res.type("html").send("<script>1</script>"));
    app.get("/pos", (_req, res) => res.type("html").send("<div id=root></div>"));
    const api = await request(app).get("/api/receipts/preview");
    expect(api.headers["content-security-policy"]).toMatch(/default-src 'none'/);
    expect(api.headers["content-security-policy"]).not.toMatch(/script-src/);
    expect(api.headers["x-content-type-options"]).toBe("nosniff");
    const page = await request(app).get("/pos");
    expect(page.headers["content-security-policy"]).toBeUndefined();
  });

  it("production pages get the non-breaking directives", async () => {
    const { applySecurityMiddleware } = await import("../security");
    const app = express();
    applySecurityMiddleware(app, true);
    app.get("/pos", (_req, res) => res.type("html").send("<div id=root></div>"));
    const page = await request(app).get("/pos");
    expect(page.headers["content-security-policy"]).toMatch(/object-src 'none'/);
    expect(page.headers["content-security-policy"]).toMatch(/frame-ancestors 'self'/);
    expect(page.headers["strict-transport-security"]).toMatch(/max-age=/);
  });
});

// ---------------------------------------------------------------------------
// SEC-500-NONUUID: a malformed id never reaches Postgres.
// ---------------------------------------------------------------------------
describe("SEC-500-NONUUID: malformed ids are a 404 before the handler", () => {
  it("refuses a non-UUID on the listed routes, passes UUIDs, literal siblings and other routes", async () => {
    const { registerUuidParamGuards } = await import("../lib/uuidParams");
    const app = express();
    registerUuidParamGuards(app as any);
    const hit = vi.fn();
    app.get("/api/orders/board", (_req, res) => res.json({ board: true }));
    app.get("/api/customers/:id", (req, res) => {
      hit(req.params.id);
      res.json({ id: req.params.id });
    });
    app.get("/api/cashier-shifts/current/:cashierId", (req, res) => res.json({ id: req.params.cashierId }));
    app.get("/api/loyalty-tiers/:id", (req, res) => res.json({ id: req.params.id }));
    app.get("/api/orders/:id", (req, res) => res.json({ id: req.params.id }));

    expect((await request(app).get("/api/customers/not-a-uuid")).status).toBe(404);
    expect((await request(app).get("/api/cashier-shifts/current/not-a-uuid")).status).toBe(404);
    expect(hit).not.toHaveBeenCalled();
    const good = "00000000-0000-4000-8000-000000000001";
    expect((await request(app).get(`/api/customers/${good}`)).body.id).toBe(good);
    expect((await request(app).get("/api/orders/board")).body.board).toBe(true);
    expect((await request(app).get("/api/loyalty-tiers/7")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// SEC-WA-CHALLENGE-HTML: the verification echo is plain text.
// ---------------------------------------------------------------------------
describe("SEC-WA-CHALLENGE-HTML: the webhook challenge is echoed as text/plain", () => {
  it("never serves the caller's challenge as HTML", async () => {
    const { registerWhatsappPublicRoutes } = await import("../routes/whatsapp");
    const app = express();
    registerWhatsappPublicRoutes(app);
    const res = await request(app).get("/api/whatsapp/webhook").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "vt_sectest",
      "hub.challenge": "<script>alert(1)</script>",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
  });
});

// ---------------------------------------------------------------------------
// SEC-REPLIT-STALE-ROLE: the legacy Replit session re-reads role and org.
// ---------------------------------------------------------------------------
describe("SEC-REPLIT-STALE-ROLE: a demotion takes effect on the next request", () => {
  beforeEach(() => {
    roleRows.current = null;
  });

  it("replaces the role copied at login with the current one", async () => {
    const { refreshSessionAccess } = await import("../replitAuth");
    const sessionUser: any = { claims: { sub: "cashier-02" }, role: "MANAGER", orgId: "org-a", isOwner: false };
    roleRows.current = { role: "CASHIER", orgId: "org-a" };
    expect(await refreshSessionAccess(sessionUser)).toBe(true);
    expect(sessionUser.role).toBe("CASHIER");
  });

  it("a removed person loses access instead of keeping the old role", async () => {
    const { refreshSessionAccess } = await import("../replitAuth");
    const sessionUser: any = { claims: { sub: "gone" }, role: "ADMIN", orgId: "org-a", isOwner: false };
    roleRows.current = null;
    expect(await refreshSessionAccess(sessionUser)).toBe(false);
    expect(sessionUser.isAllowed).toBe(false);
  });
});
