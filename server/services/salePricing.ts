/**
 * Server truth for a till sale's price (v1.2 Phase 1B).
 *
 * Runs INSIDE the sale's transaction and BEFORE the order or any payment leg
 * is written, so every tender is checked against what was charged. The
 * customer and promotion rows are locked for the rest of the sale: two sales
 * cannot both spend the same points, or both take a promotion's last use.
 * The price itself comes from shared/pricing/priceOrder.ts — the same function
 * the till displays with — so the two cannot disagree about the rules, only
 * about stale data, which this re-reads.
 */
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { customers, loyaltyLedger, loyaltySettings, loyaltyTiers, promotions } from "@shared/schema";
import {
  PricingError,
  priceOrder,
  type PricedOrder,
  type PricingLine,
  type PricingPromotion,
} from "@shared/pricing/priceOrder";
import { loyaltySettingsFrom } from "../lib/loyaltyRedemptionService";
import { SaleRefusedError } from "./saleReference";

type Tx = any;

export type SalePricingInput = {
  orgId: string;
  customerId?: string | null;
  lines: PricingLine[];
  taxRatePercent: number;
  promoCode?: string | null;
  redeemPoints?: number;
  now?: Date;
};

/** Reads what the sale may use (locking it) and prices it. Refusals are SaleRefusedError. */
export async function priceSaleInTx(tx: Tx, input: SalePricingInput): Promise<PricedOrder> {
  let customer: { loyaltyPoints: number } | null = null;
  if (input.customerId) {
    const [row] = await tx
      .select({ loyaltyPoints: customers.loyaltyPoints })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.orgId, input.orgId)))
      .for("update")
      .limit(1);
    if (!row) throw new SaleRefusedError("The customer on this sale was not found.");
    customer = { loyaltyPoints: row.loyaltyPoints ?? 0 };
  }

  const tiers = await tx
    .select({
      id: loyaltyTiers.id,
      name: loyaltyTiers.name,
      pointsRequired: loyaltyTiers.pointsRequired,
      discountPercentage: loyaltyTiers.discountPercentage,
    })
    .from(loyaltyTiers)
    .where(eq(loyaltyTiers.orgId, input.orgId));

  let promotion: PricingPromotion | null = null;
  const code = input.promoCode?.trim();
  if (code) {
    const [row] = await tx
      .select()
      .from(promotions)
      .where(and(eq(promotions.orgId, input.orgId), eq(promotions.code, code)))
      .for("update")
      .limit(1);
    if (!row) throw new SaleRefusedError(`Promo code ${code} is not recognised.`);
    promotion = row;
  }

  const redeem = input.redeemPoints ?? 0;
  let points = null;
  if (redeem !== 0) {
    // Read on the sale's own connection: borrowing a second pool connection
    // from inside a transaction is how the pool self-deadlocks under load.
    const [row] = await tx.select().from(loyaltySettings).where(eq(loyaltySettings.orgId, input.orgId)).limit(1);
    const settings = loyaltySettingsFrom(row);
    points = {
      points: redeem,
      redemptionRate: settings.redemptionRate,
      minRedeemPoints: settings.minRedeemPoints,
      balance: customer?.loyaltyPoints ?? 0,
    };
  }

  try {
    return priceOrder({
      lines: input.lines,
      taxRatePercent: input.taxRatePercent,
      customer,
      tiers,
      promotion,
      points,
      now: input.now,
    });
  } catch (error) {
    if (error instanceof PricingError) throw new SaleRefusedError(error.message);
    throw error;
  }
}

/**
 * Spends what the price used, in the same transaction as the order: the
 * points leave the customer's balance (with a ledger row, so deleting the
 * sale gives them back) and the promotion's use is counted. The rows were
 * locked by priceSaleInTx, and both updates re-check their limit anyway.
 */
export async function consumeSalePricingInTx(
  tx: Tx,
  input: { orgId: string; orderId: string; customerId?: string | null; pricing: PricedOrder },
): Promise<void> {
  const { pricing } = input;
  if (pricing.pointsRedeemed > 0) {
    if (!input.customerId) throw new SaleRefusedError("Pick the customer before redeeming points.");
    const [row] = await tx
      .update(customers)
      .set({ loyaltyPoints: sql`${customers.loyaltyPoints} - ${pricing.pointsRedeemed}`, updatedAt: new Date() })
      .where(
        and(
          eq(customers.id, input.customerId),
          eq(customers.orgId, input.orgId),
          sql`${customers.loyaltyPoints} >= ${pricing.pointsRedeemed}`,
        ),
      )
      .returning({ loyaltyPoints: customers.loyaltyPoints });
    if (!row) throw new SaleRefusedError("The customer no longer has those points.");
    const after = row.loyaltyPoints ?? 0;
    await tx.insert(loyaltyLedger).values({
      orgId: input.orgId,
      customerId: input.customerId,
      orderId: input.orderId,
      eventId: randomUUID(),
      pointsDelta: -pricing.pointsRedeemed,
      reason: "redeem",
      previousBalance: after + pricing.pointsRedeemed,
      newBalance: after,
    });
  }

  if (pricing.promotion?.id) {
    const [used] = await tx
      .update(promotions)
      .set({ usageCount: sql`COALESCE(${promotions.usageCount}, 0) + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(promotions.id, pricing.promotion.id),
          eq(promotions.orgId, input.orgId),
          sql`(${promotions.usageLimit} IS NULL OR COALESCE(${promotions.usageCount}, 0) < ${promotions.usageLimit})`,
        ),
      )
      .returning({ id: promotions.id });
    if (!used) throw new SaleRefusedError(`${pricing.promotion.name} has been used up.`);
  }
}

/**
 * The till sends the total it showed. A sale whose server price differs —
 * a promotion expired or a tier changed while it waited offline — is refused,
 * never quietly recorded at a price nobody agreed to.
 */
export function assertChargedAsShown(pricing: PricedOrder, expectedTotal: unknown): void {
  if (expectedTotal === undefined || expectedTotal === null || expectedTotal === "") return;
  const shown = Number(expectedTotal);
  if (!Number.isFinite(shown)) throw new SaleRefusedError("The till sent an unreadable total.");
  if (Math.abs(shown - pricing.total) > 0.005) {
    throw new SaleRefusedError(
      `The till showed £${shown.toFixed(2)} but the price is now £${pricing.total.toFixed(2)}. Check the discounts and take payment again.`,
    );
  }
}
