/**
 * Card (link) routes (v1.2 Stripe links).
 *
 * Public (registered before sign-in):
 *   POST /api/stripe/webhook      Stripe's signed events. Raw body, signature
 *                                 checked with STRIPE_WEBHOOK_SECRET.
 *   GET  /api/card-links/paid     Where Stripe sends the customer after paying.
 *
 * Signed in, org-scoped (ACCESS_POLICY rows in shared/accessPolicy.ts):
 *   GET  /api/card-links/till                    is Card (link) on? (every staff role)
 *   POST /api/card-links/:orderId                make (or return) the link for a sale
 *   GET  /api/card-links/:orderId                where the link and its leg stand
 *   POST /api/card-links/:orderId/cancel         expire it at Stripe
 *   POST /api/card-links/:orderId/retender       paid another way instead
 *   POST /api/card-links/:orderId/whatsapp       send it with the approved template
 *   GET  /api/settings/stripe                    connected / not set up (managers and above)
 */
import type { Express, Request, RequestHandler } from "express";
import { z } from "zod";
import { requireRole } from "../auth";
import { rolesAtLeast, CARD_LINK_MIN_ROLE, STRIPE_SETTINGS_MIN_ROLE } from "@shared/accessPolicy";
import { CARD_LINK_RETENDER_METHODS } from "@shared/payments/cardLink";
import { APP_BASE_PATH } from "../appBase";
import { appUrlFromRequest } from "../appUrl";
import { recordAdminAudit } from "../adminAudit";
import {
  STRIPE_API_VERSION,
  STRIPE_WEBHOOK_EVENTS,
  getStripeConfig,
  isStripeConfigured,
  stripeKeyMode,
} from "../stripe/config";
import { verifyStripeSignature } from "../stripe/verify";

async function publishBoardOrder(orgId: string | null, orderId: string | null): Promise<void> {
  if (!orgId || !orderId) return;
  try {
    const { getOpsBoardOrder } = await import("../services/opsBoard");
    const { publishOpsEvent } = await import("../services/opsBus");
    const order = await getOpsBoardOrder(orgId, orderId);
    if (order) publishOpsEvent(orgId, { type: "order", order });
  } catch (error) {
    console.error("[CardLinks] board push failed:", error instanceof Error ? error.message : error);
  }
}

function sendError(res: any, error: any, fallback: string) {
  if (error?.name === "CardLinkError") {
    return res.status(error.statusCode).json({ message: error.message, code: error.code });
  }
  console.error(`[CardLinks] ${fallback}:`, error instanceof Error ? error.message : error);
  return res.status(500).json({ message: fallback });
}

const PAID_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment received</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f4;color:#1c1c1a}
main{max-width:22rem;padding:2rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .5rem}p{margin:0;color:#555}</style></head>
<body><main><h1>Thank you, payment received</h1><p>You can close this page. The shop will see your payment in a moment.</p></main></body></html>`;

/** Public endpoints: must be registered BEFORE sign-in middleware. */
export function registerCardLinkPublicRoutes(app: Express): void {
  app.post("/api/stripe/webhook", async (req: Request, res) => {
    const cfg = getStripeConfig();
    if (!isStripeConfigured(cfg)) return res.status(503).json({ message: "Card (link) is not set up" });
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const verdict = verifyStripeSignature(rawBody, req.get("stripe-signature") ?? undefined, cfg.webhookSecret);
    if (!verdict.ok) {
      // The reason only, never the header or the secret.
      console.warn(`[CardLinks] webhook refused: ${verdict.reason}`);
      return res.status(400).json({ message: "Invalid signature" });
    }
    const event = req.body as { id?: unknown; type?: unknown; data?: unknown };
    if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
      return res.status(400).json({ message: "Not a Stripe event" });
    }
    try {
      const { applyStripeEvent } = await import("../services/cardLinks");
      const result = await applyStripeEvent(event as any);
      res.status(200).json({ received: true, outcome: result.outcome });
      if (result.outcome === "paid" || result.outcome === "expired" || result.outcome === "mismatch") {
        await publishBoardOrder(result.orgId, result.orderId);
      }
    } catch (error) {
      // A 5xx makes Stripe retry; nothing was recorded, so the retry is clean.
      console.error("[CardLinks] webhook failed:", error instanceof Error ? error.message : error);
      res.status(500).json({ message: "Could not process the event" });
    }
  });

  app.get("/api/card-links/paid", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.type("html").send(PAID_PAGE);
  });
}

const orderIdParam = z.string().uuid();

export function registerCardLinkRoutes(app: Express, scoped: RequestHandler[]): void {
  const tillRole = requireRole(...rolesAtLeast(CARD_LINK_MIN_ROLE));

  app.get("/api/card-links/till", ...scoped, tillRole, async (_req, res) => {
    const { canSendWhatsapp } = await import("../whatsapp/config");
    // Only whether it is on: nothing about the keys reaches a till.
    res.json({ enabled: isStripeConfigured(), whatsapp: canSendWhatsapp() });
  });

  app.post("/api/card-links/:orderId", ...scoped, tillRole, async (req: any, res) => {
    if (!orderIdParam.safeParse(req.params.orderId).success) return res.status(400).json({ message: "Invalid order" });
    const body = z.object({ minutes: z.number().int().optional() }).safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ message: "Invalid request" });
    try {
      const { createCardLink } = await import("../services/cardLinks");
      const view = await createCardLink({
        orgId: req.orgContext.orgId,
        orderId: req.params.orderId,
        userId: req.user?.id ?? null,
        minutes: body.data.minutes,
        successUrl: appUrlFromRequest(req, `${APP_BASE_PATH}/api/card-links/paid`),
      });
      res.status(201).json(view);
    } catch (error) {
      sendError(res, error, "Failed to make the card link");
    }
  });

  app.get("/api/card-links/:orderId", ...scoped, tillRole, async (req: any, res) => {
    if (!orderIdParam.safeParse(req.params.orderId).success) return res.status(400).json({ message: "Invalid order" });
    try {
      const { getCardLinkState } = await import("../services/cardLinks");
      const before = req.query.refresh === "1";
      const view = await getCardLinkState(req.orgContext.orgId, req.params.orderId, { refreshFromStripe: before });
      res.json(view);
      if (before && view.leg?.status === "paid") await publishBoardOrder(req.orgContext.orgId, req.params.orderId);
    } catch (error) {
      sendError(res, error, "Failed to read the card link");
    }
  });

  app.post("/api/card-links/:orderId/cancel", ...scoped, tillRole, async (req: any, res) => {
    if (!orderIdParam.safeParse(req.params.orderId).success) return res.status(400).json({ message: "Invalid order" });
    try {
      const { cancelCardLink } = await import("../services/cardLinks");
      res.json(await cancelCardLink(req.orgContext.orgId, req.params.orderId));
    } catch (error) {
      sendError(res, error, "Failed to cancel the card link");
    }
  });

  app.post("/api/card-links/:orderId/retender", ...scoped, tillRole, async (req: any, res) => {
    if (!orderIdParam.safeParse(req.params.orderId).success) return res.status(400).json({ message: "Invalid order" });
    const body = z.object({ method: z.enum(CARD_LINK_RETENDER_METHODS) }).safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ message: "Choose Cash, Card or Transfer." });
    try {
      const { retenderCardLink } = await import("../services/cardLinks");
      const view = await retenderCardLink(req.orgContext.orgId, req.params.orderId, body.data.method);
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: req.orgContext?.role ?? req.user?.role ?? "CASHIER",
        action: "card_link.retendered",
        targetType: "order",
        targetId: req.params.orderId,
        orgId: req.orgContext.orgId,
        metadata: { method: body.data.method },
      });
      res.json(view);
      await publishBoardOrder(req.orgContext.orgId, req.params.orderId);
    } catch (error) {
      sendError(res, error, "Failed to change how the order was paid");
    }
  });

  app.post("/api/card-links/:orderId/whatsapp", ...scoped, tillRole, async (req: any, res) => {
    if (!orderIdParam.safeParse(req.params.orderId).success) return res.status(400).json({ message: "Invalid order" });
    try {
      const { sendCardLinkByWhatsapp } = await import("../services/cardLinks");
      const sent = await sendCardLinkByWhatsapp(req.orgContext.orgId, req.params.orderId);
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: req.orgContext?.role ?? req.user?.role ?? "CASHIER",
        action: "card_link.whatsapp_sent",
        targetType: "order",
        targetId: req.params.orderId,
        orgId: req.orgContext.orgId,
        metadata: { conversationId: sent.conversationId },
      });
      // Sent or not: the number it went to stays on the server.
      res.status(201).json({ sent: true });
    } catch (error) {
      sendError(res, error, "Failed to send the link by WhatsApp");
    }
  });

  app.get(
    "/api/settings/stripe",
    ...scoped,
    requireRole(...rolesAtLeast(STRIPE_SETTINGS_MIN_ROLE)),
    (req: any, res) => {
      const cfg = getStripeConfig();
      res.json({
        connected: isStripeConfigured(cfg),
        mode: stripeKeyMode(cfg),
        hasSecretKey: !!cfg.secretKey,
        hasWebhookSecret: !!cfg.webhookSecret,
        apiVersion: STRIPE_API_VERSION,
        webhookUrl: appUrlFromRequest(req, `${APP_BASE_PATH}/api/stripe/webhook`),
        webhookEvents: STRIPE_WEBHOOK_EVENTS,
        // Placeholders only: the real values are never read back to anyone.
        envLines: ["STRIPE_SECRET_KEY=sk_live_...", "STRIPE_WEBHOOK_SECRET=whsec_..."],
      });
    },
  );
}
