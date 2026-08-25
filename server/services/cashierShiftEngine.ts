import { db } from "../db";
import {
  cashierProfiles,
  cashierShifts,
  cashierShiftSummaries,
  orderCredit,
  orders,
  orderItems,
  products,
  orderExpenses as orderExpensesTable,
  overheadExpenses,
  refunds,
  organizations,
  type CashierShift,
  type CashierShiftSummary,
  type CashierProfile,
} from "@shared/schema";
import { and, eq, gte, lt, lte, or, isNull, inArray, sql } from "drizzle-orm";
import { accrueShiftCommission, type ShiftCommissionOrder } from "./commissionLedger";
import {
  buildCashierShiftBalanceSheet,
  allocateGlobalExpenseShare,
  dailyOverheadTotal,
  utcDateKey,
  type CashierShiftOrder,
} from "@shared/reports/cashierShiftReport";

export class CashierShiftError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "CASHIER_SHIFT_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function effectiveCommissionRate(
  cashier: Pick<CashierProfile, "defaultCommissionRate">,
  org: { defaultCashierCommissionRate: string | number | null },
): number {
  const cashierRate = cashier.defaultCommissionRate;
  if (cashierRate != null) return parseFloat(String(cashierRate));
  const orgRate = org.defaultCashierCommissionRate;
  return orgRate != null ? parseFloat(String(orgRate)) : 0;
}

export async function getOpenCashierShift(
  orgId: string,
  cashierId: string,
): Promise<CashierShift | null> {
  const [open] = await db
    .select()
    .from(cashierShifts)
    .where(
      and(
        eq(cashierShifts.orgId, orgId),
        eq(cashierShifts.cashierId, cashierId),
        eq(cashierShifts.status, "open"),
      ),
    )
    .limit(1);
  return open ?? null;
}

export async function startCashierShift(
  orgId: string,
  cashierId: string,
  openedByUserId: string,
): Promise<CashierShift> {
  const [cashier] = await db
    .select()
    .from(cashierProfiles)
    .where(and(eq(cashierProfiles.id, cashierId), eq(cashierProfiles.orgId, orgId)))
    .limit(1);
  if (!cashier) throw new CashierShiftError("Cashier profile not found", 404, "CASHIER_NOT_FOUND");
  if (!cashier.isActive) throw new CashierShiftError("Cashier profile is deactivated", 400, "CASHIER_INACTIVE");

  const existing = await getOpenCashierShift(orgId, cashierId);
  if (existing) throw new CashierShiftError("Cashier already has an open shift", 409, "SHIFT_ALREADY_OPEN");

  const [created] = await db
    .insert(cashierShifts)
    .values({ orgId, cashierId, openedByUserId, status: "open" })
    .returning();
  return created;
}

/** Bumps last-activity timestamp on a cashier shift; used to keep it alive against auto-close. */
export async function touchCashierShiftActivity(shiftId: string): Promise<void> {
  await db
    .update(cashierShifts)
    .set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(and(eq(cashierShifts.id, shiftId), eq(cashierShifts.status, "open")));
}

type ShiftOrderRow = {
  id: string;
  total: string;
  paymentMethod: string;
  status: string | null;
  createdAt: Date | null;
  completedCashierId: string | null;
  inputCashierId: string | null;
};

/**
 * A shift's orders for money purposes.
 *
 * An order belongs to the shift that COMPLETED it, not the one that created
 * it — that is the shift whose drawer took the payment, and whose cashier earns
 * the 90% share. An order still open has not been completed by anyone, so it
 * stays with the shift that loaded it, exactly as before (migration 051
 * backfills the completing shift for every historic order, so closed shifts
 * decompose to the same set of orders they always did).
 */
async function loadShiftOrders(shiftId: string): Promise<ShiftOrderRow[]> {
  return db
    .select({
      id: orders.id,
      total: orders.total,
      paymentMethod: orders.paymentMethod,
      status: orders.status,
      createdAt: orders.createdAt,
      completedCashierId: orders.completedCashierId,
      inputCashierId: orders.inputCashierId,
    })
    .from(orders)
    .where(eq(sql`COALESCE(${orders.completedCashierShiftId}, ${orders.cashierShiftId})`, shiftId));
}

async function loadOrdersWithCosts(orderIds: string[]): Promise<Map<string, { costPrice: number | null; quantity: number }[]>> {
  const map = new Map<string, { costPrice: number | null; quantity: number }[]>();
  if (orderIds.length === 0) return map;
  const rows = await db
    .select({
      orderId: orderItems.orderId,
      quantity: orderItems.quantity,
      costPrice: products.costPrice,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(inArray(orderItems.orderId, orderIds));
  for (const row of rows) {
    if (!row.orderId) continue;
    const list = map.get(row.orderId) ?? [];
    list.push({
      quantity: row.quantity,
      costPrice: row.costPrice != null ? parseFloat(String(row.costPrice)) : null,
    });
    map.set(row.orderId, list);
  }
  return map;
}

async function loadOrderExpensesByOrder(orderIds: string[]): Promise<Map<string, number>> {
  const byOrder = new Map<string, number>();
  if (orderIds.length === 0) return byOrder;
  const rows = await db
    .select({ orderId: orderExpensesTable.orderId, amount: orderExpensesTable.amount })
    .from(orderExpensesTable)
    .where(inArray(orderExpensesTable.orderId, orderIds));
  for (const row of rows) {
    if (!row.orderId) continue;
    byOrder.set(row.orderId, (byOrder.get(row.orderId) ?? 0) + parseFloat(String(row.amount)));
  }
  return byOrder;
}

async function loadRefundsByOrder(orderIds: string[]): Promise<Map<string, number>> {
  const byOrder = new Map<string, number>();
  if (orderIds.length === 0) return byOrder;
  const rows = await db
    .select({ orderId: refunds.orderId, total: refunds.total })
    .from(refunds)
    .where(inArray(refunds.orderId, orderIds));
  for (const row of rows) {
    if (!row.orderId) continue;
    byOrder.set(row.orderId, (byOrder.get(row.orderId) ?? 0) + Math.max(0, parseFloat(String(row.total))));
  }
  return byOrder;
}

function isTickPayment(method: string): boolean {
  return method.toLowerCase() === "tick";
}

/**
 * Paid sales received for a set of orders: gross total, less whatever is still
 * outstanding on credit.
 *
 * The outstanding figure comes from the order's credit record, never from its
 * status. A credit sale is completed the day the goods leave and unpaid until
 * the customer settles, so reading status here would count every tick sale as
 * money received the moment it completed.
 */
function paidSalesReceivedFor(
  rows: { id?: string; total: string; paymentMethod: string; status: string | null }[],
  outstandingByOrder?: Map<string, number>,
): number {
  let gross = 0;
  let unpaid = 0;
  for (const row of rows) {
    const total = parseFloat(String(row.total));
    gross += total;
    const outstanding = row.id !== undefined ? outstandingByOrder?.get(row.id) : undefined;
    if (outstanding !== undefined) {
      unpaid += Math.max(0, outstanding);
    } else if (isTickPayment(row.paymentMethod) && row.status !== "completed") {
      // Legacy fallback for orders with no credit record (pre-migration 053).
      unpaid += total;
    }
  }
  return gross - unpaid;
}

/** What is still owed on each of these orders, from their credit records. */
async function loadOutstandingCredit(orderIds: string[]): Promise<Map<string, number>> {
  const byOrder = new Map<string, number>();
  if (orderIds.length === 0) return byOrder;
  const rows = await db
    .select({ orderId: orderCredit.orderId, outstanding: orderCredit.amountOutstanding })
    .from(orderCredit)
    .where(inArray(orderCredit.orderId, orderIds));
  for (const row of rows) byOrder.set(row.orderId, parseFloat(String(row.outstanding)));
  return byOrder;
}

/** Org-wide paid sales received for a single UTC calendar day (all cashiers/channels). */
async function orgPaidSalesReceivedForDay(orgId: string, dayStart: Date, dayEnd: Date): Promise<number> {
  const rows = await db
    .select({
      id: orders.id,
      total: orders.total,
      paymentMethod: orders.paymentMethod,
      status: orders.status,
      outstanding: orderCredit.amountOutstanding,
    })
    .from(orders)
    .leftJoin(orderCredit, eq(orderCredit.orderId, orders.id))
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, dayStart), lt(orders.createdAt, dayEnd)));
  const outstanding = new Map<string, number>();
  for (const row of rows) {
    if (row.outstanding != null) outstanding.set(row.id, parseFloat(String(row.outstanding)));
  }
  return paidSalesReceivedFor(rows, outstanding);
}

async function dailyGlobalExpensesForDay(orgId: string, dayStart: Date, dayEnd: Date): Promise<number> {
  const rows = await db
    .select({ amount: overheadExpenses.amount, frequency: overheadExpenses.frequency })
    .from(overheadExpenses)
    .where(
      and(
        eq(overheadExpenses.orgId, orgId),
        eq(overheadExpenses.isActive, 1),
        lte(overheadExpenses.startDate, dayEnd),
        or(isNull(overheadExpenses.endDate), gte(overheadExpenses.endDate, dayStart)),
      ),
    );
  return dailyOverheadTotal(rows.map((r) => ({ amount: parseFloat(String(r.amount)), frequency: r.frequency })));
}

function dayBounds(dateKey: string): { start: Date; end: Date } {
  const start = new Date(`${dateKey}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Computes (without persisting) the balance sheet for a cashier shift.
 * Global expenses are allocated per calendar day the shift's orders fall on,
 * proportional to this shift's paid sales vs. the org's total paid sales that
 * day — correctly handling overnight/multi-day shifts and no-sales days.
 */
export async function computeCashierShiftBalanceSheet(orgId: string, shift: CashierShift) {
  const [cashier] = await db
    .select()
    .from(cashierProfiles)
    .where(eq(cashierProfiles.id, shift.cashierId))
    .limit(1);
  if (!cashier) throw new CashierShiftError("Cashier profile not found", 404, "CASHIER_NOT_FOUND");

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new CashierShiftError("Organization not found", 404, "ORG_NOT_FOUND");

  const orderRows = await loadShiftOrders(shift.id);
  const orderIds = orderRows.map((o) => o.id);
  const costsByOrder = await loadOrdersWithCosts(orderIds);
  const expensesByOrder = await loadOrderExpensesByOrder(orderIds);
  const refundsByOrder = await loadRefundsByOrder(orderIds);
  const outstandingByOrder = await loadOutstandingCredit(orderIds);
  const orderExpensesTotal = [...expensesByOrder.values()].reduce((sum, v) => sum + v, 0);
  const refundRows = [...refundsByOrder.values()].map((total) => ({ total }));

  const shiftOrders: CashierShiftOrder[] = orderRows.map((o) => ({
    id: o.id,
    total: parseFloat(String(o.total)),
    paymentMethod: o.paymentMethod,
    status: o.status ?? "pending",
    createdAt: (o.createdAt ?? new Date()).toISOString(),
    creditOutstanding: outstandingByOrder.get(o.id),
    items: (costsByOrder.get(o.id) ?? []).map((i) => ({ quantity: i.quantity, costPrice: i.costPrice })),
  }));

  // Bucket the shift's orders by UTC calendar day to allocate global expenses per-day.
  const dayKeys = new Set<string>(shiftOrders.map((o) => utcDateKey(o.createdAt)));
  if (dayKeys.size === 0) dayKeys.add(utcDateKey((shift.closedAt ?? new Date()).toISOString()));

  let globalExpenseAllocation = 0;
  // Kept per day, not just summed: the commission ledger apportions each day's
  // share across that day's orders, and a shift can span midnight.
  const allocationByDay = new Map<string, number>();
  for (const dayKey of dayKeys) {
    const { start, end } = dayBounds(dayKey);
    const shiftPaidForDay = paidSalesReceivedFor(
      orderRows.filter((o) => o.createdAt && utcDateKey(o.createdAt.toISOString()) === dayKey),
      outstandingByOrder,
    );
    const [orgPaidForDay, dailyExpenses] = await Promise.all([
      orgPaidSalesReceivedForDay(orgId, start, end),
      dailyGlobalExpensesForDay(orgId, start, end),
    ]);
    const dayShare = allocateGlobalExpenseShare(dailyExpenses, shiftPaidForDay, orgPaidForDay);
    allocationByDay.set(dayKey, dayShare);
    globalExpenseAllocation += dayShare;
  }

  const commissionRate = effectiveCommissionRate(cashier, org);

  const sheet = buildCashierShiftBalanceSheet(
    shiftOrders,
    orderExpensesTotal,
    globalExpenseAllocation,
    refundRows.map((r) => ({ total: parseFloat(String(r.total)) })),
    0,
    commissionRate,
  );

  // One input row per order for the commission ledger. `paidContribution` is
  // what actually came in: nothing for a credit sale still outstanding, which
  // is what defers its commission to the day it is paid.
  const commissionOrders: ShiftCommissionOrder[] = orderRows.map((row) => {
    const total = parseFloat(String(row.total));
    const outstanding = outstandingByOrder.get(row.id);
    const stillOwed =
      outstanding !== undefined
        ? Math.max(0, outstanding)
        : isTickPayment(row.paymentMethod) && row.status !== "completed"
          ? total
          : 0;
    const items = costsByOrder.get(row.id) ?? [];
    const stockCost = items.reduce(
      (sum, item) => sum + (item.costPrice == null ? 0 : item.quantity * item.costPrice),
      0,
    );
    return {
      orderId: row.id,
      paidContribution: Math.max(0, total - stillOwed),
      stockCost,
      orderExpenses: expensesByOrder.get(row.id) ?? 0,
      overheadShare: 0, // filled in by the ledger, which apportions per day
      refunds: refundsByOrder.get(row.id) ?? 0,
      completerCashierId: row.completedCashierId,
      inputterCashierId: row.inputCashierId,
      soldOn: utcDateKey((row.createdAt ?? new Date()).toISOString()),
    };
  });

  return { sheet, cashier, org, commissionOrders, allocationByDay };
}

type CashierShiftSummarySheet = Awaited<ReturnType<typeof computeCashierShiftBalanceSheet>>["sheet"];

/**
 * Replaces the sheet's formula-derived commission with what the ledger actually
 * accrued, and re-derives the retained profit from it.
 *
 * The two agree on a shift that took only cash and card. They diverge when a
 * shift sells on credit: the pool on an unpaid tick is real profit the business
 * keeps for now and owes the cashier later, so it shows as retained until the
 * customer pays.
 */
function withAccruedCommission(
  sheet: CashierShiftSummarySheet,
  accrued: number,
): CashierShiftSummarySheet {
  return {
    ...sheet,
    commissionAmount: accrued,
    businessRetainedProfit: Math.round((sheet.netSalesProfit - accrued) * 100) / 100,
  };
}

function cashierShiftSummaryValues(
  orgId: string,
  shift: CashierShift,
  sheet: CashierShiftSummarySheet,
  closedAt: Date,
) {
  return {
    orgId,
    shiftId: shift.id,
    cashierId: shift.cashierId,
    grossSales: String(sheet.grossSales),
    cashSales: String(sheet.cashSales),
    cardSales: String(sheet.cardSales),
    creditSales: String(sheet.creditSales),
    unpaidCreditSales: String(sheet.unpaidCreditSales),
    stockCost: String(sheet.stockCost),
    orderExpenses: String(sheet.orderExpenses),
    globalExpenseAllocation: String(sheet.globalExpenseAllocation),
    refunds: String(sheet.refunds),
    discounts: String(sheet.discounts),
    netSalesProfit: String(sheet.netSalesProfit),
    commissionRate: String(sheet.commissionRate),
    commissionAmount: String(sheet.commissionAmount),
    businessRetainedProfit: String(sheet.businessRetainedProfit),
    hasIncompleteCostData: sheet.hasIncompleteCostData,
    closedAt,
    calculationVersion: sheet.calculationVersion,
  };
}

export async function closeCashierShift(
  orgId: string,
  shiftId: string,
  opts: {
    closedByUserId: string | null;
    closeReason: "manual" | "inactivity_auto_close";
    /** When set, only the user who opened the shift may close it (cashiers).
     *  Leave undefined/null for manager/admin override and auto-close. */
    requireOwnerUserId?: string | null;
  },
): Promise<{ shift: CashierShift; summary: CashierShiftSummary }> {
  const [shift] = await db
    .select()
    .from(cashierShifts)
    .where(and(eq(cashierShifts.id, shiftId), eq(cashierShifts.orgId, orgId)))
    .limit(1);
  if (!shift) throw new CashierShiftError("Cashier shift not found", 404, "SHIFT_NOT_FOUND");
  if (shift.status !== "open") throw new CashierShiftError("Cashier shift is not open", 400, "SHIFT_NOT_OPEN");
  if (opts.requireOwnerUserId && shift.openedByUserId !== opts.requireOwnerUserId) {
    throw new CashierShiftError("You can only close a shift you opened", 403, "SHIFT_NOT_OWNER");
  }

  const now = new Date();
  const { sheet, commissionOrders, allocationByDay } = await computeCashierShiftBalanceSheet(
    orgId,
    { ...shift, closedAt: now },
  );

  // Write the ledger before the summary, so the summary reports what was
  // actually accrued rather than a formula that would disagree with it. The
  // two differ whenever the shift sold on credit: an unpaid tick contributes
  // no paid sales, so it earns nothing until the customer pays.
  const accrued = await accrueShiftCommission(
    orgId,
    shift.id,
    commissionOrders,
    allocationByDay,
    sheet.commissionRate,
  );

  const status = opts.closeReason === "inactivity_auto_close" ? "auto_closed" : "closed";

  const [closed] = await db
    .update(cashierShifts)
    .set({
      status,
      closedAt: now,
      closedByUserId: opts.closedByUserId,
      closeReason: opts.closeReason,
      updatedAt: now,
    })
    .where(eq(cashierShifts.id, shiftId))
    .returning();

  const [summary] = await db
    .insert(cashierShiftSummaries)
    .values(cashierShiftSummaryValues(orgId, shift, withAccruedCommission(sheet, accrued), now))
    .returning();

  return { shift: closed, summary };
}

export async function refreshClosedCashierShiftSummary(
  orgId: string,
  shiftId: string,
): Promise<CashierShiftSummary> {
  const [shift] = await db
    .select()
    .from(cashierShifts)
    .where(and(eq(cashierShifts.id, shiftId), eq(cashierShifts.orgId, orgId)))
    .limit(1);
  if (!shift) throw new CashierShiftError("Cashier shift not found", 404, "SHIFT_NOT_FOUND");
  if (shift.status === "open") throw new CashierShiftError("Cashier shift is still open", 400, "SHIFT_STILL_OPEN");

  const closedAt = shift.closedAt ?? new Date();
  const { sheet, commissionOrders, allocationByDay } = await computeCashierShiftBalanceSheet(
    orgId,
    { ...shift, closedAt },
  );
  // An offline order replayed into a closed shift earns commission like any
  // other. Accrual is idempotent, so re-running it here tops up the ledger with
  // the newly arrived order and leaves everything already paid alone.
  const accrued = await accrueShiftCommission(
    orgId,
    shift.id,
    commissionOrders,
    allocationByDay,
    sheet.commissionRate,
  );
  const values = cashierShiftSummaryValues(orgId, shift, withAccruedCommission(sheet, accrued), closedAt);

  const [summary] = await db
    .insert(cashierShiftSummaries)
    .values(values)
    .onConflictDoUpdate({
      target: cashierShiftSummaries.shiftId,
      set: {
        grossSales: values.grossSales,
        cashSales: values.cashSales,
        cardSales: values.cardSales,
        creditSales: values.creditSales,
        unpaidCreditSales: values.unpaidCreditSales,
        stockCost: values.stockCost,
        orderExpenses: values.orderExpenses,
        globalExpenseAllocation: values.globalExpenseAllocation,
        refunds: values.refunds,
        discounts: values.discounts,
        netSalesProfit: values.netSalesProfit,
        commissionRate: values.commissionRate,
        commissionAmount: values.commissionAmount,
        businessRetainedProfit: values.businessRetainedProfit,
        hasIncompleteCostData: values.hasIncompleteCostData,
        closedAt: values.closedAt,
        calculatedAt: new Date(),
        calculationVersion: values.calculationVersion,
      },
    })
    .returning();
  return summary;
}

/** Sweeps all orgs for cashier shifts that have exceeded their configured inactivity window. */
export async function autoCloseInactiveCashierShifts(): Promise<number> {
  const openShifts = await db
    .select({
      shift: cashierShifts,
      shiftInactivityCloseAfter: organizations.shiftInactivityCloseAfter,
    })
    .from(cashierShifts)
    .innerJoin(organizations, eq(cashierShifts.orgId, organizations.id))
    .where(eq(cashierShifts.status, "open"));

  const now = Date.now();
  const thresholdMs: Record<string, number> = {
    "1_hour": 60 * 60 * 1000,
    "12_hours": 12 * 60 * 60 * 1000,
    "1_day": 24 * 60 * 60 * 1000,
  };

  let closedCount = 0;
  for (const row of openShifts) {
    const setting = row.shiftInactivityCloseAfter ?? "never";
    if (setting === "never" || !thresholdMs[setting]) continue;
    const lastActivity = row.shift.lastActivityAt ? new Date(row.shift.lastActivityAt).getTime() : now;
    if (now - lastActivity < thresholdMs[setting]) continue;
    try {
      await closeCashierShift(row.shift.orgId, row.shift.id, {
        closedByUserId: null,
        closeReason: "inactivity_auto_close",
      });
      closedCount += 1;
    } catch (error) {
      console.error("[CashierShiftEngine] Auto-close failed for shift", row.shift.id, error);
    }
  }
  return closedCount;
}
