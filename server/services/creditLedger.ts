import { db } from "../db";
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
  users,
  type OrderCredit,
} from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  buildOrderCommission,
  commissionParty,
  roundMoney,
} from "@shared/reports/orderCommission";
import { resolveCommissionRate } from "./cashierShiftEngine";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CreditDb = typeof db | DbTx;

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * How much of an order went on tick.
 *
 * Reads the tender legs, so a £100 sale paid £50 cash and £50 on credit puts
 * £50 on the list rather than £100. Falls back to the order's single payment
 * method for orders taken before split tender existed.
 */
export async function creditLegTotal(
  orderId: string,
  paymentMethod: string,
  orderTotal: number,
): Promise<number> {
  const legs = await db
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
 * Idempotent — completing an order twice must not double the debt.
 */
export async function openCreditForOrder(
  orgId: string,
  order: { id: string; customerId: string | null; amount: number },
): Promise<void> {
  if (order.amount <= 0) return;
  if (!order.customerId) {
    throw new CreditError(
      "Select a customer before putting a sale on credit.",
      400,
      "CREDIT_CUSTOMER_REQUIRED",
    );
  }
  await db
    .insert(orderCredit)
    .values({
      orderId: order.id,
      orgId,
      customerId: order.customerId,
      amountGiven: String(roundMoney(order.amount)),
      amountOutstanding: String(roundMoney(order.amount)),
      status: "outstanding",
      givenOn: today(),
    })
    .onConflictDoNothing();
}

type OrderCommissionBasis = {
  completerCashierId: string | null;
  inputterCashierId: string | null;
  completerUserId: string | null;
  inputterUserId: string | null;
  rate: number;
  /** The pool the order would pay if the whole balance were settled. */
  fullPool: number;
  completerAmount: number;
  inputterAmount: number;
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
async function commissionBasisFor(orderId: string, client: CreditDb = db): Promise<OrderCommissionBasis | null> {
  const [order] = await client.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const [org] = await client
    .select({ defaultRate: organizations.defaultCashierCommissionRate })
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

  const itemRows = await client
    .select({ quantity: orderItems.quantity, costPrice: products.costPrice })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId));
  const stockCost = itemRows.reduce(
    (sum, i) => sum + (i.costPrice == null ? 0 : Number(i.quantity) * parseFloat(String(i.costPrice))),
    0,
  );

  const expenseRows = await client
    .select({ amount: orderExpensesTable.amount })
    .from(orderExpensesTable)
    .where(eq(orderExpensesTable.orderId, orderId));
  const expenses = expenseRows.reduce((sum, r) => sum + parseFloat(String(r.amount)), 0);

  const refundRows = await client
    .select({ total: refunds.total })
    .from(refunds)
    .where(eq(refunds.orderId, orderId));
  const refundTotal = refundRows.reduce((sum, r) => sum + Math.max(0, parseFloat(String(r.total))), 0);

  const settled = parseFloat(String(order.settledTotal ?? order.total));
  const result = buildOrderCommission(
    {
      orderId,
      paidContribution: settled,
      stockCost,
      orderExpenses: expenses,
      overheadShare: 0,
      refunds: refundTotal,
      completerCashierId: order.completedCashierId,
      inputterCashierId: order.inputCashierId,
      completerUserId: order.completedUserId,
      inputterUserId: order.inputUserId,
    },
    rate,
  );

  return {
    completerCashierId: order.completedCashierId,
    inputterCashierId: order.inputCashierId,
    completerUserId: order.completedUserId,
    inputterUserId: order.inputUserId,
    rate,
    fullPool: result.pool,
    completerAmount: result.entries.find((e) => e.role === "completer")?.amount ?? 0,
    inputterAmount: result.entries.find((e) => e.role === "inputter")?.amount ?? 0,
  };
}

/**
 * What has already been released to each party for this order's credit.
 *
 * Keyed by party rather than by cashier code: a codeless entry would otherwise
 * key as "null:completer", so a second payment against the same tick would
 * compare against the wrong running total.
 */
async function accruedResolutionByRole(orderId: string, client: CreditDb = db): Promise<Map<string, number>> {
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
export async function recordCreditPayment(input: RecordPaymentInput): Promise<OrderCredit> {
  const amount = roundMoney(input.amount);
  if (!(amount > 0)) throw new CreditError("A payment must be more than zero", 400, "CREDIT_AMOUNT_INVALID");

  return db.transaction(async (tx) => {
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

    const paidOn = input.paidOn ?? today();
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
  });
}

async function releaseCommission(
  orgId: string,
  orderId: string,
  creditPaymentId: string,
  paidOn: string,
  credit: OrderCredit,
  newOutstanding: number,
  client: CreditDb = db,
): Promise<void> {
  const basis = await commissionBasisFor(orderId, client);
  if (!basis || basis.fullPool <= 0) return;

  const given = roundMoney(parseFloat(String(credit.amountGiven)));
  if (given <= 0) return;
  // Cumulative fraction of the debt now settled. Exactly 1 on full settlement,
  // which is what makes the released total land on the pool to the penny.
  const settledFraction = newOutstanding <= 0 ? 1 : roundMoney(given - newOutstanding) / given;

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
      full: basis.fullPool,
      sharePercent: 100,
    });
  } else {
    targets.push({
      cashierId: completerId,
      userId: basis.completerUserId,
      role: "completer",
      full: basis.completerAmount,
      sharePercent: 90,
    });
    if (basis.inputterAmount > 0) {
      targets.push({
        cashierId: inputterId,
        userId: basis.inputterUserId,
        role: "inputter",
        full: basis.inputterAmount,
        sharePercent: 10,
      });
    }
  }

  const rows = targets
    .map((target) => {
      const shouldHave = roundMoney(target.full * settledFraction);
      const key = `${commissionParty(target.userId, target.cashierId)}:${target.role}`;
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
    .where(and(eq(orderCredit.orderId, orderId), eq(orderCredit.orgId, orgId)))
    .returning();
  if (!updated) throw new CreditError("No credit is recorded against this order", 404, "CREDIT_NOT_FOUND");
  return updated;
}

/**
 * Voids an unpaid credit — the goods came back before it was paid.
 *
 * Nothing is clawed back because nothing accrued, which is exactly why
 * commission waits for the money in the first place.
 */
export async function voidCredit(orgId: string, orderId: string): Promise<OrderCredit> {
  const [credit] = await db
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
  const [updated] = await db
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
