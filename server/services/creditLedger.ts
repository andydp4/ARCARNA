import { db } from "../db";
import { goodsShareOfTotal, storedDeliveryFee } from "@shared/orders/deliveryFee";
import {
  cashierCommissionEntries,
  cashierProfiles,
  creditPayments,
  orderCredit,
  orderExpenses as orderExpensesTable,
  orderItems,
  orderPayments,
  orders,
  organizations,
  products,
  refunds,
  shifts,
  users,
  type OrderCredit,
} from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  buildOrderCommission,
  commissionParty,
  roundMoney,
} from "@shared/reports/orderCommission";
import { currentTradingDay } from "@shared/time/tradingDay";
import { commissionCostBasis, lineUnitCost } from "@shared/pricing/lineSnapshot";
import { resolveCommissionRate } from "./cashierShiftEngine";
import { issueInvoiceForOrder } from "./invoices";

type CreditLedgerDb = Pick<typeof db, "select" | "insert" | "update">;
/** A transaction handle, for callers that record several payments as one. */
export type CreditLedgerTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The credit (tick) lifecycle.
 *
 * A sale on credit is two events on two different days. On completion day the
 * goods leave, the sale is recognised, and the balance joins the credit list —
 * no cash, no commission. On payment day the money arrives, the balance comes
 * down, and the commission is released for the share just paid.
 *
 * Commission follows the money, never the invoice. That is the whole point:
 * paying a cashier on the day they hand over goods on credit pays them for a
 * debt the business may never collect.
 */

export class CreditError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "CREDIT_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function tradingDayTodayForOrg(orgId: string, client: CreditLedgerDb = db): Promise<string> {
  const [org] = await client
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return currentTradingDay(org?.timezone ?? "Europe/London");
}

/**
 * How much of an order went on tick.
 *
 * Reads the tender legs, so a £100 sale paid £50 cash and £50 on credit puts
 * £50 on the list rather than £100. Falls back to the order's single payment
 * method for orders taken before split tender existed.
 *
 * `client` defaults to the module's own pooled `db`, same as
 * `openCreditForOrder` below — but the completion path (N3b,
 * `server/services/orderCompletion.ts`) always passes the LOCKED
 * transaction's client explicitly. Before N3b this read the order's payments
 * on a second, unrelated pool connection FROM INSIDE the PATCH route's own
 * transaction: with the pool capped at 10 connections
 * (`apps/server/src/db/index.ts`), roughly ten concurrent completions could
 * each hold one connection open waiting on the transaction's pool while
 * borrowing a second from the very pool they were blocking — a self-deadlock
 * under ordinary shop load (the brief's finding G4).
 */
export async function creditLegTotal(
  orderId: string,
  paymentMethod: string,
  orderTotal: number,
  client: CreditLedgerDb = db,
): Promise<number> {
  const legs = await client
    .select({ method: orderPayments.method, amount: orderPayments.amount })
    .from(orderPayments)
    .where(eq(orderPayments.orderId, orderId));

  if (legs.length === 0) {
    return paymentMethod.toLowerCase() === "tick" ? roundMoney(orderTotal) : 0;
  }
  return roundMoney(
    legs
      .filter((leg) => leg.method.toLowerCase() === "tick")
      .reduce((sum, leg) => sum + parseFloat(String(leg.amount)), 0),
  );
}

/**
 * Opens a credit record when a sale on tick completes.
 *
 * `order_credit` has exactly one row per order (its primary key IS the order
 * id), so this is an upsert rather than a plain insert. Two cases land here:
 *
 *  - the ordinary first completion, where no row exists yet — inserts one;
 *  - a re-completion after `reopen` voided the prior leg (N3b,
 *    "re-settlement on re-complete") — the row already exists, `voided`, and
 *    must come back to `outstanding` for the CURRENT tick amount rather than
 *    silently doing nothing. `onConflictDoNothing` (the pre-N3b behaviour)
 *    was written when completing an order twice was a genuine bug (the brief's
 *    finding G4) rather than an intended lifecycle step, and would leave a
 *    resettled credit sale permanently voided with no way to collect it.
 */
export async function openCreditForOrder(
  orgId: string,
  order: { id: string; customerId: string | null; amount: number },
  client: CreditLedgerDb = db,
): Promise<void> {
  if (order.amount <= 0) return;
  if (!order.customerId) {
    throw new CreditError(
      "Select a customer before putting a sale on credit.",
      400,
      "CREDIT_CUSTOMER_REQUIRED",
    );
  }
  const amount = String(roundMoney(order.amount));
  const givenOn = await tradingDayTodayForOrg(orgId, client);
  await client
    .insert(orderCredit)
    .values({
      orderId: order.id,
      orgId,
      customerId: order.customerId,
      amountGiven: amount,
      amountOutstanding: amount,
      status: "outstanding",
      givenOn,
    })
    .onConflictDoUpdate({
      target: orderCredit.orderId,
      set: {
        customerId: order.customerId,
        amountGiven: amount,
        amountOutstanding: amount,
        status: "outstanding",
        givenOn,
        settledOn: null,
        updatedAt: new Date(),
      },
    });

  // Money is owed, so the customer gets an invoice (v1.2 Phase 1C): numbered,
  // on the org's terms, in the same transaction as the tab it bills. A
  // re-completion keeps the number it was first given.
  await issueInvoiceForOrder(client, orgId, order.id);
}

type OrderCommissionBasis = {
  completerCashierId: string | null;
  inputterCashierId: string | null;
  completerUserId: string | null;
  inputterUserId: string | null;
  rate: number;
  settledTotal: number;
  /** The pool the order would pay if the whole balance were settled. */
  fullPool: number;
  creditCompleterAmount: number;
  creditInputterAmount: number;
};

/**
 * The commission this order would pay in full, priced as at the day it was
 * sold.
 *
 * It carries no share of the day's expenses. That is not an oversight: those
 * expenses were apportioned in full across the sales that actually brought
 * money in that day, and this one brought none, so charging it a share now
 * would count the same overheads twice.
 */
export async function commissionBasisFor(
  orderId: string,
  creditAmountGiven = 0,
  client: CreditLedgerDb = db,
): Promise<OrderCommissionBasis | null> {
  const [order] = await client.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const [org] = await client
    .select({
      defaultRate: organizations.defaultCashierCommissionRate,
      deliveryFeeCommissionable: organizations.deliveryFeeCommissionable,
    })
    .from(organizations)
    .where(eq(organizations.id, order.orgId))
    .limit(1);

  // Most specific rate wins: the completing user's own, then the cashier code's
  // for orders taken before users were attributed, then the org default.
  const [cashier] = order.completedCashierId
    ? await client
        .select({ rate: cashierProfiles.defaultCommissionRate })
        .from(cashierProfiles)
        .where(eq(cashierProfiles.id, order.completedCashierId))
        .limit(1)
    : [undefined];
  const [completer] = order.completedUserId
    ? await client
        .select({ rate: users.commissionRate })
        .from(users)
        .where(eq(users.id, order.completedUserId))
        .limit(1)
    : [undefined];
  const rate = resolveCommissionRate({
    userRate: completer?.rate,
    cashierRate: cashier?.rate,
    orgRate: org?.defaultRate,
  });

  // Sale-time cost snapshots (PRC-06); a line with no known cost is left out
  // of commission, its revenue with it (owner Q5, "cost missing").
  const itemRows = await client
    .select({
      quantity: orderItems.quantity,
      totalPrice: orderItems.totalPrice,
      listPrice: orderItems.listPrice,
      unitCost: orderItems.unitCost,
      costPrice: products.costPrice,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId));
  const basis = commissionCostBasis(
    itemRows.map((i) => ({
      quantity: Number(i.quantity),
      lineTotal: parseFloat(String(i.totalPrice)) || 0,
      unitCost: lineUnitCost(i, i.costPrice),
    })),
  );
  const stockCost = basis.stockCost;

  const expenseRows = await client
    .select({ amount: orderExpensesTable.amount })
    .from(orderExpensesTable)
    .where(eq(orderExpensesTable.orderId, orderId));
  const expenses = expenseRows.reduce((sum, r) => sum + parseFloat(String(r.amount)), 0);

  const refundRows = await client
    .select({ total: refunds.total, fee: refunds.deliveryFee })
    .from(refunds)
    .where(eq(refunds.orderId, orderId));
  // A refunded delivery fee earned no commission (unless the admin counts
  // the fee), so it takes none back (v1.2.1).
  const feeCounted = org?.deliveryFeeCommissionable === true;
  const refundTotal = refundRows.reduce(
    (sum, r) =>
      sum + Math.max(0, parseFloat(String(r.total)) - (feeCounted ? 0 : Math.max(0, parseFloat(String(r.fee ?? 0)) || 0))),
    0,
  );

  // Only the known-cost share of what was collected earns commission.
  const settled = parseFloat(String(order.settledTotal ?? order.total));
  // The delivery fee is left out unless the admin counts it (v1.2.1); the
  // credit part below scales by the same share, so a repayment never pays
  // commission on the fee either.
  const goodsShare = goodsShareOfTotal(settled, storedDeliveryFee(order), {
    commissionable: org?.deliveryFeeCommissionable === true,
    vatRatePercent: Number(order.vatRate ?? 0) || 0,
  });
  const commissionable = settled * goodsShare * basis.knownShare;
  const commissionInput = {
    orderId,
    stockCost,
    orderExpenses: expenses,
    overheadShare: 0,
    refunds: refundTotal,
    completerCashierId: order.completedCashierId,
    inputterCashierId: order.inputCashierId,
    completerUserId: order.completedUserId,
    inputterUserId: order.inputUserId,
  };
  const result = buildOrderCommission(
    {
      ...commissionInput,
      paidContribution: commissionable,
    },
    rate,
  );
  const upfrontResult = buildOrderCommission(
    {
      ...commissionInput,
      paidContribution: Math.max(0, commissionable - roundMoney(creditAmountGiven) * goodsShare * basis.knownShare),
    },
    rate,
  );

  const fullCompleter = result.entries.find((e) => e.role === "completer")?.amount ?? 0;
  const fullInputter = result.entries.find((e) => e.role === "inputter")?.amount ?? 0;
  const upfrontCompleter = upfrontResult.entries.find((e) => e.role === "completer")?.amount ?? 0;
  const upfrontInputter = upfrontResult.entries.find((e) => e.role === "inputter")?.amount ?? 0;

  return {
    completerCashierId: order.completedCashierId,
    inputterCashierId: order.inputCashierId,
    completerUserId: order.completedUserId,
    inputterUserId: order.inputUserId,
    rate,
    settledTotal: settled,
    fullPool: result.pool,
    creditCompleterAmount: Math.max(0, roundMoney(fullCompleter - upfrontCompleter)),
    creditInputterAmount: Math.max(0, roundMoney(fullInputter - upfrontInputter)),
  };
}

/**
 * What has already been released to each party from credit payments.
 *
 * Keyed by party rather than by cashier code: a codeless entry would otherwise
 * key as "null:completer", so a second payment against the same tick would
 * compare against the wrong running total.
 */
async function accruedResolutionByRole(
  orderId: string,
  client: CreditLedgerDb = db,
): Promise<Map<string, number>> {
  const rows = await client
    .select({
      cashierId: cashierCommissionEntries.cashierId,
      userId: cashierCommissionEntries.userId,
      role: cashierCommissionEntries.role,
      amount: cashierCommissionEntries.amount,
    })
    .from(cashierCommissionEntries)
    .where(
      and(
        eq(cashierCommissionEntries.orderId, orderId),
        eq(cashierCommissionEntries.basis, "credit_resolution"),
        isNull(cashierCommissionEntries.reversalOf),
      ),
    );
  const byRole = new Map<string, number>();
  for (const row of rows) {
    const key = `${commissionParty(row.userId, row.cashierId)}:${row.role}`;
    byRole.set(key, roundMoney((byRole.get(key) ?? 0) + parseFloat(String(row.amount))));
  }
  return byRole;
}

export type RecordPaymentInput = {
  orgId: string;
  orderId: string;
  amount: number;
  method: string;
  paidOn?: string;
  recordedByUserId?: string | null;
  note?: string | null;
  /**
   * The recorder's open till shift, when the payment is taken today (v1.2
   * Phase 1C). A cash payment stamped to it is part of that drawer's expected
   * cash. Ignored for a backdated payment — that money went into a drawer
   * already counted — and dropped if the shift has closed in the meantime.
   */
  shiftId?: string | null;
};

/**
 * Records a payment against a credit sale and releases the commission it earns.
 *
 * Commission is released in proportion to how much of the debt has been paid,
 * cumulatively rather than per instalment: each payment tops the cashier up to
 * what they should have earned by now. That is what guarantees a fully settled
 * order has released exactly its whole pool — a per-instalment split would let
 * rounding leave a penny behind on an awkward three-way split.
 */
export async function recordCreditPayment(input: RecordPaymentInput, outerTx?: CreditLedgerTx): Promise<OrderCredit> {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new CreditError("A payment must be more than zero", 400, "CREDIT_AMOUNT_INVALID");

  // Inside a caller's transaction (a payment spread over several tabs), every
  // slice commits or none does.
  const run = async (tx: CreditLedgerTx): Promise<OrderCredit> => {
    const [credit] = await tx
      .select()
      .from(orderCredit)
      .where(and(eq(orderCredit.orderId, input.orderId), eq(orderCredit.orgId, input.orgId)))
      .for("update")
      .limit(1);
    if (!credit) throw new CreditError("No credit is recorded against this order", 404, "CREDIT_NOT_FOUND");
    if (credit.status === "voided" || credit.status === "written_off") {
      throw new CreditError(`This credit is ${credit.status.replace("_", " ")}`, 409, "CREDIT_CLOSED");
    }

    const outstanding = roundMoney(parseFloat(String(credit.amountOutstanding)));
    if (amount > outstanding) {
      throw new CreditError(
        `That is more than is outstanding. £${outstanding.toFixed(2)} is left to pay.`,
        400,
        "CREDIT_OVERPAYMENT",
      );
    }

    const paidOn = input.paidOn ?? await tradingDayTodayForOrg(input.orgId, tx);
    const shiftId = input.paidOn ? null : await liveShiftId(input.orgId, input.shiftId ?? null, tx);
    const [payment] = await tx
      .insert(creditPayments)
      .values({
        orgId: input.orgId,
        orderId: input.orderId,
        amount: String(amount),
        method: input.method,
        paidOn,
        recordedByUserId: input.recordedByUserId ?? null,
        note: input.note ?? null,
        shiftId,
      })
      .returning();

    const newOutstanding = roundMoney(outstanding - amount);
    const [updated] = await tx
      .update(orderCredit)
      .set({
        amountOutstanding: String(newOutstanding),
        status: newOutstanding <= 0 ? "settled" : "partial",
        settledOn: newOutstanding <= 0 ? paidOn : null,
        updatedAt: new Date(),
      })
      .where(and(eq(orderCredit.orderId, input.orderId), eq(orderCredit.orgId, input.orgId)))
      .returning();

    await releaseCommission(input.orgId, input.orderId, payment.id, paidOn, credit, newOutstanding, tx);
    return updated;
  };
  return outerTx ? run(outerTx) : db.transaction(run);
}

/**
 * The shift to stamp, if it is still this org's and still open. Read with a
 * share lock so a close running alongside waits for this payment rather than
 * counting the drawer without it.
 */
async function liveShiftId(orgId: string, shiftId: string | null, client: CreditLedgerDb): Promise<string | null> {
  if (!shiftId) return null;
  const [live] = await client
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.orgId, orgId), inArray(shifts.status, ["open", "reopened"])))
    .for("share")
    .limit(1);
  return live?.id ?? null;
}

async function releaseCommission(
  orgId: string,
  orderId: string,
  creditPaymentId: string,
  paidOn: string,
  credit: OrderCredit,
  newOutstanding: number,
  client: CreditLedgerDb = db,
): Promise<void> {
  const given = roundMoney(parseFloat(String(credit.amountGiven)));
  if (given <= 0) return;

  const basis = await commissionBasisFor(orderId, given, client);
  if (!basis || basis.fullPool <= 0) return;

  // Cumulative fraction of the credit leg now paid. The non-credit portion is
  // sale-basis commission; this payment only releases the credit component.
  const settledFraction =
    newOutstanding <= 0
      ? 1
      : Math.max(0, Math.min(1, roundMoney(given - newOutstanding) / given));

  const already = await accruedResolutionByRole(orderId, client);
  const targets: Array<{
    cashierId: string | null;
    userId: string | null;
    role: "completer" | "inputter";
    full: number;
    sharePercent: number;
  }> = [];

  const completerId = basis.completerCashierId;
  const inputterId = basis.inputterCashierId;
  // Compared by party, for the same reason buildOrderCommission is: on a
  // codeless order both codes are null, and comparing those would fold the
  // inputter's tenth into the completer's share even when two people were
  // involved.
  const completerParty = commissionParty(basis.completerUserId, completerId);
  const inputterParty = commissionParty(basis.inputterUserId, inputterId);
  if (!completerParty) return;
  if (!inputterParty || inputterParty === completerParty) {
    targets.push({
      cashierId: completerId,
      userId: basis.completerUserId,
      role: "completer",
      full: roundMoney(basis.creditCompleterAmount + basis.creditInputterAmount),
      sharePercent: 100,
    });
  } else {
    targets.push({
      cashierId: completerId,
      userId: basis.completerUserId,
      role: "completer",
      full: basis.creditCompleterAmount,
      sharePercent: 90,
    });
    if (basis.creditInputterAmount > 0) {
      targets.push({
        cashierId: inputterId,
        userId: basis.inputterUserId,
        role: "inputter",
        full: basis.creditInputterAmount,
        sharePercent: 10,
      });
    }
  }

  const rows = targets
    .map((target) => {
      const shouldHave = roundMoney(target.full * settledFraction);
      const key = `${commissionParty(target.userId, target.cashierId)}:${target.role}`;
      // Only the credit component is released here. The upfront tender legs of
      // a split sale earn sale-basis commission at shift close, whether that
      // has happened yet or not, so they are excluded from the pool above
      // rather than netted off after the fact.
      const delta = roundMoney(shouldHave - (already.get(key) ?? 0));
      return { target, delta };
    })
    .filter(({ delta }) => delta > 0)
    .map(({ target, delta }) => ({
      orgId,
      orderId,
      cashierId: target.cashierId,
      userId: target.userId,
      cashierShiftId: null,
      creditPaymentId,
      role: target.role,
      basis: "credit_resolution" as const,
      orderMargin: "0",
      overheadShare: "0",
      commissionRate: String(basis.rate),
      sharePercent: String(target.sharePercent),
      amount: String(delta),
      accruedOn: paidOn,
    }));

  if (rows.length > 0) {
    await client.insert(cashierCommissionEntries).values(rows).onConflictDoNothing();
  }
}

/**
 * Writes a debt off. It comes off outstanding, is recorded as closed, and
 * accrues no commission — nobody earns on money that never arrived.
 */
export async function writeOffCredit(orgId: string, orderId: string): Promise<OrderCredit> {
  const [updated] = await db
    .update(orderCredit)
    .set({ amountOutstanding: "0", status: "written_off", updatedAt: new Date() })
    .where(
      and(
        eq(orderCredit.orderId, orderId),
        eq(orderCredit.orgId, orgId),
        inArray(orderCredit.status, ["outstanding", "partial"]),
      ),
    )
    .returning();
  if (updated) return updated;

  const [existing] = await db
    .select({ status: orderCredit.status })
    .from(orderCredit)
    .where(and(eq(orderCredit.orderId, orderId), eq(orderCredit.orgId, orgId)))
    .limit(1);
  if (existing) {
    throw new CreditError(
      `This credit is ${String(existing.status).replace("_", " ")}`,
      409,
      "CREDIT_CLOSED",
    );
  }
  throw new CreditError("No credit is recorded against this order", 404, "CREDIT_NOT_FOUND");
}

/**
 * Voids an unpaid credit — the goods came back before it was paid.
 *
 * Nothing is clawed back because nothing accrued, which is exactly why
 * commission waits for the money in the first place.
 *
 * `client` defaults to the module's pooled `db` for the standalone admin
 * route (`server/routes/credit.ts`), but `reopenOrderTx`
 * (`server/services/orderCompletion.ts`, N3b) always passes the reopen
 * transaction's own client: voiding the credit leg must commit or roll back
 * with the status flip and the `reopened` event, not as a separate,
 * uncoordinated statement that could survive a later rollback of the rest of
 * the reopen.
 */
export async function voidCredit(
  orgId: string,
  orderId: string,
  client: CreditLedgerDb = db,
): Promise<OrderCredit> {
  const [credit] = await client
    .select()
    .from(orderCredit)
    .where(and(eq(orderCredit.orderId, orderId), eq(orderCredit.orgId, orgId)))
    .limit(1);
  if (!credit) throw new CreditError("No credit is recorded against this order", 404, "CREDIT_NOT_FOUND");
  if (roundMoney(parseFloat(String(credit.amountGiven))) !== roundMoney(parseFloat(String(credit.amountOutstanding)))) {
    throw new CreditError(
      "Some of this credit has already been paid. Refund it rather than voiding it.",
      409,
      "CREDIT_PARTIALLY_PAID",
    );
  }
  const [updated] = await client
    .update(orderCredit)
    .set({ amountOutstanding: "0", status: "voided", updatedAt: new Date() })
    .where(eq(orderCredit.orderId, orderId))
    .returning();
  return updated;
}

/** Everything still owed, newest first, for the credit list. */
export async function outstandingCredit(orgId: string) {
  return db
    .select({
      orderId: orderCredit.orderId,
      customerId: orderCredit.customerId,
      amountGiven: orderCredit.amountGiven,
      amountOutstanding: orderCredit.amountOutstanding,
      status: orderCredit.status,
      givenOn: orderCredit.givenOn,
    })
    .from(orderCredit)
    .where(and(eq(orderCredit.orgId, orgId), inArray(orderCredit.status, ["outstanding", "partial"])))
    .orderBy(sql`${orderCredit.givenOn} DESC`);
}
