import { db } from "../db";
import {
  cashierCommissionEntries,
  cashierProfiles,
  users,
  type CashierCommissionEntry,
} from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  apportionOverheadsByDay,
  buildShiftCommission,
  roundMoney,
  type ShiftCommissionOrder,
} from "@shared/reports/orderCommission";

/**
 * Writes the commission ledger.
 *
 * The pure maths lives in `@shared/reports/orderCommission`; this module is
 * only the part that needs a database — reading each completer's rate, and
 * inserting the entries idempotently.
 */

export type { ShiftCommissionOrder };

/**
 * Resolves each completer's rate, keyed by cashier id.
 *
 * The user's own rate wins where the order records one, because commission
 * belongs to the person who logged in (migration 057); a cashier code's rate is
 * honoured underneath it so shifts taken before the change keep their figures.
 *
 * Only completers are looked up. An inputter's rate is never read: their tenth
 * comes out of the completer's pool, priced at the completer's rate.
 */
async function completerRates(
  orders: Array<{ completerCashierId: string | null; completerUserId?: string | null }>,
): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  const cashierIds = [
    ...new Set(orders.map((o) => o.completerCashierId).filter((id): id is string => !!id)),
  ];
  const userIds = [
    ...new Set(orders.map((o) => o.completerUserId).filter((id): id is string => !!id)),
  ];
  if (cashierIds.length === 0 && userIds.length === 0) return rates;

  const userRates = new Map<string, number>();
  if (userIds.length > 0) {
    const rows = await db
      .select({ id: users.id, rate: users.commissionRate })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const row of rows) {
      if (row.rate != null) userRates.set(row.id, parseFloat(String(row.rate)));
    }
  }

  if (cashierIds.length > 0) {
    const rows = await db
      .select({ id: cashierProfiles.id, rate: cashierProfiles.defaultCommissionRate })
      .from(cashierProfiles)
      .where(inArray(cashierProfiles.id, cashierIds));
    for (const row of rows) {
      if (row.rate != null) rates.set(row.id, parseFloat(String(row.rate)));
    }
  }

  // The user's rate overrides the code's, for every order that names one.
  for (const order of orders) {
    if (!order.completerCashierId || !order.completerUserId) continue;
    const userRate = userRates.get(order.completerUserId);
    if (userRate != null) rates.set(order.completerCashierId, userRate);
  }
  return rates;
}

/**
 * Accrues commission for every order a shift completed.
 *
 * Returns the total accrued, which is what the shift's balance sheet reports as
 * its commission. That figure is lower than "rate × profit" whenever the shift
 * sold on credit — the pool on an unpaid tick is not earned until the customer
 * pays, and is released then (see the credit lifecycle).
 *
 * Idempotent: closing a shift twice, or replaying an offline order into a
 * closed one, must not pay anybody twice. The unique index on
 * (order, cashier, role, basis) is what enforces that; this only has to not
 * fight it.
 */
export async function accrueShiftCommission(
  orgId: string,
  shiftId: string,
  orders: ShiftCommissionOrder[],
  allocationByDay: Map<string, number>,
  fallbackRate: number,
): Promise<number> {
  if (orders.length === 0) return 0;

  const overheadShares = apportionOverheadsByDay(orders, allocationByDay);
  const priced = orders.map((order) => ({
    ...order,
    overheadShare: overheadShares.get(order.orderId) ?? 0,
  }));

  const rates = await completerRates(priced);
  const { perOrder, total } = buildShiftCommission(priced, rates, fallbackRate);

  const rows = perOrder.flatMap((result) => {
    const source = priced.find((o) => o.orderId === result.orderId)!;
    const rate =
      (source.completerCashierId && rates.get(source.completerCashierId)) || fallbackRate;
    return result.entries.map((entry) => ({
      orgId,
      orderId: result.orderId,
      cashierId: entry.cashierId,
      userId: entry.userId ?? null,
      cashierShiftId: shiftId,
      role: entry.role,
      basis: "sale" as const,
      orderMargin: String(result.margin),
      overheadShare: String(source.overheadShare),
      commissionRate: String(rate),
      sharePercent: String(entry.sharePercent),
      amount: String(entry.amount),
      accruedOn: source.soldOn,
    }));
  });

  if (rows.length > 0) {
    await db.insert(cashierCommissionEntries).values(rows).onConflictDoNothing();
  }
  return total;
}

/** What a shift actually accrued, from the ledger rather than from a formula. */
export async function shiftCommissionTotal(shiftId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${cashierCommissionEntries.amount}), 0)` })
    .from(cashierCommissionEntries)
    .where(
      and(
        eq(cashierCommissionEntries.cashierShiftId, shiftId),
        isNull(cashierCommissionEntries.reversalOf),
      ),
    );
  return roundMoney(parseFloat(String(row?.total ?? 0)));
}

/** Every entry written against an order — used by the credit lifecycle. */
export async function entriesForOrder(orderId: string): Promise<CashierCommissionEntry[]> {
  return db
    .select()
    .from(cashierCommissionEntries)
    .where(eq(cashierCommissionEntries.orderId, orderId));
}
