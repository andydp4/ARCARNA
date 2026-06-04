export type PromoOrderRow = {
  customerId: string | null;
  total: number;
};

export type PromoWindowMetrics = {
  revenue: number;
  orderCount: number;
  aov: number;
  newCustomerShare: number;
};

export type PromoLiftPercent = {
  revenueLiftPct: number | null;
  aovLiftPct: number | null;
  newCustomerLiftPct: number | null;
};

export function liftPercent(promoValue: number, baselineValue: number): number | null {
  if (baselineValue === 0) {
    return promoValue === 0 ? 0 : null;
  }
  return Math.round(((promoValue - baselineValue) / baselineValue) * 10000) / 100;
}

export function countNewCustomersInWindow(
  orders: PromoOrderRow[],
  firstOrderAtByCustomer: Map<string, Date>,
  windowStart: Date,
  windowEnd: Date,
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const o of orders) {
    if (!o.customerId || seen.has(o.customerId)) continue;
    seen.add(o.customerId);
    const first = firstOrderAtByCustomer.get(o.customerId);
    if (first && first >= windowStart && first < windowEnd) count += 1;
  }
  return count;
}

export function aggregateWindowMetrics(
  orders: PromoOrderRow[],
  firstOrderAtByCustomer: Map<string, Date>,
  windowStart: Date,
  windowEnd: Date,
): PromoWindowMetrics {
  const orderCount = orders.length;
  const revenue = orders.reduce((sum, o) => sum + o.total, 0);
  const aov = orderCount > 0 ? Math.round((revenue / orderCount) * 100) / 100 : 0;
  const distinctCustomers = new Set(
    orders.map((o) => o.customerId).filter((id): id is string => Boolean(id)),
  );
  const newCount = countNewCustomersInWindow(orders, firstOrderAtByCustomer, windowStart, windowEnd);
  const newCustomerShare =
    distinctCustomers.size > 0
      ? Math.round((newCount / distinctCustomers.size) * 10000) / 10000
      : 0;

  return {
    revenue: Math.round(revenue * 100) / 100,
    orderCount,
    aov,
    newCustomerShare,
  };
}

export function computePromoLift(input: {
  promo: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    usageCount: number | null;
  };
  baselineWeeks: number;
  promoOrders: PromoOrderRow[];
  baselineOrders: PromoOrderRow[];
  firstOrderAtByCustomer: Map<string, Date>;
  promoWindow: { start: Date; end: Date };
  baselineWindow: { start: Date; end: Date };
}): {
  promo: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    usageCount: number;
  };
  baselineWeeks: number;
  promoWindow: PromoWindowMetrics;
  baselineWindow: PromoWindowMetrics;
  lift: PromoLiftPercent;
} {
  const promoWindow = aggregateWindowMetrics(
    input.promoOrders,
    input.firstOrderAtByCustomer,
    input.promoWindow.start,
    input.promoWindow.end,
  );
  const baselineWindow = aggregateWindowMetrics(
    input.baselineOrders,
    input.firstOrderAtByCustomer,
    input.baselineWindow.start,
    input.baselineWindow.end,
  );

  return {
    promo: {
      id: input.promo.id,
      name: input.promo.name,
      startDate: input.promo.startDate.toISOString(),
      endDate: input.promo.endDate.toISOString(),
      usageCount: input.promo.usageCount ?? 0,
    },
    baselineWeeks: input.baselineWeeks,
    promoWindow,
    baselineWindow,
    lift: {
      revenueLiftPct: liftPercent(promoWindow.revenue, baselineWindow.revenue),
      aovLiftPct: liftPercent(promoWindow.aov, baselineWindow.aov),
      newCustomerLiftPct: liftPercent(
        promoWindow.newCustomerShare,
        baselineWindow.newCustomerShare,
      ),
    },
  };
}
