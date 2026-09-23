/**
 * Price overrides Evidence (v1.2 Phase 4, PRC-09).
 *
 * Every sale line below its minimum or below cost (recorded by the order
 * engine whatever the till switch says, price_exceptions) with the cashier's
 * reason when the till asked for one (price_guard_orders), broken down by
 * cashier, by product and by reason: count, £ under list, £ under cost,
 * unconfirmed count, discount given, and refunds by the same cashier within
 * N hours of the sale (an admin setting).
 *
 * Rows are cut to what the viewer may review (shared/review/exceptions.ts):
 * managers see cashiers', admins see managers' too, the owner sees all, and
 * nobody sees their own here — the cashier's own count is on their shift.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { orders, priceExceptions, priceGuardOrders, products, refunds } from "@shared/schema";
import { mayReviewException } from "@shared/review/exceptions";
import { PRICE_GUARD_REASON_LABELS, isPriceGuardReason } from "@shared/pricing/priceGuard";
import { loadSignalCandidates } from "./signals";
import { resolveUserNames } from "./userDisplayName";
import { orgReviewRules } from "./refundExceptions";
import type { wouldHaveFlaggedRange } from "./priceExceptions";

export type OverrideGroup = {
  key: string;
  name: string;
  /** Sale lines flagged. */
  lines: number;
  /** Orders they are on. */
  orders: number;
  underList: number;
  underCost: number;
  belowCostLines: number;
  unconfirmedOrders: number;
  discountGiven: number;
  refundsWithinHours: number;
};

export type PriceOverrides = {
  period: { from: string; to: string };
  refundWindowHours: number;
  totals: Omit<OverrideGroup, "key" | "name">;
  byCashier: OverrideGroup[];
  byProduct: OverrideGroup[];
  byReason: OverrideGroup[];
};

/** Reason keys beyond the till's six. */
export const NO_REASON_LABELS = {
  unconfirmed: "Unconfirmed (no reason given)",
  not_asked: "Not asked (guard off, or discounts / cost only)",
} as const;

export function reasonKeyOf(reason: string | null, confirmed: boolean | null): string {
  if (isPriceGuardReason(reason)) return reason;
  if (confirmed === false) return "unconfirmed";
  return "not_asked";
}

export function reasonLabelOf(key: string): string {
  if (isPriceGuardReason(key)) return PRICE_GUARD_REASON_LABELS[key];
  return (NO_REASON_LABELS as Record<string, string>)[key] ?? key;
}

type Line = {
  orderId: string;
  productId: string | null;
  productName: string | null;
  person: string | null;
  quantity: number;
  unitPrice: number;
  underList: number;
  underCost: number;
  belowCost: boolean;
  reason: string | null;
  confirmed: boolean | null;
  subtotal: number | null;
  orderDiscount: number;
  orderAt: Date;
};

const num = (v: unknown) => Number(v) || 0;
const money = (v: number) => Math.round(v * 100) / 100;

/** The lines' share of order-level discounts (tier, promotion, points), by value. */
export function lineDiscountShare(line: { quantity: number; unitPrice: number; subtotal: number | null; orderDiscount: number }): number {
  if (!line.subtotal || line.subtotal <= 0 || line.orderDiscount <= 0) return 0;
  return (line.quantity * line.unitPrice * line.orderDiscount) / line.subtotal;
}

/** Aggregates lines into groups. Pure, so the rule is testable without a database. */
export function groupOverrides(
  lines: Line[],
  keyOf: (l: Line) => { key: string; name: string },
  refundsByOrder: Map<string, number>,
): OverrideGroup[] {
  const groups = new Map<string, OverrideGroup & { _orders: Set<string>; _unconfirmed: Set<string> }>();
  for (const l of lines) {
    const { key, name } = keyOf(l);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name,
        lines: 0,
        orders: 0,
        underList: 0,
        underCost: 0,
        belowCostLines: 0,
        unconfirmedOrders: 0,
        discountGiven: 0,
        refundsWithinHours: 0,
        _orders: new Set(),
        _unconfirmed: new Set(),
      };
      groups.set(key, g);
    }
    g.lines += 1;
    g.underList += l.underList;
    g.underCost += l.underCost;
    if (l.belowCost) g.belowCostLines += 1;
    g.discountGiven += lineDiscountShare(l);
    if (!g._orders.has(l.orderId)) {
      g._orders.add(l.orderId);
      g.refundsWithinHours += refundsByOrder.get(l.orderId) ?? 0;
    }
    if (l.confirmed === false) g._unconfirmed.add(l.orderId);
  }
  return [...groups.values()]
    .map(({ _orders, _unconfirmed, ...g }) => ({
      ...g,
      orders: _orders.size,
      unconfirmedOrders: _unconfirmed.size,
      underList: money(g.underList),
      underCost: money(g.underCost),
      discountGiven: money(g.discountGiven),
    }))
    .sort((a, b) => b.underList - a.underList || b.lines - a.lines);
}

export async function priceOverrides(
  orgId: string,
  viewer: { userId: string; role: string },
  range: ReturnType<typeof wouldHaveFlaggedRange>,
): Promise<PriceOverrides> {
  const rules = await orgReviewRules(orgId);
  const person = sql<string | null>`COALESCE(${priceExceptions.userId}, ${orders.inputUserId})`;
  const raw = await db
    .select({
      orderId: priceExceptions.orderId,
      productId: priceExceptions.productId,
      productName: products.name,
      person,
      quantity: priceExceptions.quantity,
      unitPrice: priceExceptions.unitPrice,
      underList: priceExceptions.underList,
      underCost: priceExceptions.underCost,
      belowCost: priceExceptions.belowCost,
      reason: priceGuardOrders.reason,
      confirmed: priceGuardOrders.confirmed,
      subtotal: orders.subtotal,
      tierDiscount: orders.tierDiscount,
      promoDiscount: orders.promoDiscount,
      pointsDiscount: orders.pointsDiscount,
      orderAt: orders.createdAt,
    })
    .from(priceExceptions)
    .innerJoin(orders, eq(priceExceptions.orderId, orders.id))
    .leftJoin(products, eq(priceExceptions.productId, products.id))
    .leftJoin(priceGuardOrders, eq(priceGuardOrders.orderId, priceExceptions.orderId))
    .where(
      and(
        eq(priceExceptions.orgId, orgId),
        gte(priceExceptions.createdAt, range.start),
        lt(priceExceptions.createdAt, range.end),
      ),
    )
    .limit(50_000);

  // Cut to what this viewer may review, by the person's role now.
  const candidates = await loadSignalCandidates(orgId);
  const roleOf = new Map(candidates.map((c) => [c.userId, c.role]));
  const lines: Line[] = raw
    .map((r: any) => ({
      orderId: r.orderId,
      productId: r.productId,
      productName: r.productName,
      person: r.person,
      quantity: num(r.quantity),
      unitPrice: num(r.unitPrice),
      underList: num(r.underList),
      underCost: num(r.underCost),
      belowCost: !!r.belowCost,
      reason: r.reason ?? null,
      confirmed: r.confirmed ?? null,
      subtotal: r.subtotal == null ? null : num(r.subtotal),
      orderDiscount: num(r.tierDiscount) + num(r.promoDiscount) + num(r.pointsDiscount),
      orderAt: r.orderAt ? new Date(r.orderAt) : new Date(0),
    }))
    .filter((l: Line) => mayReviewException(viewer, { userId: l.person, role: l.person ? roleOf.get(l.person) ?? null : null }));

  // Refunds on these sales by the person who rang them, within N hours.
  const refundsByOrder = new Map<string, number>();
  const orderIds = [...new Set(lines.map((l) => l.orderId))];
  if (orderIds.length > 0) {
    const personOf = new Map(lines.map((l) => [l.orderId, { person: l.person, at: l.orderAt }]));
    const windowMs = rules.refundSameCashierHours * 3_600_000;
    for (let i = 0; i < orderIds.length; i += 1000) {
      const chunk = orderIds.slice(i, i + 1000);
      const rows = await db
        .select({ orderId: refunds.orderId, cashierId: refunds.cashierId, createdAt: refunds.createdAt })
        .from(refunds)
        .where(and(eq(refunds.orgId, orgId), inArray(refunds.orderId, chunk)));
      for (const r of rows) {
        const sale = personOf.get(r.orderId);
        if (!sale?.person || r.cashierId !== sale.person) continue;
        const gap = new Date(r.createdAt).getTime() - sale.at.getTime();
        if (gap >= 0 && gap <= windowMs) refundsByOrder.set(r.orderId, (refundsByOrder.get(r.orderId) ?? 0) + 1);
      }
    }
  }

  const names = await resolveUserNames([...new Set(lines.map((l) => l.person).filter(Boolean) as string[])]);
  const byCashier = groupOverrides(
    lines,
    (l) => ({ key: l.person ?? "unknown", name: l.person ? names.get(l.person) ?? l.person : "Unknown (API)" }),
    refundsByOrder,
  );
  const byProduct = groupOverrides(
    lines,
    (l) => ({ key: l.productId ?? "deleted", name: l.productName ?? "Deleted product" }),
    refundsByOrder,
  );
  const byReason = groupOverrides(
    lines,
    (l) => {
      const key = reasonKeyOf(l.reason, l.confirmed);
      return { key, name: reasonLabelOf(key) };
    },
    refundsByOrder,
  );
  const [totals] = groupOverrides(lines, () => ({ key: "all", name: "All" }), refundsByOrder);
  const empty = { lines: 0, orders: 0, underList: 0, underCost: 0, belowCostLines: 0, unconfirmedOrders: 0, discountGiven: 0, refundsWithinHours: 0 };
  const { key: _k, name: _n, ...t } = totals ?? { key: "", name: "", ...empty };
  return {
    period: { from: range.fromIso, to: range.toIso },
    refundWindowHours: rules.refundSameCashierHours,
    totals: t,
    byCashier,
    byProduct,
    byReason,
  };
}
