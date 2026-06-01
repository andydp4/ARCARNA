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
  };
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
