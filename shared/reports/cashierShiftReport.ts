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
  /**
   * What is still owed on this order's credit, from its `order_credit` record.
   *
   * `undefined` means the caller predates credit records and the legacy test
   * below applies. Every live caller supplies it, and must: whether the money
   * has arrived is not something an order's status can answer, because a credit
   * sale is completed the day the goods leave and unpaid for weeks after.
   */
  creditOutstanding?: number;
  /**
   * The tenders that paid for this order. A sale can be part cash, part card
   * and part tick, so which bucket its money falls into is a property of the
   * legs, not of a single column on the order.
   *
   * Absent means the caller predates split tender; the whole total is then
   * attributed to `paymentMethod`, which is what a single-tender sale is.
   */
  payments?: Array<{ method: string; amount: number }>;
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
  /** Cost of stock staff took for themselves — never a sale, never commission. */
  personalUseCost: number;
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

/**
 * Staff taking stock for themselves. Not a sale, and never treated as one: it
 * contributes nothing to takings and earns nobody commission. Its cost reaches
 * the books once, as an order expense booked on the day — which is why the
 * stock cost loop skips it rather than counting the same goods twice.
 */
export function isPersonalUse(method: string): boolean {
  return method.toLowerCase() === "personal_use";
}

/**
 * An order's tender legs, falling back to the whole total on its single
 * payment method for callers that predate split tender.
 */
function tenderLegs(order: CashierShiftOrder): Array<{ method: string; amount: number }> {
  if (order.payments && order.payments.length > 0) return order.payments;
  return [{ method: order.paymentMethod, amount: order.total }];
}

/**
 * What is still owed on an order.
 *
 * Prefers the credit record, which is the only thing that actually knows. Falls
 * back to the old status heuristic only for callers that predate credit records
 * — it is wrong under the current model, where a tick order is completed on the
 * day the goods leave and stays unpaid until the customer settles, and is kept
 * solely so pre-migration data does not read as fully paid.
 */
function outstandingCreditOn(order: CashierShiftOrder): number {
  if (order.creditOutstanding !== undefined) return Math.max(0, order.creditOutstanding);
  if (isTickPayment(order.paymentMethod) && order.status !== "completed") return order.total;
  return 0;
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
  // Personal use is not a sale. Excluded from every takings figure below, and
  // from the stock cost, because its cost arrives as an order expense instead.
  const salesOrders = orders.filter((o) => !isPersonalUse(o.paymentMethod));
  const personalUseOrders = orders.filter((o) => isPersonalUse(o.paymentMethod));

  const grossSales = roundMoney(salesOrders.reduce((sum, o) => sum + Math.max(0, o.total), 0));

  // Money taken by tender, summed across every leg of every sale.
  const takenBy = (matches: (method: string) => boolean): number =>
    roundMoney(
      salesOrders.reduce(
        (sum, order) =>
          sum +
          tenderLegs(order)
            .filter((leg) => matches(leg.method))
            .reduce((legSum, leg) => legSum + leg.amount, 0),
        0,
      ),
    );
  const cashSales = takenBy(isCashPayment);
  const cardSales = takenBy(isCardPayment);
  const creditSales = takenBy(isTickPayment);
  const unpaidCreditSales = roundMoney(
    salesOrders.reduce((sum, o) => sum + outstandingCreditOn(o), 0),
  );
  const paidSalesReceived = roundMoney(grossSales - unpaidCreditSales);

  let stockCost = 0;
  let hasIncompleteCostData = false;
  for (const order of salesOrders) {
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

  // What the goods taken for personal use cost, shown so it is visible rather
  // than buried inside the expense line it is booked against.
  const personalUseCost = roundMoney(
    personalUseOrders.reduce(
      (sum, order) =>
        sum +
        order.items.reduce(
          (itemSum, item) => itemSum + (item.costPrice == null ? 0 : item.quantity * item.costPrice),
          0,
        ),
      0,
    ),
  );

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
    personalUseCost,
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
