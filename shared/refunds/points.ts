/** Proportional loyalty reversal for partial refunds (rounded down). */
export function proportionalPointsToReverse(
  refundAmount: number,
  orderTotal: number,
  pointsEarnedOnOrder: number,
): number {
  if (orderTotal <= 0 || refundAmount <= 0 || pointsEarnedOnOrder <= 0) return 0;
  return Math.floor((refundAmount / orderTotal) * pointsEarnedOnOrder);
}
