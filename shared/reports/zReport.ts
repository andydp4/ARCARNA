/**
 * Pure Z-report aggregator for a closed shift.
 */

export type ZReportOrder = {
  id: string;
  total: number;
  paymentMethod: string;
  createdAt: string;
  items: Array<{
    productId: string;
    productName: string;
    sku?: string;
    category?: string;
    quantity: number;
    lineTotal: number;
  }>;
  /**
   * The tenders that paid for this order. A sale can be part cash, part card
   * and part tick, so the payment breakdown and the drawer both have to be
   * built from the legs rather than from one column. Absent means a
   * single-tender sale, which is what every order was before split tender.
   */
  payments?: Array<{ method: string; amount: number }>;
};

export type ZReportRefund = {
  id: string;
  total: number;
  refundMethod: string;
  createdAt: string;
};

export type ZReportShift = {
  id: string;
  openingFloat: number;
  closingCount: number | null;
  expectedCash: number | null;
  variance: number | null;
  openedAt: string;
  closedAt: string | null;
  cashierName: string;
  locationName: string;
  status: string;
  notes?: string | null;
};

export type ZReportData = {
  shift: ZReportShift;
  orderCount: number;
  grossSales: number;
  refundsTotal: number;
  netSales: number;
  salesByPaymentMethod: Array<{ method: string; total: number; count: number }>;
  salesByCategory: Array<{ category: string; total: number }>;
  topSkus: Array<{ sku: string; name: string; qty: number; revenue: number }>;
  cashSummary: {
    openingFloat: number;
    cashSales: number;
    cashRefunds: number;
    expectedCash: number;
    closingCount: number | null;
    variance: number | null;
  };
  /**
   * Credit handed out during this shift — sales made, goods gone, no money in.
   *
   * It explains a drawer that is light: the sales are real and counted, the
   * cash simply is not there yet. It does not touch `netSales`.
   */
  creditGivenOut: number;
  /**
   * Credit settled during this shift, grouped by the day the debt was given.
   *
   * Cash arriving now against a sale counted on an earlier day, which is why it
   * does not touch `netSales` either — counting it again would inflate takings
   * by the value of every credit sale.
   */
  creditResolved: Array<{ givenOn: string; amount: number }>;
};

/** Credit given out during the shift, from the orders' credit records. */
export type ZReportCreditGiven = {
  orderId: string;
  amountGiven: number;
};

/** A payment taken during the shift against a debt given on `givenOn`. */
export type ZReportCreditPayment = {
  amount: number;
  givenOn: string;
  method: string;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isCashPayment(method: string): boolean {
  const m = method.toLowerCase();
  return m === "cash" || m.includes("cash");
}

/**
 * An order's tender legs, falling back to the whole total on its single
 * payment method for orders taken before split tender existed.
 */
function tenderLegs(order: ZReportOrder): Array<{ method: string; amount: number }> {
  if (order.payments && order.payments.length > 0) return order.payments;
  return [{ method: order.paymentMethod, amount: order.total }];
}

/** Cash actually taken across a set of orders, counting only the cash legs. */
function cashTakenFrom(orders: ZReportOrder[]): number {
  return orders.reduce(
    (sum, order) =>
      sum +
      tenderLegs(order)
        .filter((leg) => isCashPayment(leg.method))
        .reduce((legSum, leg) => legSum + leg.amount, 0),
    0,
  );
}

export function buildZReport(
  shift: ZReportShift,
  orders: ZReportOrder[],
  refunds: ZReportRefund[],
  creditGiven: ZReportCreditGiven[] = [],
  creditPaid: ZReportCreditPayment[] = [],
): ZReportData {
  const grossSales = roundMoney(
    orders.reduce((sum, o) => sum + Math.max(0, o.total), 0),
  );
  const refundsTotal = roundMoney(
    refunds.reduce((sum, r) => sum + Math.max(0, r.total), 0),
  );
  const netSales = roundMoney(grossSales - refundsTotal);

  // Split by tender leg: a £100 sale taken as £50 cash and £50 on tick appears
  // under both, for £50 each, rather than £100 under whichever was picked first.
  // The count is orders-touching-that-tender, which is what "how many card
  // transactions did we take?" actually means.
  const paymentMap = new Map<string, { total: number; count: number }>();
  for (const order of orders) {
    for (const leg of tenderLegs(order)) {
      const method = leg.method || "unknown";
      const entry = paymentMap.get(method) ?? { total: 0, count: 0 };
      entry.total += leg.amount;
      entry.count += 1;
      paymentMap.set(method, entry);
    }
  }
  const salesByPaymentMethod = [...paymentMap.entries()]
    .map(([method, { total, count }]) => ({
      method,
      total: roundMoney(total),
      count,
    }))
    .sort((a, b) => b.total - a.total);

  const categoryMap = new Map<string, number>();
  const skuMap = new Map<
    string,
    { sku: string; name: string; qty: number; revenue: number }
  >();

  for (const order of orders) {
    for (const item of order.items) {
      const category = item.category?.trim() || "General";
      categoryMap.set(category, (categoryMap.get(category) ?? 0) + item.lineTotal);

      const sku = item.sku || item.productId;
      const existing = skuMap.get(sku) ?? {
        sku,
        name: item.productName,
        qty: 0,
        revenue: 0,
      };
      existing.qty += item.quantity;
      existing.revenue += item.lineTotal;
      skuMap.set(sku, existing);
    }
  }

  const salesByCategory = [...categoryMap.entries()]
    .map(([category, total]) => ({ category, total: roundMoney(total) }))
    .sort((a, b) => b.total - a.total);

  const topSkus = [...skuMap.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((s) => ({ ...s, revenue: roundMoney(s.revenue) }));

  // Only the cash legs reach the drawer. A £100 sale half paid by card puts £50
  // in the till, and expecting £100 would show a £50 variance every time.
  const cashSales = roundMoney(cashTakenFrom(orders));
  const cashRefunds = roundMoney(
    refunds
      .filter((r) => r.refundMethod === "cash" || r.refundMethod === "original")
      .reduce((sum, r) => sum + r.total, 0),
  );
  const openingFloat = shift.openingFloat;
  const expectedCash =
    shift.expectedCash != null
      ? shift.expectedCash
      : roundMoney(openingFloat + cashSales - cashRefunds);
  const closingCount = shift.closingCount;
  const variance =
    shift.variance != null
      ? shift.variance
      : closingCount != null
        ? roundMoney(closingCount - expectedCash)
        : null;

  return {
    shift,
    orderCount: orders.length,
    grossSales,
    refundsTotal,
    netSales,
    salesByPaymentMethod,
    salesByCategory,
    topSkus,
    cashSummary: {
      openingFloat,
      cashSales,
      cashRefunds,
      expectedCash,
      closingCount,
      variance,
    },
    creditGivenOut: roundMoney(
      creditGiven.reduce((sum, c) => sum + Math.max(0, c.amountGiven), 0),
    ),
    creditResolved: summariseCreditResolved(creditPaid),
  };
}

/**
 * Groups the shift's credit settlements by the day the debt was given, so the
 * report reads "credit resolved from 12/08/26 — £240.00". A shift clearing
 * debts from three different days shows three lines, because that is three
 * separate pieces of history being closed off.
 */
function summariseCreditResolved(
  payments: ZReportCreditPayment[],
): Array<{ givenOn: string; amount: number }> {
  const byDay = new Map<string, number>();
  for (const payment of payments) {
    byDay.set(payment.givenOn, (byDay.get(payment.givenOn) ?? 0) + Math.max(0, payment.amount));
  }
  return [...byDay.entries()]
    .map(([givenOn, amount]) => ({ givenOn, amount: roundMoney(amount) }))
    .sort((a, b) => (a.givenOn < b.givenOn ? -1 : 1));
}

/** Server-side expected cash at close time. */
export function computeExpectedCash(
  openingFloat: number,
  orders: ZReportOrder[],
  refunds: ZReportRefund[],
): number {
  const cashSales = cashTakenFrom(orders);
  const cashRefunds = refunds
    .filter((r) => r.refundMethod === "cash" || r.refundMethod === "original")
    .reduce((sum, r) => sum + r.total, 0);
  return roundMoney(openingFloat + cashSales - cashRefunds);
}
