/**
 * One-off: recompute cashier_shift_summaries for a list of shifts.
 *
 * Written for the migration-060 duplicate-shift repair: after merging every
 * duplicate lazily-opened shift for a person/day onto one keeper (repointing
 * orders.cashier_shift_id / completed_cashier_shift_id), the keeper's own
 * summary only reflects the orders it originally had. This recomputes it
 * from scratch using the app's own refreshClosedCashierShiftSummary — the
 * same function the order-completion path already calls in production for
 * an offline order replayed into a closed shift — so the numbers are exactly
 * what the app itself would produce, not hand-derived SQL. Idempotent: safe
 * to re-run on a shift whose orders haven't changed.
 *
 * Run: npx tsx scripts/recompute-shift-summaries.ts <orgId>:<shiftId> [...]
 */
import { refreshClosedCashierShiftSummary } from "../server/services/cashierShiftEngine";

async function main() {
  const pairs = process.argv.slice(2);
  if (pairs.length === 0) {
    console.error("Usage: npx tsx scripts/recompute-shift-summaries.ts <orgId>:<shiftId> [...]");
    process.exit(1);
  }
  for (const pair of pairs) {
    const [orgId, shiftId] = pair.split(":");
    if (!orgId || !shiftId) {
      console.error(`Skipping malformed argument: ${pair}`);
      continue;
    }
    try {
      const summary = await refreshClosedCashierShiftSummary(orgId, shiftId);
      console.log(
        `OK  org=${orgId} shift=${shiftId}  gross=£${summary.grossSales}  ` +
          `commission=£${summary.commissionAmount}  net=£${summary.businessRetainedProfit}`,
      );
    } catch (err) {
      console.error(`FAILED org=${orgId} shift=${shiftId}:`, err instanceof Error ? err.message : err);
    }
  }
  process.exit(0);
}

main();
