/**
 * PRV-14: a MARKETING WhatsApp template (or one of unknown category) is
 * refused until the customer's marketing consent is recorded — and nothing
 * records it yet. A UTILITY template still sends. The route's collaborators
 * (config, store, Graph client) are faked; what is under test is the route's
 * decision, before anything reaches WhatsApp.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ templates: [] as string[] }));
const templates = vi.hoisted(() => ({
  order_ready: { templateName: "order_ready", category: "UTILITY", status: "LOCAL", body: "Ready", language: "en_GB" },
  thanks_follow_up: { templateName: "thanks_follow_up", category: "MARKETING", status: "APPROVED", body: "Thanks", language: "en_GB" },
  mystery: { templateName: "mystery", category: null, status: "APPROVED", body: "?", language: "en_GB" },
}));

vi.mock("../whatsapp/config", () => ({
  getWhatsappConfig: () => ({ enabled: true }),
  canSendWhatsapp: () => true,
}));
vi.mock("../whatsapp/client", () => ({
  sendTextMessage: vi.fn(),
  fetchTemplates: vi.fn(),
  sendTemplateMessage: async (_waId: string, name: string) => {
    sent.templates.push(name);
    return { ok: true, messageId: "wamid.test" };
  },
}));
vi.mock("../whatsapp/store", () => ({
  getConversation: async () => ({ id: "conv-1", waId: "447700900123", customerId: null, lastInboundAt: null }),
  getTemplate: async (_org: string, name: string) => (templates as Record<string, unknown>)[name] ?? null,
  getPrimaryAccount: async () => null,
  recordOutboundStatus: async () => {},
  insertOutboundMessage: async (m: unknown) => m,
}));
vi.mock("../adminAudit", () => ({ recordAdminAudit: async () => {} }));

const { registerWhatsappRoutes } = await import("../routes/whatsapp");

describe("WhatsApp marketing templates need recorded consent", () => {
  let app: express.Express;

  beforeEach(() => {
    process.env.DEV_AUTH_BYPASS = "0";
    sent.templates = [];
    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId: "00000000-0000-4000-8000-0000000000bb", role: "MANAGER" };
      req.user = { id: "manager-1", role: "MANAGER" };
      next();
    };
    app = express();
    app.use(express.json());
    registerWhatsappRoutes(app, [scoped]);
  });

  const send = (templateName: string) =>
    request(app).post("/api/whatsapp/conversations/conv-1/send-template").send({ templateName, language: "en_GB" });

  it("refuses a marketing template and sends nothing", async () => {
    const res = await send("thanks_follow_up").expect(422);
    expect(res.body.code).toBe("marketing_consent_required");
    expect(sent.templates).toEqual([]);
  });

  it("treats an unknown template or category as marketing", async () => {
    await send("mystery").expect(422);
    await send("not_synced_anywhere").expect(422);
    expect(sent.templates).toEqual([]);
  });

  it("still sends a utility template", async () => {
    await send("order_ready").expect(201);
    expect(sent.templates).toEqual(["order_ready"]);
  });
});
