/**
 * A customer's credit account as a whole (v1.2.1 credit): what they owe, and
 * a payment against it allocated across their open tabs, oldest first.
 *
 * Both the Credit List's part payment (`POST /api/tick-customers/:id/payments`)
 * and the till's Take a payment (`POST /api/customers/:id/credit-payments`)
 * come through here, so there is one allocation rule. Each slice is recorded
 * by `recordCreditPayment`, the Phase 1 repayment path, which is what updates
 * the ledger, stamps the drawer (expected cash and the shift summary) and
 * releases commission.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { orderCredit } from "@shared/schema";
import { summariseCustomerCredit, type CustomerCreditSummary } from "@shared/customerCredit";
import { CreditError, recordCreditPayment, type CreditLedgerTx } from "./creditLedger";

const round = (n: number) => Math.round(n * 100) / 100;

async function openTabs(orgId: string, customerId: string, tx?: CreditLedgerTx) {
  const q = (tx ?? db)
    .select({
      orderId: orderCredit.orderId,
      amountOutstanding: orderCredit.amountOutstanding,
      givenOn: orderCredit.givenOn,
    })
    .from(orderCredit)
    .where(
      and(
        eq(orderCredit.orgId, orgId),
        eq(orderCredit.customerId, customerId),
        inArray(orderCredit.status, ["outstanding", "partial"]),
      ),
    )
    .orderBy(asc(orderCredit.givenOn), asc(orderCredit.createdAt));
  // Locked, in one fixed order, when paying: a tab another till is paying
  // right now is waited for and read again, never paid twice.
  return tx ? q.for("update") : q;
}

/** This customer's total owed, open tab count and oldest date — nothing else. */
export async function customerCreditSummary(orgId: string, customerId: string): Promise<CustomerCreditSummary> {
  const rows = await openTabs(orgId, customerId);
  return summariseCustomerCredit(
    customerId,
    rows.map((r) => ({ amountOutstanding: r.amountOutstanding, givenOn: r.givenOn ? String(r.givenOn) : null })),
  );
}

export type CustomerPaymentResult = {
  applied: Array<{ orderId: string; amount: number }>;
  amountApplied: number;
  remainingOwed: number;
};

/**
 * Records `amount` against the customer's open tabs, oldest first.
 *
 * Refuses more than is owed before anything is written. Each slice goes
 * through `recordCreditPayment`, which locks its tab and re-checks what is
 * outstanding, so two tills paying the same tab at once cannot overpay it.
 */
export async function payCustomerCredit(input: {
  orgId: string;
  customerId: string;
  amount: number;
  method: string;
  paidOn?: string;
  recordedByUserId?: string | null;
  note?: string | null;
  shiftId?: string | null;
}): Promise<CustomerPaymentResult> {
  if (!(round(input.amount) > 0)) throw new CreditError("Enter how much the customer paid.", 400, "CREDIT_AMOUNT_INVALID");
  // One transaction: a payment spread over several tabs is recorded whole or
  // not at all, so an error never leaves part of the money on the ledger (and
  // in the drawer's expected cash) while the till says it failed.
  return db.transaction((tx) => payCustomerCreditIn(tx, input));
}

async function payCustomerCreditIn(
  tx: CreditLedgerTx,
  input: Parameters<typeof payCustomerCredit>[0],
): Promise<CustomerPaymentResult> {
  let remaining = round(input.amount);
  const owing = await openTabs(input.orgId, input.customerId, tx);
  const owed = round(owing.reduce((sum, r) => sum + parseFloat(String(r.amountOutstanding)), 0));
  if (remaining > owed) {
    throw new CreditError(
      `That is more than this customer owes. £${owed.toFixed(2)} is outstanding.`,
      400,
      "CREDIT_OVERPAYMENT",
    );
  }

  const applied: Array<{ orderId: string; amount: number }> = [];
  for (const row of owing) {
    if (remaining <= 0) break;
    const outstanding = parseFloat(String(row.amountOutstanding));
    const amount = round(Math.min(outstanding, remaining));
    if (amount <= 0) continue;
    await recordCreditPayment({
      orgId: input.orgId,
      orderId: row.orderId,
      amount,
      method: input.method,
      paidOn: input.paidOn,
      recordedByUserId: input.recordedByUserId ?? null,
      note: input.note ?? null,
      shiftId: input.shiftId ?? null,
    }, tx);
    applied.push({ orderId: row.orderId, amount });
    remaining = round(remaining - amount);
  }

  const amountApplied = round(applied.reduce((sum, a) => sum + a.amount, 0));
  return { applied, amountApplied, remainingOwed: round(owed - amountApplied) };
}
