/**
 * Per-order cashier commission.
 *
 * A shift used to produce one commission figure for one cashier. It now
 * produces a set of entries, because two people can be owed money for the same
 * order: the cashier who completed it takes 90% of its pool, and the cashier
 * who loaded it takes 10%. Where one person did both — or where nobody loaded
 * it, as on a web order — that person takes the lot.
 *
 *   margin = paid contribution
 *            − stock cost − the order's own expenses
 *            − the order's share of the day's expenses − refunds
 *   pool   = max(0, margin) × the COMPLETER's rate
 *
 * The completer's rate governs the whole pool. The inputter's own rate is never
 * read: they are taking a tenth of the completer's commission, not earning
 * their own.
 *
 * Two deliberate properties, both of which change money and are called out so a
 * reviewer sees them rather than discovers them:
 *
 *   1. **Each order's margin is floored at zero independently.** A cashier who
 *      sells at a loss earns nothing on that sale, but does not lose commission
 *      already earned on a good one. The shift-level figure floored the sum
 *      instead, which quietly cross-subsidised: one bad order reduced the
 *      commission on every other order in the shift.
 *   2. **An unpaid credit sale has a paid contribution of zero**, so it has a
 *      negative margin and pays nothing. That is the whole point of the credit
 *      model — commission follows the money, not the invoice — and it matches
 *      what the shift sheet already did by excluding unpaid tick from
 *      `paidSalesReceived`.
 */

export const COMPLETER_SHARE_PERCENT = 90;
export const INPUTTER_SHARE_PERCENT = 10;

export type CommissionOrderInput = {
  orderId: string;
  /** What was actually collected. Zero for a credit sale not yet paid. */
  paidContribution: number;
  stockCost: number;
  orderExpenses: number;
  /** This order's slice of the day's expenses — see `distributeOverheadShare`. */
  overheadShare: number;
  refunds: number;
  /** Who took it to completed. No completer means nobody can be paid. */
  completerCashierId: string | null;
  /** Who loaded it. Null for web and storefront orders. */
  inputterCashierId: string | null;
  /**
   * The same two people by user account, which is what commission actually
   * belongs to (migration 057). Carried alongside the cashier ids rather than
   * replacing them so a shift closed before the change still reconciles.
   */
  completerUserId?: string | null;
  inputterUserId?: string | null;
  /** Personal use and anything else that is not a sale: never accrues. */
  excluded?: boolean;
};

export type CommissionEntryRole = "completer" | "inputter";

export type CommissionEntry = {
  cashierId: string;
  /** Who is owed this, by user account. Undefined for pre-057 orders. */
  userId?: string | null;
  role: CommissionEntryRole;
  sharePercent: number;
  amount: number;
};

export type ShiftCommissionOrder = CommissionOrderInput & {
  /** UTC date the order was sold on. Entries accrue against this date. */
  soldOn: string;
};

export type OrderCommission = {
  orderId: string;
  margin: number;
  pool: number;
  entries: CommissionEntry[];
};

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Splits a shift's allocated share of the day's expenses across the orders that
 * earned it, in the same proportion it was derived from — each order's paid
 * contribution over the shift's.
 *
 * The residue from rounding is given to the largest share rather than dropped,
 * so the parts always sum to the whole. A penny lost here would show up as a
 * shift whose per-order margins do not reconcile to its own profit figure.
 */
export function distributeOverheadShare(
  orders: Array<{ orderId: string; paidContribution: number }>,
  totalAllocation: number,
): Map<string, number> {
  const shares = new Map<string, number>();
  for (const order of orders) shares.set(order.orderId, 0);

  const total = roundMoney(totalAllocation);
  if (total === 0 || orders.length === 0) return shares;

  const basis = orders.reduce((sum, o) => sum + Math.max(0, o.paidContribution), 0);
  // Nothing was collected, so there is nothing to apportion against. Charging
  // the overheads to orders that brought in no money would invent negative
  // margins — and therefore withhold commission — on the strength of an
  // arbitrary split.
  if (basis <= 0) return shares;

  let running = 0;
  let largestId = orders[0].orderId;
  let largestShare = -1;
  for (const order of orders) {
    const share = roundMoney((total * Math.max(0, order.paidContribution)) / basis);
    shares.set(order.orderId, share);
    running = roundMoney(running + share);
    if (share > largestShare) {
      largestShare = share;
      largestId = order.orderId;
    }
  }

  const residue = roundMoney(total - running);
  if (residue !== 0) {
    shares.set(largestId, roundMoney((shares.get(largestId) ?? 0) + residue));
  }
  return shares;
}

/**
 * Builds the commission entries for a single order.
 *
 * @param completerRate The completing cashier's effective rate, as a percentage
 *   (10 for 10%). The inputter's rate is deliberately not a parameter.
 */
export function buildOrderCommission(
  order: CommissionOrderInput,
  completerRate: number,
): OrderCommission {
  const margin = roundMoney(
    order.paidContribution -
      order.stockCost -
      order.orderExpenses -
      order.overheadShare -
      order.refunds,
  );

  const pool = order.excluded
    ? 0
    : roundMoney(Math.max(0, margin) * (completerRate / 100));

  // Nobody completed it, or there is nothing to share out.
  if (pool <= 0 || !order.completerCashierId) {
    return { orderId: order.orderId, margin, pool: Math.max(0, pool), entries: [] };
  }

  const completerId = order.completerCashierId;
  const inputterId = order.inputterCashierId;

  if (!inputterId || inputterId === completerId) {
    return {
      orderId: order.orderId,
      margin,
      pool,
      entries: [
        {
          cashierId: completerId,
          userId: order.completerUserId,
          role: "completer",
          sharePercent: 100,
          amount: pool,
        },
      ],
    };
  }

  // The inputter's tenth is rounded first and the completer takes the
  // remainder, so the two entries always sum to the pool exactly.
  const inputterAmount = roundMoney((pool * INPUTTER_SHARE_PERCENT) / 100);
  const completerAmount = roundMoney(pool - inputterAmount);

  const entries: CommissionEntry[] = [
    {
      cashierId: completerId,
      userId: order.completerUserId,
      role: "completer",
      sharePercent: COMPLETER_SHARE_PERCENT,
      amount: completerAmount,
    },
  ];
  // A pool small enough that a tenth rounds to nothing pays the completer only,
  // rather than writing a zero-value row somebody has to explain.
  if (inputterAmount > 0) {
    entries.push({
      cashierId: inputterId,
      userId: order.inputterUserId,
      role: "inputter",
      sharePercent: INPUTTER_SHARE_PERCENT,
      amount: inputterAmount,
    });
  }

  return { orderId: order.orderId, margin, pool, entries };
}

/** Every order's entries for a shift, plus the total actually accrued. */
export function buildShiftCommission(
  orders: CommissionOrderInput[],
  completerRates: Map<string, number>,
  fallbackRate: number,
): { perOrder: OrderCommission[]; total: number } {
  const perOrder = orders.map((order) => {
    const rate = order.completerCashierId
      ? completerRates.get(order.completerCashierId) ?? fallbackRate
      : fallbackRate;
    return buildOrderCommission(order, rate);
  });
  const total = roundMoney(
    perOrder.reduce(
      (sum, o) => sum + o.entries.reduce((entrySum, e) => entrySum + e.amount, 0),
      0,
    ),
  );
  return { perOrder, total };
}

/**
 * Apportions a shift's allocated share of the day's expenses across its orders,
 * day by day. The allocation was derived per calendar day, so it has to be
 * split per calendar day too — apportioning a multi-day shift's total in one
 * go would charge Monday's overheads against Tuesday's takings.
 */
export function apportionOverheadsByDay(
  orders: ShiftCommissionOrder[],
  allocationByDay: Map<string, number>,
): Map<string, number> {
  const shares = new Map<string, number>();
  for (const day of new Set(orders.map((o) => o.soldOn))) {
    const forDay = orders.filter((o) => o.soldOn === day);
    const dayShares = distributeOverheadShare(
      forDay.map((o) => ({ orderId: o.orderId, paidContribution: o.paidContribution })),
      allocationByDay.get(day) ?? 0,
    );
    for (const [orderId, share] of dayShares) shares.set(orderId, share);
  }
  return shares;
}

