/**
 * Pure cashier shift balance-sheet aggregator.
 *
 * Commission is calculated from net sales profit, not gross sales:
 *   netSalesProfit = paidSalesReceived - stockCost - orderExpenses
 *                    - allocatedGlobalExpenses - refunds - discounts
 *   commissionAmount = Math.max(0, netSalesProfit) * commissionRate
 *
 * Unpaid credit/tick sales are tracked separately and excluded from
 * paidSalesReceived until marked paid.
 */

export const CALCULATION_VERSION = 1;

export type CashierShiftOrder = {
  id: string;
  total: number;
  paymentMethod: string;
  /** Order lifecycle status, e.g. "pending" | "completed" | ... */
  status: string;
  createdAt: string;
  items: Array<{
    quantity: number;
    /** Unit cost price; null when the product has no recorded cost. */
    costPrice: number | null;
  }>;
};

export type CashierShiftRefund = {
  total: number;
};

export type CashierShiftBalanceSheet = {
  grossSales: number;
  cashSales: number;
  cardSales: number;
  creditSales: number;
  unpaidCreditSales: number;
  paidSalesReceived: number;
  stockCost: number;
  orderExpenses: number;
  globalExpenseAllocation: number;
  refunds: number;
  discounts: number;
  netSalesProfit: number;
  commissionRate: number;
  commissionAmount: number;
  businessRetainedProfit: number;
  hasIncompleteCostData: boolean;
  calculationVersion: number;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isTickPayment(method: string): boolean {
  return method.toLowerCase() === "tick";
}

function isCashPayment(method: string): boolean {
  const m = method.toLowerCase();
  return m === "cash" || m.includes("cash");
}

function isCardPayment(method: string): boolean {
  const m = method.toLowerCase();
  return m === "card" || m.includes("card");
}

/**
 * Builds the closed-shift balance sheet snapshot for a single cashier shift.
 *
 * @param orders Orders attributed to this cashier shift.
 * @param orderExpensesTotal Sum of order-level expenses for those orders.
 * @param globalExpenseAllocation Pre-computed allocated share of global/overhead
 *   expenses (see `allocateGlobalExpenseShare`), summed across the days the
 *   shift spans.
 * @param refunds Refunds issued against orders in this shift.
 * @param discounts Discount total, if tracked (defaults to 0 — ARCANA does not
 *   yet capture per-order discount amounts separately from totals).
 * @param commissionRate Effective commission rate for the shift, as a percentage
 *   (e.g. 20 for 20%).
 */
export function buildCashierShiftBalanceSheet(
  orders: CashierShiftOrder[],
  orderExpensesTotal: number,
  globalExpenseAllocation: number,
  refunds: CashierShiftRefund[],
  discounts: number,
  commissionRate: number,
): CashierShiftBalanceSheet {
  const grossSales = roundMoney(orders.reduce((sum, o) => sum + Math.max(0, o.total), 0));
  const cashSales = roundMoney(
    orders.filter((o) => isCashPayment(o.paymentMethod)).reduce((sum, o) => sum + o.total, 0),
  );
  const cardSales = roundMoney(
    orders.filter((o) => isCardPayment(o.paymentMethod)).reduce((sum, o) => sum + o.total, 0),
  );
  const creditSales = roundMoney(
    orders.filter((o) => isTickPayment(o.paymentMethod)).reduce((sum, o) => sum + o.total, 0),
  );
  const unpaidCreditSales = roundMoney(
    orders
      .filter((o) => isTickPayment(o.paymentMethod) && o.status !== "completed")
      .reduce((sum, o) => sum + o.total, 0),
  );
  const paidSalesReceived = roundMoney(grossSales - unpaidCreditSales);

  let stockCost = 0;
  let hasIncompleteCostData = false;
  for (const order of orders) {
    for (const item of order.items) {
      if (item.costPrice == null) {
        hasIncompleteCostData = true;
        continue;
      }
      stockCost += item.quantity * item.costPrice;
    }
  }
  stockCost = roundMoney(stockCost);

  const refundsTotal = roundMoney(refunds.reduce((sum, r) => sum + Math.max(0, r.total), 0));
  const roundedOrderExpenses = roundMoney(orderExpensesTotal);
  const roundedGlobalAllocation = roundMoney(globalExpenseAllocation);
  const roundedDiscounts = roundMoney(discounts);

  const netSalesProfit = roundMoney(
    paidSalesReceived -
      stockCost -
      roundedOrderExpenses -
      roundedGlobalAllocation -
      refundsTotal -
      roundedDiscounts,
  );

  const commissionAmount = roundMoney(Math.max(0, netSalesProfit) * (commissionRate / 100));
  const businessRetainedProfit = roundMoney(netSalesProfit - commissionAmount);

  return {
    grossSales,
    cashSales,
    cardSales,
    creditSales,
    unpaidCreditSales,
    paidSalesReceived,
    stockCost,
    orderExpenses: roundedOrderExpenses,
    globalExpenseAllocation: roundedGlobalAllocation,
    refunds: refundsTotal,
    discounts: roundedDiscounts,
    netSalesProfit,
    commissionRate,
    commissionAmount,
    businessRetainedProfit,
    hasIncompleteCostData,
    calculationVersion: CALCULATION_VERSION,
  };
}

export type DailyOverheadExpense = {
  amount: number;
  frequency: "daily" | "weekly" | "monthly" | "yearly" | string;
};

/** Converts overhead expenses to a single day's equivalent cost. */
export function dailyOverheadTotal(expenses: DailyOverheadExpense[]): number {
  let total = 0;
  for (const expense of expenses) {
    switch (expense.frequency) {
      case "daily":
        total += expense.amount;
        break;
      case "weekly":
        total += expense.amount / 7;
        break;
      case "monthly":
        total += expense.amount / 30;
        break;
      case "yearly":
        total += expense.amount / 365;
        break;
    }
  }
  return total;
}

/**
 * Allocates a shift's share of a single day's global/overhead expenses,
 * proportional to the shift's paid sales received that day vs. the org's
 * total paid sales received that day. Returns 0 when there were no sales
 * that day (avoids divide-by-zero).
 */
export function allocateGlobalExpenseShare(
  dailyGlobalExpenses: number,
  shiftPaidSalesReceivedForDay: number,
  totalOrgPaidSalesReceivedForDay: number,
): number {
  if (totalOrgPaidSalesReceivedForDay <= 0) return 0;
  return roundMoney(
    dailyGlobalExpenses * (shiftPaidSalesReceivedForDay / totalOrgPaidSalesReceivedForDay),
  );
}

/** Returns the UTC calendar-date key (YYYY-MM-DD) an ISO timestamp falls on. */
export function utcDateKey(iso: string): string {
  return iso.slice(0, 10);
}
