import { db } from "../db";
import {
  cashierProfiles,
  cashierShifts,
  cashierShiftSummaries,
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
import { and, eq, gte, lt, lte, or, isNull, inArray } from "drizzle-orm";
import {
  buildCashierShiftBalanceSheet,
  allocateGlobalExpenseShare,
  dailyOverheadTotal,
  utcDateKey,
  type CashierShiftOrder,
} from "@shared/reports/cashierShiftReport";

type DbClient = typeof db;

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
};

async function loadShiftOrders(shiftId: string, database: DbClient = db): Promise<ShiftOrderRow[]> {
  return database
    .select({
      id: orders.id,
      total: orders.total,
      paymentMethod: orders.paymentMethod,
      status: orders.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.cashierShiftId, shiftId));
}

async function loadOrdersWithCosts(
  orderIds: string[],
  database: DbClient = db,
): Promise<Map<string, { costPrice: number | null; quantity: number }[]>> {
  const map = new Map<string, { costPrice: number | null; quantity: number }[]>();
  if (orderIds.length === 0) return map;
  const rows = await database
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

async function loadOrderExpensesTotal(orderIds: string[], database: DbClient = db): Promise<number> {
  if (orderIds.length === 0) return 0;
  const rows = await database
    .select({ amount: orderExpensesTable.amount })
    .from(orderExpensesTable)
    .where(inArray(orderExpensesTable.orderId, orderIds));
  return rows.reduce((sum, r) => sum + parseFloat(String(r.amount)), 0);
}

function isTickPayment(method: string): boolean {
  return method.toLowerCase() === "tick";
}

/** Paid sales received for a set of orders: gross total minus unpaid tick sales. */
function paidSalesReceivedFor(rows: { total: string; paymentMethod: string; status: string | null }[]): number {
  let gross = 0;
  let unpaidTick = 0;
  for (const row of rows) {
    const total = parseFloat(String(row.total));
    gross += total;
    if (isTickPayment(row.paymentMethod) && row.status !== "completed") unpaidTick += total;
  }
  return gross - unpaidTick;
}

/** Org-wide paid sales received for a single UTC calendar day (all cashiers/channels). */
async function orgPaidSalesReceivedForDay(
  orgId: string,
  dayStart: Date,
  dayEnd: Date,
  database: DbClient = db,
): Promise<number> {
  const rows = await database
    .select({
      total: orders.total,
      paymentMethod: orders.paymentMethod,
      status: orders.status,
    })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, dayStart), lt(orders.createdAt, dayEnd)));
  return paidSalesReceivedFor(rows);
}

async function dailyGlobalExpensesForDay(
  orgId: string,
  dayStart: Date,
  dayEnd: Date,
  database: DbClient = db,
): Promise<number> {
  const rows = await database
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
export async function computeCashierShiftBalanceSheet(orgId: string, shift: CashierShift, database: DbClient = db) {
  const [cashier] = await database
    .select()
    .from(cashierProfiles)
    .where(eq(cashierProfiles.id, shift.cashierId))
    .limit(1);
  if (!cashier) throw new CashierShiftError("Cashier profile not found", 404, "CASHIER_NOT_FOUND");

  const [org] = await database.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new CashierShiftError("Organization not found", 404, "ORG_NOT_FOUND");

  const orderRows = await loadShiftOrders(shift.id, database);
  const orderIds = orderRows.map((o) => o.id);
  const costsByOrder = await loadOrdersWithCosts(orderIds, database);
  const orderExpensesTotal = await loadOrderExpensesTotal(orderIds, database);
  const refundRows = orderIds.length
    ? await database.select({ total: refunds.total }).from(refunds).where(inArray(refunds.orderId, orderIds))
    : [];

  const shiftOrders: CashierShiftOrder[] = orderRows.map((o) => ({
    id: o.id,
    total: parseFloat(String(o.total)),
    paymentMethod: o.paymentMethod,
    status: o.status ?? "pending",
    createdAt: (o.createdAt ?? new Date()).toISOString(),
    items: (costsByOrder.get(o.id) ?? []).map((i) => ({ quantity: i.quantity, costPrice: i.costPrice })),
  }));

  // Bucket the shift's orders by UTC calendar day to allocate global expenses per-day.
  const dayKeys = new Set<string>(shiftOrders.map((o) => utcDateKey(o.createdAt)));
  if (dayKeys.size === 0) dayKeys.add(utcDateKey((shift.closedAt ?? new Date()).toISOString()));

  let globalExpenseAllocation = 0;
  for (const dayKey of dayKeys) {
    const { start, end } = dayBounds(dayKey);
    const shiftPaidForDay = paidSalesReceivedFor(
      orderRows.filter((o) => o.createdAt && utcDateKey(o.createdAt.toISOString()) === dayKey),
    );
    const [orgPaidForDay, dailyExpenses] = await Promise.all([
      orgPaidSalesReceivedForDay(orgId, start, end, database),
      dailyGlobalExpensesForDay(orgId, start, end, database),
    ]);
    globalExpenseAllocation += allocateGlobalExpenseShare(dailyExpenses, shiftPaidForDay, orgPaidForDay);
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

  return { sheet, cashier, org };
}

async function upsertCashierShiftSummary(
  orgId: string,
  shift: CashierShift,
  database: DbClient,
): Promise<CashierShiftSummary> {
  const closedAt = shift.closedAt ?? new Date();
  const { sheet } = await computeCashierShiftBalanceSheet(orgId, { ...shift, closedAt }, database);
  const values = {
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

  const [summary] = await database
    .insert(cashierShiftSummaries)
    .values(values)
    .onConflictDoUpdate({
      target: cashierShiftSummaries.shiftId,
      set: {
        ...values,
        calculatedAt: new Date(),
      },
    })
    .returning();
  return summary;
}

export async function refreshClosedCashierShiftSummary(
  orgId: string,
  shiftId: string,
  database: DbClient = db,
): Promise<CashierShiftSummary | null> {
  const [shift] = await database
    .select()
    .from(cashierShifts)
    .where(and(eq(cashierShifts.id, shiftId), eq(cashierShifts.orgId, orgId)))
    .limit(1);
  if (!shift || shift.status === "open") return null;
  return upsertCashierShiftSummary(orgId, shift, database);
}

export async function closeCashierShift(
  orgId: string,
  shiftId: string,
  opts: { closedByUserId: string | null; closeReason: "manual" | "inactivity_auto_close" },
): Promise<{ shift: CashierShift; summary: CashierShiftSummary }> {
  const [shift] = await db
    .select()
    .from(cashierShifts)
    .where(and(eq(cashierShifts.id, shiftId), eq(cashierShifts.orgId, orgId)))
    .limit(1);
  if (!shift) throw new CashierShiftError("Cashier shift not found", 404, "SHIFT_NOT_FOUND");
  if (shift.status !== "open") throw new CashierShiftError("Cashier shift is not open", 400, "SHIFT_NOT_OPEN");

  const now = new Date();

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

  const summary = await upsertCashierShiftSummary(orgId, { ...closed, closedAt: now }, db);

  return { shift: closed, summary };
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
