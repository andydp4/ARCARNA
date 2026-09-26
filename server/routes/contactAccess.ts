import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import {
  ACCESS_ACTIONS,
  ACCESS_HISTORY_MIN_ROLE,
  ACCESS_LOG_ORG_ROLE,
  CONTACT_APPROVE_MIN_ROLE,
  CONTACT_FIELDS_REQUESTABLE,
  MESSAGE_CUSTOMER_MIN_ROLE,
  contactRequestSchema,
  customerMessageSchema,
} from "@shared/contactAccess";
import {
  ContactAccessError,
  closeGrant,
  contactAccessState,
  createContactRequest,
  decideContactRequest,
  listContactRequests,
  recentOrdersFor,
  revealContactField,
} from "../services/contactRequests";
import { accessActor, customerAccessHistory, orgAccessLog } from "../services/customerAccessLog";
import { messagingOptions, sendCustomerMessage } from "../services/customerMessaging";

/**
 * Contact-details requests, 24-hour access and the customer data access log
 * (v1.2 Phase 6, PRV-09/10/11). The rules are in shared/contactAccess.ts and
 * the services; every route here has an ACCESS_POLICY row.
 *
 *  - A manager asks (reason, note, fields, optional order); admins and the
 *    owner approve or decline, in Needs a look or from the Signal.
 *  - Inside the grant each field is revealed by a tap, logged first; never
 *    cached. Admins revoke, the manager can end it early.
 *  - "Message the customer instead": an approved WhatsApp template sent by the
 *    server to the number on file.
 *  - Access history per customer (admins) and the org-wide log (owner).
 */
export function registerContactAccessRoutes(app: Express, scoped: RequestHandler[]): void {
  const managers = requireRole(...rolesAtLeast("MANAGER"));
  const approvers = requireRole(...rolesAtLeast(CONTACT_APPROVE_MIN_ROLE));
  const viewerOf = (req: any) => ({
    userId: String(req.user?.id ?? ""),
    role: String(req.orgContext?.role ?? req.user?.role ?? ""),
  });
  const whereOf = (req: any) => {
    const a = accessActor(req);
    return { ipAddress: a.ipAddress, userAgent: a.userAgent };
  };
  const noStore = (res: any) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
  };
  const uuid = z.string().uuid();
  const fail = (res: any, error: unknown, what: string) => {
    if (error instanceof ContactAccessError) return res.status(error.status).json({ message: error.message, code: error.code });
    console.error(`[ContactAccess] ${what}:`, error);
    return res.status(500).json({ message: `Failed to ${what}` });
  };

  /** The contact panel: grant, waiting request, and which messages can go. */
  app.get("/api/customers/:id/contact-access", ...scoped, managers, async (req: any, res) => {
    noStore(res);
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ message: "Customer not found" });
    try {
      const orgId = req.orgContext.orgId as string;
      const [state, messaging, recentOrders] = await Promise.all([
        contactAccessState(orgId, req.params.id, viewerOf(req)),
        messagingOptions(orgId),
        recentOrdersFor(orgId, req.params.id),
      ]);
      res.json({ ...state, messaging, recentOrders, serverNow: new Date().toISOString() });
    } catch (error) {
      fail(res, error, "load contact access");
    }
  });

  app.post("/api/customers/:id/contact-requests", ...scoped, managers, async (req: any, res) => {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ message: "Customer not found" });
    const parsed = contactRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Check the request.", errors: parsed.error.errors });
    }
    try {
      const row = await createContactRequest({
        orgId: req.orgContext.orgId,
        customerId: req.params.id,
        viewer: viewerOf(req),
        input: parsed.data,
        where: whereOf(req),
      });
      res.status(201).json({ id: row.id, status: row.status, expiresAt: row.expiresAt });
    } catch (error) {
      fail(res, error, "send the request");
    }
  });

  app.get("/api/contact-requests", ...scoped, managers, async (req: any, res) => {
    noStore(res);
    try {
      res.json(await listContactRequests(req.orgContext.orgId, viewerOf(req)));
    } catch (error) {
      fail(res, error, "load requests");
    }
  });

  const decision = z.object({ note: z.string().max(1000).optional().nullable() });
  for (const [path, approve] of [
    ["approve", true],
    ["decline", false],
  ] as const) {
    app.post(`/api/contact-requests/:id/${path}`, ...scoped, approvers, async (req: any, res) => {
      if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ message: "Request not found" });
      const parsed = decision.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "The note is too long." });
      try {
        const row = await decideContactRequest({
          orgId: req.orgContext.orgId,
          id: req.params.id,
          viewer: viewerOf(req),
          approve,
          note: parsed.data.note ?? null,
          where: whereOf(req),
        });
        res.json({ id: row.id, status: row.status, grantExpiresAt: row.grantExpiresAt });
      } catch (error) {
        fail(res, error, approve ? "approve" : "decline");
      }
    });
  }

  app.post("/api/contact-requests/:id/revoke", ...scoped, approvers, async (req: any, res) => {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ message: "Request not found" });
    try {
      const row = await closeGrant({ orgId: req.orgContext.orgId, id: req.params.id, viewer: viewerOf(req), how: "revoke", where: whereOf(req) });
      res.json({ id: row.id, status: row.status });
    } catch (error) {
      fail(res, error, "revoke access");
    }
  });

  app.post("/api/contact-requests/:id/end", ...scoped, managers, async (req: any, res) => {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ message: "Request not found" });
    try {
      const row = await closeGrant({ orgId: req.orgContext.orgId, id: req.params.id, viewer: viewerOf(req), how: "end", where: whereOf(req) });
      res.json({ id: row.id, status: row.status });
    } catch (error) {
      fail(res, error, "end access");
    }
  });

  /** Click-to-reveal: one field, logged first, never stored by anything on the way. */
  app.post("/api/customers/:id/reveal", ...scoped, managers, async (req: any, res) => {
    noStore(res);
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ message: "Customer not found" });
    const parsed = z.object({ field: z.enum(CONTACT_FIELDS_REQUESTABLE) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Say which detail: phone, email or address." });
    try {
      const out = await revealContactField({
        orgId: req.orgContext.orgId,
        customerId: req.params.id,
        field: parsed.data.field,
        viewer: viewerOf(req),
        where: whereOf(req),
      });
      res.json({ field: parsed.data.field, value: out.value, grantExpiresAt: out.grantExpiresAt });
    } catch (error) {
      fail(res, error, "show the detail");
    }
  });

  /** "Message the customer instead": the server sends an approved template; nobody sees the number. */
  app.post("/api/customers/:id/message", ...scoped, requireRole(...rolesAtLeast(MESSAGE_CUSTOMER_MIN_ROLE)), async (req: any, res) => {
    noStore(res);
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ message: "Customer not found" });
    const parsed = customerMessageSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Pick a message to send." });
    try {
      res.json(
        await sendCustomerMessage({
          orgId: req.orgContext.orgId,
          customerId: req.params.id,
          message: parsed.data.message,
          orderId: parsed.data.orderId ?? null,
          sender: viewerOf(req),
          where: whereOf(req),
        }),
      );
    } catch (error) {
      fail(res, error, "send the message");
    }
  });

  /** Whether WhatsApp and email are set up, for the buttons that use them. */
  app.get("/api/messaging/status", ...scoped, managers, async (req: any, res) => {
    try {
      res.json(await messagingOptions(req.orgContext.orgId));
    } catch (error) {
      fail(res, error, "load messaging status");
    }
  });

  /** One customer's Access history (admins, PRV-10). */
  app.get("/api/customers/:id/access-history", ...scoped, requireRole(...rolesAtLeast(ACCESS_HISTORY_MIN_ROLE)), async (req: any, res) => {
    noStore(res);
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ message: "Customer not found" });
    try {
      res.json(await customerAccessHistory(req.orgContext.orgId, req.params.id));
    } catch (error) {
      fail(res, error, "load the access history");
    }
  });

  /** The org-wide customer data access log: the owner's page (Q13a). */
  app.get("/api/customer-access-log", ...scoped, requireRole(ACCESS_LOG_ORG_ROLE), async (req: any, res) => {
    noStore(res);
    const q = req.query ?? {};
    const action = typeof q.action === "string" && (ACCESS_ACTIONS as readonly string[]).includes(q.action) ? q.action : null;
    const days = Math.min(Math.max(parseInt(String(q.days ?? "30"), 10) || 30, 1), 366);
    try {
      res.json(
        await orgAccessLog(req.orgContext.orgId, {
          action,
          actorUserId: typeof q.actor === "string" && q.actor ? q.actor : null,
          from: new Date(Date.now() - days * 86_400_000),
          limit: 500,
        }),
      );
    } catch (error) {
      fail(res, error, "load the access log");
    }
  });
}
