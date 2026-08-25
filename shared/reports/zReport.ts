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

  const paymentMap = new Map<string, { total: number; count: number }>();
  for (const order of orders) {
    const method = order.paymentMethod || "unknown";
    const entry = paymentMap.get(method) ?? { total: 0, count: 0 };
    entry.total += order.total;
    entry.count += 1;
    paymentMap.set(method, entry);
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

  const cashSales = roundMoney(
    orders
      .filter((o) => isCashPayment(o.paymentMethod))
      .reduce((sum, o) => sum + o.total, 0),
  );
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
  const cashSales = orders
    .filter((o) => isCashPayment(o.paymentMethod))
    .reduce((sum, o) => sum + o.total, 0);
  const cashRefunds = refunds
    .filter((r) => r.refundMethod === "cash" || r.refundMethod === "original")
    .reduce((sum, r) => sum + r.total, 0);
  return roundMoney(openingFloat + cashSales - cashRefunds);
}
