/**
 * Staff Performance, Benefit (£) (v1.2 Phase 7C, STF-03) — the pure maths.
 *
 * What a person's work was worth to the business, in pounds, beside what it
 * cost. The headline is **Net benefit**: margin contributed, less discount
 * given, price-exception cost and personal use. It is never called profit:
 * overheads, wages and refunds are not in it, and it is a guide to where a
 * person's work lands, not an account.
 *
 * - **Margin contributed** is measured on the commission basis
 *   (`orderCommission.ts`): each order's margin (lines' price less their
 *   snapshotted cost, before order-level discounts) floored at zero, split
 *   100% solo or 90/10 completer/loader. Lines sold before cost snapshots
 *   existed have no cost and are left out of the margin, and counted, the
 *   same "cost missing" rule commission follows.
 * - **Discount given** is the order's tier, promotion and points discount,
 *   split the same way, so margin less discount is what the order earned.
 * - **Price-exception cost** is the amount sold below cost on the person's
 *   price exceptions. Because each order's margin is floored at zero, a sale
 *   below cost adds nothing to margin, and its loss is counted here instead,
 *   once.
 * - **Personal use** is the cost of goods taken as personal use, charged to
 *   whoever rang it through.
 * - Named-customer capture, new customers, credit recovered, bad debt
 *   originated and refund cost are shown beside it but are not part of Net
 *   benefit: they are either counts or already inside the sales figure.
 *
 * Cost is in every figure here, so it is never sent to a cashier (Q6): the
 * server only builds it for Evidence, which is manager and above.
 */
import { splitValueBroughtIn } from "./staffPerformance";

export interface BenefitLine {
  /** The line's charged total (after any line-level price change). */
  total: number;
  quantity: number;
  /** The cost snapshot per unit; null when not known at the time. */
  unitCost: number | null;
}

export interface BenefitOrder {
  id: string;
  loaderId: string | null;
  completerId: string | null;
  /** Tier + promotion + points discount on the order. */
  discount: number;
  hasCustomer: boolean;
  lines: BenefitLine[];
}

/** Things a person did in the range that are not part of a counted order. */
export interface BenefitSideFacts {
  newCustomers: number;
  creditRecovered: number;
  badDebtOriginated: number;
  priceExceptionCost: number;
  refundCost: number;
  personalUseCost: number;
}

export interface BenefitFigures extends BenefitSideFacts {
  marginContributed: number;
  discountGiven: number;
  /** Orders the person took (loaded, or completed with nobody loading). */
  ordersTaken: number;
  namedCustomerOrders: number;
  namedCustomerCapturePercent: number | null;
  /** Lines in their orders left out of the margin because cost was not known. */
  costMissingLines: number;
  netBenefit: number;
}

interface Acc {
  marginPence: number;
  discountPence: number;
  ordersTaken: number;
  namedCustomerOrders: number;
  costMissingLines: number;
}

const toPence = (pounds: number) => Math.round(pounds * 100);
const fromPence = (pence: number) => pence / 100;

export function emptySideFacts(): BenefitSideFacts {
  return { newCustomers: 0, creditRecovered: 0, badDebtOriginated: 0, priceExceptionCost: 0, refundCost: 0, personalUseCost: 0 };
}

/** One order's margin before order-level discounts, in pence, floored at zero (commission basis). */
export function orderMarginPence(lines: readonly BenefitLine[]): { marginPence: number; costMissingLines: number } {
  let pence = 0;
  let missing = 0;
  for (const l of lines) {
    if (l.unitCost == null) {
      missing += 1;
      continue;
    }
    pence += toPence(l.total) - Math.round(l.unitCost * l.quantity * 100);
  }
  return { marginPence: Math.max(0, pence), costMissingLines: missing };
}

/** Net benefit: margin less discount, price-exception cost and personal use. Never "profit". */
export function netBenefitOf(f: Pick<BenefitFigures, "marginContributed" | "discountGiven" | "priceExceptionCost" | "personalUseCost">): number {
  return fromPence(toPence(f.marginContributed) - toPence(f.discountGiven) - toPence(f.priceExceptionCost) - toPence(f.personalUseCost));
}

/**
 * Benefit per person (by user id), plus `null` for everything nobody is named
 * on. `side` carries each person's non-order facts, already summed.
 */
export function computeBenefit(
  orders: readonly BenefitOrder[],
  side: ReadonlyMap<string, Partial<BenefitSideFacts>> = new Map(),
): Map<string | null, BenefitFigures> {
  const accs = new Map<string | null, Acc>();
  const acc = (userId: string | null): Acc => {
    let a = accs.get(userId);
    if (!a) {
      a = { marginPence: 0, discountPence: 0, ordersTaken: 0, namedCustomerOrders: 0, costMissingLines: 0 };
      accs.set(userId, a);
    }
    return a;
  };

  for (const o of orders) {
    const { marginPence, costMissingLines } = orderMarginPence(o.lines);
    const margin = splitValueBroughtIn(marginPence, o.completerId, o.loaderId);
    const discount = splitValueBroughtIn(toPence(o.discount), o.completerId, o.loaderId);
    const completer = acc(o.completerId);
    completer.marginPence += margin.completerPence;
    completer.discountPence += discount.completerPence;
    if (margin.loaderPence || discount.loaderPence) {
      const loader = acc(o.loaderId);
      loader.marginPence += margin.loaderPence;
      loader.discountPence += discount.loaderPence;
    }
    // Whoever took the sale answers for asking the customer's name.
    const taker = acc(o.loaderId ?? o.completerId);
    taker.ordersTaken += 1;
    if (o.hasCustomer) taker.namedCustomerOrders += 1;
    taker.costMissingLines += costMissingLines;
  }
  for (const userId of side.keys()) acc(userId);

  const out = new Map<string | null, BenefitFigures>();
  for (const [userId, a] of accs) {
    const s = { ...emptySideFacts(), ...(userId != null ? side.get(userId) : undefined) };
    const figures: BenefitFigures = {
      marginContributed: fromPence(a.marginPence),
      discountGiven: fromPence(a.discountPence),
      ordersTaken: a.ordersTaken,
      namedCustomerOrders: a.namedCustomerOrders,
      namedCustomerCapturePercent: a.ordersTaken > 0 ? (a.namedCustomerOrders / a.ordersTaken) * 100 : null,
      costMissingLines: a.costMissingLines,
      newCustomers: s.newCustomers,
      creditRecovered: fromPence(toPence(s.creditRecovered)),
      badDebtOriginated: fromPence(toPence(s.badDebtOriginated)),
      priceExceptionCost: fromPence(toPence(s.priceExceptionCost)),
      refundCost: fromPence(toPence(s.refundCost)),
      personalUseCost: fromPence(toPence(s.personalUseCost)),
      netBenefit: 0,
    };
    figures.netBenefit = netBenefitOf(figures);
    out.set(userId, figures);
  }
  return out;
}

/** Adds benefit figures together (for team rows). Percentages are recomputed from the counts. */
export function sumBenefit(parts: readonly BenefitFigures[]): BenefitFigures {
  const p = (k: keyof BenefitFigures) => parts.reduce((s, f) => s + toPence(Number(f[k]) || 0), 0);
  const c = (k: keyof BenefitFigures) => parts.reduce((s, f) => s + (Number(f[k]) || 0), 0);
  const ordersTaken = c("ordersTaken");
  const namedCustomerOrders = c("namedCustomerOrders");
  const out: BenefitFigures = {
    marginContributed: fromPence(p("marginContributed")),
    discountGiven: fromPence(p("discountGiven")),
    ordersTaken,
    namedCustomerOrders,
    namedCustomerCapturePercent: ordersTaken > 0 ? (namedCustomerOrders / ordersTaken) * 100 : null,
    costMissingLines: c("costMissingLines"),
    newCustomers: c("newCustomers"),
    creditRecovered: fromPence(p("creditRecovered")),
    badDebtOriginated: fromPence(p("badDebtOriginated")),
    priceExceptionCost: fromPence(p("priceExceptionCost")),
    refundCost: fromPence(p("refundCost")),
    personalUseCost: fromPence(p("personalUseCost")),
    netBenefit: 0,
  };
  out.netBenefit = netBenefitOf(out);
  return out;
}

export function emptyBenefit(): BenefitFigures {
  return sumBenefit([]);
}
