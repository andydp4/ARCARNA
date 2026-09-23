/**
 * One-off repair: a split sale whose credit part was recorded as another
 * tender (almost always Card — the till used to pre-fill the second split row
 * with it, see client/src/lib/splitTender.ts).
 *
 * For each invoice number it:
 *   1. turns that order's `--from` leg (default card) into a credit (tick) leg;
 *   2. opens the credit record, dated the trading day the sale was settled, so
 *      the debt shows on the credit list against the right customer and day;
 *   3. recomputes the summaries of any closed cashier shift the order belongs
 *      to, with the app's own refreshClosedCashierShiftSummary, so card and
 *      credit takings for that shift are right;
 *   4. writes an admin audit row per order.
 *
 * Commission already accrued is NOT touched — the app has no reversal path and
 * this script will not invent one. It is reported instead: if a shift had
 * already closed, commission on the credit part was accrued as if paid, and a
 * later credit payment would release it again. The owner decides that one.
 *
 * Dry run by default; nothing is written without --apply.
 *
 *   npx tsx scripts/fix-split-credit.ts INV-20260920-PPE5 INV-20260922-QE15
 *   npx tsx scripts/fix-split-credit.ts INV-20260920-PPE5 INV-20260922-QE15 --apply
 *   (optional: --from=transfer, --actor=<user id for the audit row>)
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import {
  adminAuditLogs,
  cashierCommissionEntries,
  cashierShifts,
  invoices,
  orderCredit,
  orderPayments,
  orders,
  organizations,
} from "@shared/schema";
import { currentTradingDay } from "@shared/time/tradingDay";
import { roundMoney } from "@shared/reports/orderCommission";
import { commissionBasisFor } from "../server/services/creditLedger";
import { refreshClosedCashierShiftSummary } from "../server/services/cashierShiftEngine";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const from = (args.find((a) => a.startsWith("--from="))?.split("=")[1] ?? "card").toLowerCase();
const actor = args.find((a) => a.startsWith("--actor="))?.split("=")[1] ?? "script:fix-split-credit";
const invoiceNumbers = args.filter((a) => !a.startsWith("--"));

async function main() {
  if (invoiceNumbers.length === 0) {
    console.error("Usage: npx tsx scripts/fix-split-credit.ts <INV-...> [...] [--from=card] [--apply]");
    process.exit(1);
  }
  console.log(apply ? "APPLYING changes\n" : "DRY RUN — nothing will be written (add --apply)\n");

  const rows = await db
    .select({ invoiceNumber: invoices.invoiceNumber, order: orders })
    .from(invoices)
    .innerJoin(orders, eq(orders.id, invoices.orderId))
    .where(inArray(invoices.invoiceNumber, invoiceNumbers));

  for (const wanted of invoiceNumbers) {
    if (!rows.some((r) => r.invoiceNumber === wanted)) console.log(`SKIP ${wanted}: no such invoice`);
  }

  const shiftsToRefresh = new Map<string, string>(); // shiftId -> orgId
  let changed = 0;

  for (const { invoiceNumber, order } of rows) {
    const tag = `${invoiceNumber} (order ${order.id.slice(0, 8)})`;
    if (order.status !== "completed" || !order.settledAt) {
      console.log(`SKIP ${tag}: not completed — credit opens on completion, just complete it`);
      continue;
    }
    if (!order.customerId) {
      console.log(`SKIP ${tag}: no customer on the order — set one first`);
      continue;
    }
    const legs = await db.select().from(orderPayments).where(eq(orderPayments.orderId, order.id));
    const target = legs.filter((l) => l.method.toLowerCase() === from);
    if (target.length !== 1) {
      console.log(`SKIP ${tag}: expected exactly one ${from} leg, found ${target.length} (${legs.map((l) => `${l.method} ${l.amount}`).join(", ")})`);
      continue;
    }
    const [existingCredit] = await db.select().from(orderCredit).where(eq(orderCredit.orderId, order.id));
    if (existingCredit && existingCredit.status !== "voided") {
      console.log(`SKIP ${tag}: already has a ${existingCredit.status} credit of £${existingCredit.amountGiven}`);
      continue;
    }

    const leg = target[0];
    const amount = roundMoney(parseFloat(String(leg.amount)));
    const [org] = await db
      .select({ timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, order.orgId));
    const givenOn = currentTradingDay(org?.timezone ?? "Europe/London", order.settledAt);

    const saleCommission = await db
      .select({ amount: cashierCommissionEntries.amount })
      .from(cashierCommissionEntries)
      .where(and(eq(cashierCommissionEntries.orderId, order.id), eq(cashierCommissionEntries.basis, "sale")));
    const accrued = roundMoney(saleCommission.reduce((s, r) => s + parseFloat(String(r.amount)), 0));

    const shiftIds = [order.cashierShiftId, order.completedCashierShiftId].filter((id): id is string => !!id);
    const closedShifts = shiftIds.length
      ? await db
          .select({ id: cashierShifts.id, status: cashierShifts.status })
          .from(cashierShifts)
          .where(inArray(cashierShifts.id, shiftIds))
      : [];

    console.log(`${tag}: ${from} £${amount.toFixed(2)} -> credit, owed from ${givenOn}`);
    if (accrued > 0) {
      // What that commission would have been had the credit part been known.
      const basis = await commissionBasisFor(order.id, amount);
      const creditPart = basis ? roundMoney(basis.creditCompleterAmount + basis.creditInputterAmount) : 0;
      console.log(
        `  commission already accrued at shift close: £${accrued.toFixed(2)}, of which about £${creditPart.toFixed(2)} ` +
          `is on the credit part — it will be released AGAIN when this credit is paid. Not changed by this script.`,
      );
    }

    if (!apply) continue;
    await db.transaction(async (tx) => {
      await tx.update(orderPayments).set({ method: "tick" }).where(eq(orderPayments.id, leg.id));
      await tx
        .insert(orderCredit)
        .values({
          orderId: order.id,
          orgId: order.orgId,
          customerId: order.customerId,
          amountGiven: String(amount),
          amountOutstanding: String(amount),
          status: "outstanding",
          givenOn,
        })
        .onConflictDoUpdate({
          target: orderCredit.orderId,
          set: {
            customerId: order.customerId,
            amountGiven: String(amount),
            amountOutstanding: String(amount),
            status: "outstanding",
            givenOn,
            settledOn: null,
            updatedAt: new Date(),
          },
        });
      await tx.insert(adminAuditLogs).values({
        orgId: order.orgId,
        actorUserId: actor,
        actorRole: "SYSTEM",
        action: "order.split_tender_corrected",
        targetType: "order",
        targetId: order.id,
        metadata: { invoiceNumber, from, to: "tick", amount, givenOn, commissionAccruedAtClose: accrued },
      });
    });
    for (const s of closedShifts) if (s.status !== "open") shiftsToRefresh.set(s.id, order.orgId);
    changed += 1;
  }

  if (apply) {
    for (const [shiftId, orgId] of shiftsToRefresh) {
      const summary = await refreshClosedCashierShiftSummary(orgId, shiftId);
      console.log(`shift ${shiftId.slice(0, 8)} recomputed: card £${summary.cardSales}, credit £${summary.creditSales}`);
    }
    console.log(`\nDone: ${changed} order(s) corrected.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
