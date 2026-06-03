import { and, eq } from "drizzle-orm";
import { giftCards, giftCardMovements, organizations, type GiftCard } from "../../shared/schema";
import { generateGiftCardCode, normalizeGiftCardCode, maskGiftCardCode } from "@shared/giftCards/code";
import { applyIssue, applyRedeem, applyVoid, canRedeemAmount, roundMoney } from "@shared/giftCards/balance";
import { publishEventTx } from "../eventBus";
import type { db } from "../db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function serializeGiftCard(card: GiftCard, includeCode = false) {
  return {
    id: card.id,
    code: includeCode ? card.code : undefined,
    codeLast4: card.code.slice(-4),
    maskedCode: maskGiftCardCode(card.code),
    balance: parseFloat(String(card.balance)),
    originalAmount: parseFloat(String(card.originalAmount)),
    currency: card.currency,
    status: card.status,
    issuedToCustomerId: card.issuedToCustomerId,
    expiresAt: card.expiresAt,
    createdAt: card.createdAt,
  };
}

async function uniqueCode(tx: Tx, orgId: string) {
  for (let i = 0; i < 10; i++) {
    const code = generateGiftCardCode();
    const [existing] = await tx.select({ id: giftCards.id }).from(giftCards)
      .where(and(eq(giftCards.orgId, orgId), eq(giftCards.code, code))).limit(1);
    if (!existing) return code;
  }
  throw new Error("Failed to generate unique gift card code");
}

export async function issueGiftCardInTx(tx: Tx, params: {
  orgId: string; amount: number; issuedByUserId: string; customerId?: string | null;
  expiresAt?: Date | null; refundId?: string | null; movementType?: "issue" | "refund_credit"; actorUserId: string;
}) {
  const amount = roundMoney(params.amount);
  if (amount <= 0) throw new Error("Issue amount must be positive");
  const [org] = await tx.select({ currency: organizations.currency }).from(organizations)
    .where(eq(organizations.id, params.orgId)).limit(1);
  const { balance, status } = applyIssue(amount);
  const code = await uniqueCode(tx, params.orgId);
  const [card] = await tx.insert(giftCards).values({
    orgId: params.orgId, code, balance: String(balance), originalAmount: String(amount),
    currency: (org?.currency ?? "GBP").slice(0, 3), issuedToCustomerId: params.customerId ?? null,
    issuedByUserId: params.issuedByUserId, status, expiresAt: params.expiresAt ?? null,
  }).returning();
  await tx.insert(giftCardMovements).values({
    giftCardId: card.id, refundId: params.refundId ?? null, type: params.movementType ?? "issue",
    amount: String(amount), balanceAfter: String(balance),
  });
  await publishEventTx(tx as unknown as typeof import("../db").db, "GiftCardIssued", card.id, {
    giftCardId: card.id, orgId: params.orgId, customerId: params.customerId ?? null,
    amount, movementType: params.movementType ?? "issue", refundId: params.refundId ?? null,
  }, { actor: { type: "user", id: params.actorUserId }, source: "gift-cards" });
  return { card, code, serialized: serializeGiftCard(card, true) };
}

export async function redeemGiftCardInTx(tx: Tx, params: {
  orgId: string; code: string; amount: number; orderId: string; actorUserId: string;
}) {
  const normalized = normalizeGiftCardCode(params.code);
  const amount = roundMoney(params.amount);
  const [existingMovement] = await tx.select({ id: giftCardMovements.id }).from(giftCardMovements)
    .where(and(eq(giftCardMovements.orderId, params.orderId), eq(giftCardMovements.type, "redeem"))).limit(1);
  if (existingMovement) {
    const [card] = await tx.select().from(giftCards)
      .where(and(eq(giftCards.orgId, params.orgId), eq(giftCards.code, normalized))).limit(1);
    return { card, idempotent: true as const };
  }
  const [card] = await tx.select().from(giftCards)
    .where(and(eq(giftCards.orgId, params.orgId), eq(giftCards.code, normalized))).limit(1);
  if (!card) throw new Error("Gift card not found");
  const check = canRedeemAmount(parseFloat(String(card.balance)), amount,
    card.status as "active" | "redeemed" | "expired" | "void", card.expiresAt);
  if (!check.ok) throw new Error(check.reason);
  const { newBalance, status } = applyRedeem(parseFloat(String(card.balance)), amount);
  const [updated] = await tx.update(giftCards).set({ balance: String(newBalance), status })
    .where(eq(giftCards.id, card.id)).returning();
  await tx.insert(giftCardMovements).values({
    giftCardId: card.id, orderId: params.orderId, type: "redeem",
    amount: String(amount), balanceAfter: String(newBalance),
  });
  await publishEventTx(tx as unknown as typeof import("../db").db, "GiftCardRedeemed", card.id, {
    giftCardId: card.id, orderId: params.orderId, amount, balanceAfter: newBalance,
  }, { actor: { type: "user", id: params.actorUserId }, source: "gift-cards" });
  return { card: updated, idempotent: false as const };
}

export async function voidGiftCardInTx(tx: Tx, params: { orgId: string; code: string; actorUserId: string }) {
  const normalized = normalizeGiftCardCode(params.code);
  const [card] = await tx.select().from(giftCards)
    .where(and(eq(giftCards.orgId, params.orgId), eq(giftCards.code, normalized))).limit(1);
  if (!card) throw new Error("Gift card not found");
  if (card.status === "void") return { card, idempotent: true as const };
  const priorBalance = parseFloat(String(card.balance));
  const { newBalance, status } = applyVoid();
  const [updated] = await tx.update(giftCards).set({ balance: String(newBalance), status })
    .where(eq(giftCards.id, card.id)).returning();
  await tx.insert(giftCardMovements).values({
    giftCardId: card.id, type: "void", amount: String(priorBalance), balanceAfter: String(newBalance),
  });
  return { card: updated, idempotent: false as const };
}

export async function lookupGiftCardByCode(orgId: string, code: string) {
  const { db: mainDb } = await import("../db");
  const [card] = await mainDb.select().from(giftCards)
    .where(and(eq(giftCards.orgId, orgId), eq(giftCards.code, normalizeGiftCardCode(code)))).limit(1);
  return card ? serializeGiftCard(card) : null;
}

export async function listGiftCardsByCustomer(orgId: string, customerId: string) {
  const { db: mainDb } = await import("../db");
  const rows = await mainDb.select().from(giftCards)
    .where(and(eq(giftCards.orgId, orgId), eq(giftCards.issuedToCustomerId, customerId))).orderBy(giftCards.createdAt);
  return rows.map((c) => serializeGiftCard(c));
}

export async function listGiftCardMovements(giftCardId: string) {
  const { db: mainDb } = await import("../db");
  return mainDb.select().from(giftCardMovements).where(eq(giftCardMovements.giftCardId, giftCardId))
    .orderBy(giftCardMovements.createdAt);
}
