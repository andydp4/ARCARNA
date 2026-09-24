/**
 * Pure cashier shift balance-sheet aggregator.
 *
 * Commission is calculated from net sales profit, not gross sales:
 *   netSalesProfit = paidSalesReceived - stockCost - orderExpenses
 *                    - allocatedGlobalExpenses - refunds
 *
 * `discounts` (tier, promotion, points) is reported, not subtracted: since
 * v1.2 Phase 1B an order's total IS what the customer was charged, so the
 * discount is already out of paidSalesReceived. Taking it off again would
 * cut commission for every discount given. (It was always passed as 0 before
 * this release, so no historic figure changes.)
 *   commissionAmount = Math.max(0, netSalesProfit) * commissionRate
 *
 * Unpaid credit/tick sales are tracked separately and excluded from
 * paidSalesReceived until marked paid.
 */
import { isCardLinkMethod, isPaidLeg } from "../payments/cardLink";

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
  payments?: Array<{ method: string; amount: number; status?: string | null }>;
  items: Array<{
    quantity: number;
    /** Unit cost price; null when the product has no recorded cost. */
    costPrice: number | null;
  }>;
  /**
   * The share of this order's money that earns commission, 0–1 (v1.2.1): a
   * delivery fee is left out unless the admin counts it. It stays in net
   * profit; only the commission on it is left out. Absent: 1.
   */
  commissionShare?: number;
  /** Refunded money on this order that earned no commission (a refunded delivery fee). Absent: 0. */
  refundedOutsideCommission?: number;
};

export type CashierShiftRefund = {
  total: number;
};

export type CashierShiftBalanceSheet = {
  grossSales: number;
  cashSales: number;
  /** Card taken on the terminal. */
  cardSales: number;
  /** Card taken by Stripe link and confirmed (v1.2 Stripe links), apart from the terminal's. */
  cardLinkSales: number;
  /** Card links Stripe has not confirmed: sold, not taken, in no figure above. */
  awaitingCardPayment: number;
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
  // Money taken only: an awaiting card-link leg is in no tender.
  if (order.payments && order.payments.length > 0) return order.payments.filter(isPaidLeg);
  return [{ method: order.paymentMethod, amount: order.total }];
}

/** The part of a sale still waiting on a card link. */
function awaitingOn(order: CashierShiftOrder): number {
  return (order.payments ?? []).filter((leg) => !isPaidLeg(leg)).reduce((sum, leg) => sum + leg.amount, 0);
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

/** Terminal card. Card (link) is counted on its own line. */
function isCardPayment(method: string): boolean {
  const m = method.toLowerCase();
  if (isCardLinkMethod(m)) return false;
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
 * @param discounts Discounts given on these sales (tier + promotion + points),
 *   for the report only — already out of the order totals, never subtracted.
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
  const cardLinkSales = takenBy(isCardLinkMethod);
  const creditSales = takenBy(isTickPayment);
  const unpaidCreditSales = roundMoney(
    salesOrders.reduce((sum, o) => sum + outstandingCreditOn(o), 0),
  );
  const awaitingCardPayment = roundMoney(salesOrders.reduce((sum, o) => sum + awaitingOn(o), 0));
  const paidSalesReceived = roundMoney(grossSales - unpaidCreditSales - awaitingCardPayment);

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
      refundsTotal,
  );

  // Money received that earns no commission (a delivery fee, v1.2.1): the
  // same share of each order the commission ledger leaves out, so the live
  // "commission so far" agrees with what the shift accrues when it closes.
  const outsideCommission = roundMoney(
    salesOrders.reduce((sum, o) => {
      const share = o.commissionShare === undefined ? 1 : Math.min(1, Math.max(0, o.commissionShare));
      if (share >= 1) return sum;
      const received = Math.max(0, Math.max(0, o.total) - outstandingCreditOn(o) - awaitingOn(o));
      return sum + received * (1 - share);
    }, 0) -
      // …and a fee given back took no commission, so it gives none back.
      salesOrders.reduce((sum, o) => sum + Math.max(0, o.refundedOutsideCommission ?? 0), 0),
  );
  const commissionAmount = roundMoney(Math.max(0, netSalesProfit - outsideCommission) * (commissionRate / 100));
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
    cardLinkSales,
    awaitingCardPayment,
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
