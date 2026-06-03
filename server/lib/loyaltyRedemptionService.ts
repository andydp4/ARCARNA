import { db } from "../db";
import { customers, loyaltySettings } from "@shared/schema";
import { pointsToDiscount } from "@shared/loyalty/progress";
import { and, eq } from "drizzle-orm";

const DEFAULT_RATE = 0.01;
const DEFAULT_MIN = 100;

export async function getLoyaltySettings(orgId: string) {
  const [row] = await db.select().from(loyaltySettings).where(eq(loyaltySettings.orgId, orgId)).limit(1);
  return {
    redemptionRate: parseFloat(String(row?.redemptionRate ?? DEFAULT_RATE)),
    minRedeemPoints: row?.minRedeemPoints ?? DEFAULT_MIN,
  };
}

export async function upsertLoyaltySettings(
  orgId: string,
  data: { redemptionRate?: number; minRedeemPoints?: number },
) {
  const existing = await getLoyaltySettings(orgId);
  const redemptionRate = data.redemptionRate ?? existing.redemptionRate;
  const minRedeemPoints = data.minRedeemPoints ?? existing.minRedeemPoints;

  await db
    .insert(loyaltySettings)
    .values({
      orgId,
      redemptionRate: String(redemptionRate),
      minRedeemPoints,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: loyaltySettings.orgId,
      set: {
        redemptionRate: String(redemptionRate),
        minRedeemPoints,
        updatedAt: new Date(),
      },
    });

  return { redemptionRate, minRedeemPoints };
}

export async function validatePointsRedemption(
  orgId: string,
  customerId: string,
  points: number,
): Promise<{ discountAmount: number; remainingPoints: number }> {
  const settings = await getLoyaltySettings(orgId);
  if (points < settings.minRedeemPoints) {
    throw new Error(`Minimum redemption is ${settings.minRedeemPoints} points`);
  }
  if (!Number.isInteger(points) || points <= 0) {
    throw new Error("Points must be a positive whole number");
  }

  const [customer] = await db
    .select({ loyaltyPoints: customers.loyaltyPoints })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.orgId, orgId)))
    .limit(1);

  if (!customer) throw new Error("Customer not found");
  const balance = customer.loyaltyPoints ?? 0;
  if (points > balance) throw new Error("Insufficient points balance");

  const discountAmount = pointsToDiscount(points, settings.redemptionRate);
  return { discountAmount, remainingPoints: balance - points };
}

type DbTx = Pick<typeof db, "select" | "update">;

export async function redeemPointsInTx(
  tx: DbTx,
  orgId: string,
  customerId: string,
  points: number,
): Promise<number> {
  const { discountAmount, remainingPoints } = await validatePointsRedemption(orgId, customerId, points);
  await tx
    .update(customers)
    .set({ loyaltyPoints: remainingPoints })
    .where(and(eq(customers.id, customerId), eq(customers.orgId, orgId)));
  return discountAmount;
}
