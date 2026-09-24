/**
 * Contact-details requests, 24-hour access and the customer data access log
 * (v1.2 Phase 6, PRV-09/10/11), against the real route table and a real
 * database. The brief's checks:
 *   1. a manager requests with a reason and an admin approves;
 *   2. the manager reveals the phone, and the log shows the reveal;
 *   3. after a revoke, or after 24 hours, the reveal is gone;
 *   4. "Message customer" goes without the manager seeing the number.
 * WhatsApp's Graph API is faked; everything else is real.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml). It
 * mocks ../db without a database, so the no-DB run loads it and skips.
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

const wa = vi.hoisted(() => ({ enabled: false, sent: [] as Array<{ to: string; name: string; params: string[] }> }));
vi.mock("../whatsapp/config", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return {
    ...real,
    getWhatsappConfig: () => ({ enabled: wa.enabled, accessToken: "t", phoneNumberId: "p" }),
    canSendWhatsapp: () => wa.enabled,
  };
});
vi.mock("../whatsapp/client", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return {
    ...real,
    sendTemplateMessage: async (to: string, name: string, _lang: string, params: string[]) => {
      wa.sent.push({ to, name, params });
      return { ok: true, messageId: "wamid.test" };
    },
  };
});

vi.mock("../auth", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  const fakeAuth = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ message: "Unauthorized" });
    const id = String(req.headers["x-test-user"] ?? `contact-${String(role).toLowerCase()}`);
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

describe.skipIf(!hasDb)("contact-details requests and the access log (database)", () => {
  let app: express.Express;
  let db: any;
  let s: typeof import("@shared/schema");
  const orgId = randomUUID();
  const MANAGER = "contact-manager";
  const OTHER_MANAGER = "contact-manager-2";
  const ADMIN = "contact-admin";
  const OWNER = "contact-owner";
  const ids = { jane: "", bob: "", janeOrder: "", bobOrder: "" };
  const note = "Customer rang about a refund on the phone";

  function as(role: string, user: string) {
    const agent = (method: "get" | "post", url: string) =>
      request(app)[method](url).set("x-test-role", role).set("x-test-org", orgId).set("x-org-id", orgId).set("x-test-user", user);
    return {
      get: (url: string) => agent("get", url),
      post: (url: string, body: unknown = {}) => agent("post", url).send(body as object),
    };
  }
  const manager = () => as("MANAGER", MANAGER);
  const admin = () => as("ADMIN", ADMIN);
  const ask = (customerId: string, body: Record<string, unknown> = {}, who = manager()) =>
    who.post(`/api/customers/${customerId}/contact-requests`, { reason: "refund_return", note, fields: ["phone"], ...body });

  async function logRows(action: string, customerId?: string) {
    const { and, eq } = await import("drizzle-orm");
    return db
      .select()
      .from(s.customerAccessLog)
      .where(
        and(
          eq(s.customerAccessLog.orgId, orgId),
          eq(s.customerAccessLog.action, action),
          customerId ? eq(s.customerAccessLog.customerId, customerId) : undefined,
        ),
      );
  }

  beforeAll(async () => {
    ({ db } = await import("../db"));
    s = await import("@shared/schema");
    await db.insert(s.organizations).values({ id: orgId, name: "ZZ Contact Access Org", phone: "020 7946 0018" });
    const [jane] = await db
      .insert(s.customers)
      .values({ orgId, name: "Jane Smith", phone: "07700 904821", email: "jane.smith@gmail.com", address: "9 Saved Street" })
      .returning();
    const [bob] = await db.insert(s.customers).values({ orgId, name: "Bob Jones", phone: "07700 900555" }).returning();
    ids.jane = jane.id;
    ids.bob = bob.id;
    [{ id: ids.janeOrder }] = await db.insert(s.orders).values({ orgId, customerId: jane.id, total: "10.00", paymentMethod: "cash", status: "completed" }).returning();
    [{ id: ids.bobOrder }] = await db.insert(s.orders).values({ orgId, customerId: bob.id, total: "10.00", paymentMethod: "cash", status: "completed" }).returning();
    const { registerRoutes } = await import("../routes");
    app = express();
    app.use(express.json());
    await registerRoutes(app as any);
  });

  afterAll(async () => {
    if (!db) return;
    const { eq, inArray } = await import("drizzle-orm");
    try {
      const notes = await db.select({ id: s.orgNotifications.id }).from(s.orgNotifications).where(eq(s.orgNotifications.orgId, orgId));
      if (notes.length) await db.delete(s.orgNotificationRecipients).where(inArray(s.orgNotificationRecipients.notificationId, notes.map((n: any) => n.id)));
    } catch (e) {
      console.warn("[contactAccess] cleanup", (e as Error).message);
    }
    for (const table of [
      s.customerAccessLog,
      s.contactRequests,
      s.orgNotifications,
      s.whatsappMessages,
      s.whatsappConversations,
      s.whatsappAccounts,
      s.whatsappTemplates,
      s.adminAuditLogs,
      s.orders,
      s.customers,
    ] as any[]) {
      try {
        await db.delete(table).where(eq(table.orgId, orgId));
      } catch (e) {
        console.warn("[contactAccess] cleanup", (e as Error).message);
      }
    }
    await db.delete(s.organizations).where(eq(s.organizations.id, orgId)).catch(() => {});
  });

  it("a request needs a reason, a 15-character note and the fields; only managers ask", async () => {
    expect((await ask(ids.jane, { note: "too short" })).status).toBe(400);
    expect((await ask(ids.jane, { reason: "nosy" })).status).toBe(400);
    expect((await ask(ids.jane, { fields: [] })).status).toBe(400);
    expect((await ask(ids.jane, { orderId: ids.bobOrder })).body.code).toBe("ORDER_NOT_THEIRS");
    expect((await ask(ids.jane, {}, as("CASHIER", "contact-cashier"))).status).toBe(403);
    expect((await ask(ids.jane, {}, admin())).body.code).toBe("NOT_NEEDED");
  });

  it("check 1: a manager requests with a reason; one pending per customer per manager; admins get the Signal", async () => {
    const { and, eq } = await import("drizzle-orm");
    const res = await ask(ids.jane, { orderId: ids.janeOrder });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(47.9 * 3_600_000);
    expect((await ask(ids.jane)).body.code).toBe("ALREADY_PENDING");
    // Another manager may ask about the same customer.
    expect((await ask(ids.jane, {}, as("MANAGER", OTHER_MANAGER))).status).toBe(201);
    const [signal] = await db
      .select()
      .from(s.orgNotifications)
      .where(and(eq(s.orgNotifications.orgId, orgId), eq(s.orgNotifications.source, "contact_request")));
    expect(signal.audience).toMatchObject({ minRole: "ADMIN", subjectRole: null });
    expect(signal.subjectUserId).toBe(MANAGER);
    expect(signal.message).toContain("Jane Smith");
    expect(signal.message).not.toContain("904821");
    expect(await logRows("request", ids.jane)).toHaveLength(2);
  });

  it("the request is in Needs a look for admins, not for managers", async () => {
    const adminInbox = await admin().get("/api/needs-a-look");
    expect(adminInbox.status).toBe(200);
    const mine = (adminInbox.body.contactRequests as any[]).filter((r) => r.customerId === ids.jane);
    expect(mine.map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(JSON.stringify(adminInbox.body.contactRequests)).not.toContain("904821");
    const managerInbox = await manager().get("/api/needs-a-look");
    expect(managerInbox.body.contactRequests).toEqual([]);
  });

  it("before approval there is nothing to reveal, and managers cannot approve", async () => {
    expect((await manager().post(`/api/customers/${ids.jane}/reveal`, { field: "phone" })).status).toBe(403);
    const list = await manager().get("/api/contact-requests");
    const id = (list.body as any[]).find((r) => r.customerId === ids.jane).id;
    expect((await as("MANAGER", OTHER_MANAGER).post(`/api/contact-requests/${id}/approve`)).status).toBe(403);
  });

  it("no self-grant: an admin cannot approve a request in their own name (Q9)", async () => {
    const { pendingExpiryFrom } = await import("@shared/contactAccess");
    const [row] = await db
      .insert(s.contactRequests)
      .values({
        orgId,
        customerId: ids.bob,
        requesterUserId: ADMIN,
        requesterRole: "MANAGER",
        reasonCode: "other",
        note: "Written straight into the table",
        fields: ["phone"],
        expiresAt: pendingExpiryFrom(new Date()),
      })
      .returning();
    const res = await admin().post(`/api/contact-requests/${row.id}/approve`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SELF_GRANT");
    await admin().post(`/api/contact-requests/${row.id}/decline`, {}); // still self: refused too
    const { eq } = await import("drizzle-orm");
    await db.delete(s.contactRequests).where(eq(s.contactRequests.id, row.id));
  });

  let grantId = "";

  it("check 1 (cont.): an admin approves; the manager has 24 hours and is told", async () => {
    const list = await manager().get("/api/contact-requests");
    grantId = (list.body as any[]).find((r) => r.customerId === ids.jane).id;
    const res = await admin().post(`/api/contact-requests/${grantId}/approve`, { note: "Go ahead" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    const hoursLeft = (new Date(res.body.grantExpiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);
    expect((await admin().post(`/api/contact-requests/${grantId}/approve`)).body.code).toBe("REQUEST_DECIDED");
    const state = await manager().get(`/api/customers/${ids.jane}/contact-access`);
    expect(state.body.grant).toMatchObject({ id: grantId, fields: ["phone"] });
    expect(state.headers["cache-control"]).toContain("no-store");
    expect(JSON.stringify(state.body)).not.toContain("904821");
    expect(await logRows("request_approved", ids.jane)).toHaveLength(1);
    const { and, eq } = await import("drizzle-orm");
    const [told] = await db
      .select()
      .from(s.orgNotifications)
      .where(and(eq(s.orgNotifications.orgId, orgId), eq(s.orgNotifications.source, "contact_request_decided")));
    expect(told.audience).toMatchObject({ userIds: [MANAGER] });
  });

  it("check 2: the manager reveals the phone, and the log shows the reveal", async () => {
    const res = await manager().post(`/api/customers/${ids.jane}/reveal`, { field: "phone" });
    expect(res.status).toBe(200);
    expect(res.body.value).toBe("07700 904821");
    expect(res.headers["cache-control"]).toContain("no-store");
    const rows = await logRows("reveal", ids.jane);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: MANAGER, field: "phone", requestId: grantId });
    // Only the fields asked for, only the manager who asked.
    expect((await manager().post(`/api/customers/${ids.jane}/reveal`, { field: "email" })).status).toBe(403);
    expect((await as("MANAGER", OTHER_MANAGER).post(`/api/customers/${ids.jane}/reveal`, { field: "phone" })).status).toBe(403);
    expect((await manager().post(`/api/customers/${ids.bob}/reveal`, { field: "phone" })).status).toBe(403);
    // The customer read itself is unchanged inside the grant: masks only.
    const read = await manager().get(`/api/customers/${ids.jane}`);
    expect(read.body).not.toHaveProperty("phone");
  });

  it("if the log cannot be written, the reveal fails and nothing is sent", async () => {
    const insert = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("log is down");
    });
    const res = await manager().post(`/api/customers/${ids.jane}/reveal`, { field: "phone" });
    insert.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("LOG_FAILED");
    expect(JSON.stringify(res.body)).not.toContain("904821");
    expect(await logRows("reveal", ids.jane)).toHaveLength(1);
  });

  it("admins see the per-customer Access history; the org-wide page is the owner's", async () => {
    const history = await admin().get(`/api/customers/${ids.jane}/access-history`);
    expect(history.status).toBe(200);
    const actions = (history.body as any[]).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["request", "request_approved", "reveal"]));
    expect((await manager().get(`/api/customers/${ids.jane}/access-history`)).status).toBe(403);
    expect((await admin().get("/api/customer-access-log")).status).toBe(403);
    const org = await as("SUPER_ADMIN", OWNER).get("/api/customer-access-log?action=reveal");
    expect(org.status).toBe(200);
    expect((org.body as any[]).every((r) => r.action === "reveal")).toBe(true);
    expect((org.body as any[]).length).toBeGreaterThan(0);
  });

  it("check 3: after an admin revokes, the reveal is gone", async () => {
    const res = await admin().post(`/api/contact-requests/${grantId}/revoke`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("revoked");
    expect((await manager().post(`/api/customers/${ids.jane}/reveal`, { field: "phone" })).status).toBe(403);
    expect((await manager().get(`/api/customers/${ids.jane}/contact-access`)).body.grant).toBeNull();
    expect(await logRows("grant_revoked", ids.jane)).toHaveLength(1);
  });

  it("the manager can end a grant early; another manager cannot", async () => {
    const other = as("MANAGER", OTHER_MANAGER);
    const list = await other.get("/api/contact-requests");
    const id = (list.body as any[]).find((r) => r.customerId === ids.jane && r.status === "pending").id;
    expect((await admin().post(`/api/contact-requests/${id}/approve`)).status).toBe(200);
    expect((await other.post(`/api/customers/${ids.jane}/reveal`, { field: "phone" })).status).toBe(200);
    expect((await manager().post(`/api/contact-requests/${id}/end`)).status).toBe(404);
    expect((await other.post(`/api/contact-requests/${id}/end`)).status).toBe(200);
    expect((await other.post(`/api/customers/${ids.jane}/reveal`, { field: "phone" })).status).toBe(403);
    expect(await logRows("grant_ended", ids.jane)).toHaveLength(1);
  });

  it("check 3 (cont.): after 24 hours the reveal is gone; a pending request lapses after 48", async () => {
    const { createContactRequest, decideContactRequest } = await import("../services/contactRequests");
    const viewer = { userId: MANAGER, role: "MANAGER" };
    const then = new Date(Date.now() - 25 * 3_600_000);
    const row = await createContactRequest({ orgId, customerId: ids.bob, viewer, input: { reason: "debt_chase", note, fields: ["phone"] }, now: then });
    await decideContactRequest({ orgId, id: row.id, viewer: { userId: ADMIN, role: "ADMIN" }, approve: true, now: then });
    expect((await manager().post(`/api/customers/${ids.bob}/reveal`, { field: "phone" })).status).toBe(403);
    expect((await manager().get(`/api/customers/${ids.bob}/contact-access`)).body.grant).toBeNull();

    const old = await createContactRequest({
      orgId,
      customerId: ids.jane,
      viewer,
      input: { reason: "debt_chase", note, fields: ["phone"] },
      now: new Date(Date.now() - 49 * 3_600_000),
    });
    const late = await admin().post(`/api/contact-requests/${old.id}/approve`);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("REQUEST_EXPIRED");
    // It no longer blocks a fresh request.
    expect((await ask(ids.jane)).status).toBe(201);
  });

  it("check 4: Message customer is refused while WhatsApp or the template is not ready", async () => {
    wa.enabled = false;
    const off = await manager().post(`/api/customers/${ids.jane}/message`, { message: "please_call_us" });
    expect(off.status).toBe(409);
    wa.enabled = true;
    const store = await import("../whatsapp/store");
    await store.seedDefaultTemplates(orgId);
    const local = await manager().post(`/api/customers/${ids.jane}/message`, { message: "please_call_us" });
    expect(local.status).toBe(422);
    expect(local.body.code).toBe("TEMPLATE_NOT_APPROVED");
    const status = await manager().get("/api/messaging/status");
    expect((status.body.messages as any[]).find((m) => m.message === "please_call_us")).toMatchObject({ available: false });
    expect(wa.sent).toEqual([]);
  });

  it("check 4 (cont.): an approved template goes to the number on file; the manager never sees it; it is logged", async () => {
    const { and, eq } = await import("drizzle-orm");
    await db
      .update(s.whatsappTemplates)
      .set({ status: "APPROVED" })
      .where(and(eq(s.whatsappTemplates.orgId, orgId), eq(s.whatsappTemplates.templateName, "please_call_us")));
    const res = await manager().post(`/api/customers/${ids.jane}/message`, { message: "please_call_us" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true, message: "please_call_us" });
    expect(JSON.stringify(res.body)).not.toContain("904821");
    expect(wa.sent).toEqual([{ to: "447700904821", name: "please_call_us", params: ["Jane", "020 7946 0018", "ZZ Contact Access Org"] }]);
    const rows = await logRows("message_sent", ids.jane);
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ template: "please_call_us", outcome: "sent" });
    expect(JSON.stringify(rows[0].metadata)).not.toContain("904821");
    // Cashiers do not send them.
    expect((await as("CASHIER", "contact-cashier").post(`/api/customers/${ids.jane}/message`, { message: "please_call_us" })).status).toBe(403);
  });

  it("Email invoice is refused with the reason when email is not set up", async () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const res = await manager().post(`/api/invoices/${randomUUID()}/email`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EMAIL_NOT_SET_UP");
    const status = await manager().get("/api/messaging/status");
    expect(status.body).toMatchObject({ email: false });
    expect(status.body.emailReason).toContain("not set up");
    if (saved !== undefined) process.env.RESEND_API_KEY = saved;
  });

  it("the driver's call and Replace number write to the same log", async () => {
    const res = await manager().post(`/api/customers/${ids.bob}/replace-phone`, { phone: "07700 900556" });
    expect(res.status).toBe(200);
    const rows = await logRows("phone_replaced", ids.bob);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].metadata)).not.toContain("900556\"");
  });

  it("an API key reading contact details is logged per customer", async () => {
    const { storage } = await import("../storage");
    const plain = await storage.createApiKeyForOrg(orgId, "contact-plain", ["customers:read"]);
    const contact = await storage.createApiKeyForOrg(orgId, "contact-full", ["customers:read", "customers:read_contact"]);
    const read = (key: string) => request(app).get(`/v1/orgs/${orgId}/customers/${ids.jane}`).set("authorization", `Bearer ${key}`);
    const before = (await logRows("api_contact_read", ids.jane)).length;
    expect((await read(plain.plainKey)).status).toBe(200);
    expect((await logRows("api_contact_read", ids.jane)).length).toBe(before);
    expect((await read(contact.plainKey)).body.phone).toBe("07700 904821");
    const rows = await logRows("api_contact_read", ids.jane);
    expect(rows.length).toBe(before + 1);
    expect(rows[0].actorUserId).toMatch(/^api-key:/);
    const { eq } = await import("drizzle-orm");
    await db.delete(s.apiKeys).where(eq(s.apiKeys.orgId, orgId));
  });

  it("the owner gets one weekly line on Monday morning", async () => {
    const { runWeeklyCustomerAccessLine } = await import("../services/customerAccessLog");
    const now = new Date();
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ((8 - now.getUTCDay()) % 7 || 7), 10, 0, 0));
    expect(await runWeeklyCustomerAccessLine(monday)).toBeGreaterThan(0);
    const { and, eq } = await import("drizzle-orm");
    const lines = await db
      .select()
      .from(s.orgNotifications)
      .where(and(eq(s.orgNotifications.orgId, orgId), eq(s.orgNotifications.source, "customer_access_weekly")));
    expect(lines).toHaveLength(1);
    expect(lines[0].audience).toMatchObject({ roles: ["SUPER_ADMIN"] });
    expect(lines[0].message).toMatch(/^Customer data last week: \d+ requests/);
    await runWeeklyCustomerAccessLine(monday);
    const again = await db
      .select()
      .from(s.orgNotifications)
      .where(and(eq(s.orgNotifications.orgId, orgId), eq(s.orgNotifications.source, "customer_access_weekly")));
    expect(again).toHaveLength(1);
  });
});
