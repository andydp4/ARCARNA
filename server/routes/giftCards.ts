import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import { giftCards } from "../../shared/schema";
import { and, eq, ilike, or } from "drizzle-orm";
import { requireRole } from "../auth";
import { recordAdminAudit } from "../adminAudit";
import { validateGiftCardCode, normalizeGiftCardCode } from "@shared/giftCards/code";
import {
  issueGiftCardInTx, voidGiftCardInTx, lookupGiftCardByCode,
  listGiftCardsByCustomer, listGiftCardMovements, serializeGiftCard,
} from "../lib/giftCardService";
import { roundMoney } from "@shared/giftCards/balance";

const issueSchema = z.object({
  amount: z.coerce.number().positive(),
  customerId: z.string().uuid().optional(),
  expiresAt: z.coerce.date().optional(),
});

export function registerGiftCardRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/gift-cards", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const customerId = req.query.customerId as string | undefined;
      const q = (req.query.q as string | undefined)?.trim();
      if (customerId) {
        const cards = await listGiftCardsByCustomer(ctx.orgId, customerId);
        const totalCredit = cards.filter((c) => c.status === "active").reduce((s, c) => s + c.balance, 0);
        return res.json({ giftCards: cards, totalCredit: roundMoney(totalCredit) });
      }
      const where = q
        ? and(eq(giftCards.orgId, ctx.orgId), or(eq(giftCards.code, normalizeGiftCardCode(q)), ilike(giftCards.code, `%${normalizeGiftCardCode(q).slice(-4)}`)))
        : eq(giftCards.orgId, ctx.orgId);
      const rows = await db.select().from(giftCards).where(where).orderBy(giftCards.createdAt).limit(q ? 50 : 100);
      res.json({ giftCards: rows.map((c) => serializeGiftCard(c)) });
    } catch (e) {
      console.error("[GiftCards] list:", e);
      res.status(500).json({ message: "Failed to list gift cards" });
    }
  });

  app.get("/api/gift-cards/:code", ...scoped, async (req: any, res) => {
    try {
      const code = decodeURIComponent(req.params.code);
      if (!validateGiftCardCode(code)) return res.status(400).json({ message: "Invalid gift card code format" });
      const card = await lookupGiftCardByCode(req.orgContext.orgId, code);
      if (!card) return res.status(404).json({ message: "Gift card not found" });
      const movements = await listGiftCardMovements(card.id);
      res.json({ ...card, movements: movements.map((m) => ({
        id: m.id, type: m.type, amount: parseFloat(String(m.amount)),
        balanceAfter: parseFloat(String(m.balanceAfter)), orderId: m.orderId, refundId: m.refundId, createdAt: m.createdAt,
      })) });
    } catch (e) {
      console.error("[GiftCards] lookup:", e);
      res.status(500).json({ message: "Failed to lookup gift card" });
    }
  });

  app.post("/api/gift-cards", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id ?? "unknown";
      const body = issueSchema.parse(req.body ?? {});
      const result = await db.transaction(async (tx) => issueGiftCardInTx(tx, {
        orgId: ctx.orgId, amount: body.amount, customerId: body.customerId, expiresAt: body.expiresAt,
        issuedByUserId: userId, actorUserId: userId,
      }));
      await recordAdminAudit(req, {
        actorUserId: userId, actorRole: req.orgContext?.role ?? "CASHIER", action: "gift_card.issued",
        targetType: "gift_card", targetId: result.card.id, orgId: ctx.orgId,
        metadata: { amount: body.amount, customerId: body.customerId ?? null, codeLast4: result.code.slice(-4) },
      });
      res.status(201).json({ giftCard: result.serialized, code: result.code });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", errors: e.errors });
      console.error("[GiftCards] issue:", e);
      res.status(500).json({ message: "Failed to issue gift card" });
    }
  });

  app.post("/api/gift-cards/:code/redeem", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"), async (req: any, res) => {
    try {
      const code = decodeURIComponent(req.params.code);
      z.object({ amount: z.coerce.number().positive() }).parse(req.body ?? {});
      if (!validateGiftCardCode(code)) return res.status(400).json({ message: "Invalid gift card code format" });
      const card = await lookupGiftCardByCode(req.orgContext.orgId, code);
      if (!card) return res.status(404).json({ message: "Gift card not found" });
      res.json({ giftCard: card });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", errors: e.errors });
      res.status(500).json({ message: "Failed to validate gift card" });
    }
  });

  app.post("/api/gift-cards/:code/void", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id ?? "unknown";
      const code = decodeURIComponent(req.params.code);
      if (!validateGiftCardCode(code)) return res.status(400).json({ message: "Invalid gift card code format" });
      const result = await db.transaction(async (tx) => voidGiftCardInTx(tx, { orgId: ctx.orgId, code, actorUserId: userId }));
      await recordAdminAudit(req, {
        actorUserId: userId, actorRole: req.orgContext?.role ?? "MANAGER", action: "gift_card.voided",
        targetType: "gift_card", targetId: result.card.id, orgId: ctx.orgId, metadata: { codeLast4: code.slice(-4) },
      });
      res.json({ giftCard: serializeGiftCard(result.card) });
    } catch (e) {
      res.status(400).json({ message: e instanceof Error ? e.message : "Failed to void gift card" });
    }
  });
}
