export type LoyaltyTierLike = {
  name: string;
  pointsRequired: number;
  color?: string | null;
};

export type TierProgress = {
  currentTier: LoyaltyTierLike | null;
  nextTier: LoyaltyTierLike | null;
  pointsToNext: number;
  percent: number;
};

/** Compute tier badge progress toward the next loyalty tier. */
export function computeTierProgress(
  loyaltyPoints: number,
  tiers: LoyaltyTierLike[],
): TierProgress {
  if (tiers.length === 0) {
    return { currentTier: null, nextTier: null, pointsToNext: 0, percent: 0 };
  }

  const sorted = [...tiers].sort((a, b) => a.pointsRequired - b.pointsRequired);
  let currentIdx = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (loyaltyPoints >= sorted[i].pointsRequired) {
      currentIdx = i;
      break;
    }
  }

  const currentTier = currentIdx >= 0 ? sorted[currentIdx] : null;
  const nextTier = currentIdx >= 0 && currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : null;

  if (!nextTier) {
    return { currentTier, nextTier: null, pointsToNext: 0, percent: 100 };
  }

  const floor = currentTier?.pointsRequired ?? 0;
  const span = nextTier.pointsRequired - floor;
  const progress = loyaltyPoints - floor;
  const pointsToNext = Math.max(0, nextTier.pointsRequired - loyaltyPoints);
  const percent = span > 0 ? Math.min(100, Math.round((progress / span) * 100)) : 0;

  return { currentTier, nextTier, pointsToNext, percent };
}

/** Convert points to discount amount using org redemption rate (e.g. 0.01 = £1 per 100 pts). */
export function pointsToDiscount(points: number, redemptionRate: number): number {
  if (points <= 0 || redemptionRate <= 0) return 0;
  return Math.round(points * redemptionRate * 100) / 100;
}
