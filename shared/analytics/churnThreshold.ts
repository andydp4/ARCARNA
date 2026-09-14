/**
 * ARC-029: a customer with a single order from yesterday used to score
 * 50/100 ("AT RISK") on the Churn Risk report — a 20-point base plus 30
 * points for "≤2 orders", with no floor on how long they'd actually been a
 * customer. A customer is only scoreable once they've had a real chance to
 * lapse (30+ days of tenure) or enough orders to show a cadence (3+).
 *
 * Kept dependency-free (no `db` import) so it can be unit-tested without a
 * live database — `server/services/reportsEngine.ts` imports `db` at module
 * scope, which throws immediately if DATABASE_URL is unset.
 */
const MIN_TENURE_DAYS_FOR_CHURN_SCORE = 30;
const MIN_ORDERS_FOR_CHURN_SCORE = 3;

export function hasEnoughDataForChurnScore(tenureDays: number, orderCount: number): boolean {
  return tenureDays >= MIN_TENURE_DAYS_FOR_CHURN_SCORE || orderCount >= MIN_ORDERS_FOR_CHURN_SCORE;
}
