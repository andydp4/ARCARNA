/**
 * WhatsApp Business routes.
 *
 * Public (pre-auth, registered before setupAuth):
 *   GET  /api/whatsapp/webhook   — Meta verification challenge
 *   POST /api/whatsapp/webhook   — inbound messages / status updates (HMAC verified)
 *
 * Authenticated (org-scoped):
 *   GET  /api/whatsapp/status
 *   GET  /api/whatsapp/conversations
 *   GET  /api/whatsapp/conversations/:id
 *   POST /api/whatsapp/conversations/:id/read
 *   POST /api/whatsapp/conversations/:id/reply
 */
import type { Express, Request, RequestHandler } from "express";
import { requireRole } from "../auth";
import { getWhatsappConfig, canSendWhatsapp } from "../whatsapp/config";
import { verifyWebhookChallenge, verifyWebhookSignature } from "../whatsapp/verify";
import { ingestWebhook, isWithinServiceWindow } from "../whatsapp/service";
import { sendTextMessage } from "../whatsapp/client";
import * as store from "../whatsapp/store";

const OUTSIDE_WINDOW_MESSAGE =
  "This conversation is outside WhatsApp's customer service window. Use an approved template.";

/** Public webhook endpoints — must be registered BEFORE auth middleware. */
export function registerWhatsappPublicRoutes(app: Express): void {
  // GET verification handshake.
  app.get("/api/whatsapp/webhook", (req, res) => {
    const cfg = getWhatsappConfig();
    const challenge = verifyWebhookChallenge(
      req.query as Record<string, string | undefined>,
      cfg.verifyToken,
    );
    if (challenge === null) {
      return res.status(403).send("Forbidden");
    }
    res.status(200).send(challenge);
  });

  // POST inbound messages / statuses.
  app.post("/api/whatsapp/webhook", async (req, res) => {
    const cfg = getWhatsappConfig();
    const signature = req.get("x-hub-signature-256");
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

    // Always verify the signature when an app secret is configured.
    if (cfg.appSecret) {
      if (!verifyWebhookSignature(rawBody, signature, cfg.appSecret)) {
        return res.status(401).send("invalid signature");
      }
    }

    // Acknowledge fast, then process. Errors must never bubble to a non-200.
    res.status(200).send("EVENT_RECEIVED");

    if (!cfg.enabled) return;
    try {
      const summary = await ingestWebhook(req.body);
      if (summary.received > 0 || summary.statusUpdates > 0) {
        console.log("[whatsapp] webhook ingested", summary);
      }
    } catch (err) {
      console.error("[whatsapp] webhook processing failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/** Authenticated, org-scoped WhatsApp endpoints. */
export function registerWhatsappRoutes(app: Express, scoped: RequestHandler[]): void {
  const canSend = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER");

  app.get("/api/whatsapp/status", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const cfg = getWhatsappConfig();
      const account = await store.getPrimaryAccount(ctx.orgId);
      const unread = await store.totalUnread(ctx.orgId);
      res.json({
        enabled: cfg.enabled,
        canSend: canSendWhatsapp(cfg),
        unread,
        account: account
          ? {
              id: account.id,
              phoneNumber: account.phoneNumber,
              displayName: account.displayName,
              status: account.status,
              lastWebhookAt: account.lastWebhookAt,
              lastOutboundAt: account.lastOutboundAt,
              lastOutboundStatus: account.lastOutboundStatus,
            }
          : null,
      });
    } catch (error) {
      console.error("[whatsapp] status error", error);
      res.status(500).json({ message: "Failed to load WhatsApp status" });
    }
  });

  app.get("/api/whatsapp/conversations", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const conversations = await store.listConversations(ctx.orgId, { search });
      res.json(conversations);
    } catch (error) {
      console.error("[whatsapp] list conversations error", error);
      res.status(500).json({ message: "Failed to list conversations" });
    }
  });

  app.get("/api/whatsapp/conversations/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const conversation = await store.getConversation(req.params.id, ctx.orgId);
      if (!conversation) return res.status(404).json({ message: "Conversation not found" });
      const messages = await store.listMessages(req.params.id, ctx.orgId);
      res.json({
        conversation,
        messages,
        withinServiceWindow: isWithinServiceWindow(conversation.lastInboundAt),
      });
    } catch (error) {
      console.error("[whatsapp] get conversation error", error);
      res.status(500).json({ message: "Failed to load conversation" });
    }
  });

  app.post("/api/whatsapp/conversations/:id/read", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const conversation = await store.getConversation(req.params.id, ctx.orgId);
      if (!conversation) return res.status(404).json({ message: "Conversation not found" });
      await store.markConversationRead(req.params.id, ctx.orgId);
      res.json({ ok: true });
    } catch (error) {
      console.error("[whatsapp] mark read error", error);
      res.status(500).json({ message: "Failed to mark conversation read" });
    }
  });

  app.post(
    "/api/whatsapp/conversations/:id/reply",
    ...scoped,
    canSend,
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const userId = (req.user as { id?: string } | undefined)?.id;
        const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
        if (!text) {
          return res.status(400).json({ message: "Message text is required" });
        }

        const cfg = getWhatsappConfig();
        if (!canSendWhatsapp(cfg)) {
          return res
            .status(409)
            .json({ message: "WhatsApp is not enabled or is missing credentials" });
        }

        const conversation = await store.getConversation(req.params.id, ctx.orgId);
        if (!conversation) return res.status(404).json({ message: "Conversation not found" });

        // Free-form replies are only allowed inside the 24h service window.
        if (!isWithinServiceWindow(conversation.lastInboundAt)) {
          return res
            .status(422)
            .json({ message: OUTSIDE_WINDOW_MESSAGE, code: "outside_service_window" });
        }

        const result = await sendTextMessage(conversation.waId, text, cfg);
        const account = await store.getPrimaryAccount(ctx.orgId);

        if (!result.ok) {
          if (account) await store.recordOutboundStatus(account.id, "failed");
          await store.insertOutboundMessage({
            orgId: ctx.orgId,
            conversationId: conversation.id,
            body: text,
            status: "failed",
            sentByUserId: userId,
          });
          return res.status(502).json({ message: result.error ?? "Failed to send message" });
        }

        if (account) await store.recordOutboundStatus(account.id, "sent");
        const message = await store.insertOutboundMessage({
          orgId: ctx.orgId,
          conversationId: conversation.id,
          whatsappMessageId: result.messageId,
          body: text,
          status: "sent",
          sentByUserId: userId,
        });
        res.status(201).json({ message });
      } catch (error) {
        console.error("[whatsapp] reply error", error);
        res.status(500).json({ message: "Failed to send reply" });
      }
    },
  );
}
