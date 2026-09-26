/**
 * The full per-order audit: every timestamped stage, who did each one, the
 * customer, the loyalty/promo boost applied, the payment split, and any
 * refund — one order's complete story on one screen. Manager+ only: it
 * carries customer names and money that a cashier's own order list does not.
 */
import { db } from "../db";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { orders, orderItems, products, customers, orderEvents, orderPayments, loyaltyLedger, refunds } from "@shared/schema";
import { resolveUserNames } from "./userDisplayName";

export interface OrderAuditRow {
  id: string;
  shortCode: string;
  createdAt: string;
  status: string;
  channel: string;
  fulfilmentMethod: string;
  paymentMethod: string;
  total: number;
  customerName: string | null;
  enteredByName: string | null;
  completedByName: string | null;
}

export async function getOrderAuditList(orgId: string, startDate: Date, endDate: Date): Promise<OrderAuditRow[]> {
  const rows = await db
    .select({
      id: orders.id,
      createdAt: orders.createdAt,
      status: orders.status,
      channel: orders.channel,
      fulfilmentMethod: orders.fulfilmentMethod,
      paymentMethod: orders.paymentMethod,
      total: orders.total,
      customerId: orders.customerId,
      inputUserId: orders.inputUserId,
      completedUserId: orders.completedUserId,
    })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, startDate), lt(orders.createdAt, endDate)))
    .orderBy(desc(orders.createdAt));

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((id): id is string => !!id))];
  const customerRows = customerIds.length
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
    : [];
  const customerNames = new Map(customerRows.map((c) => [c.id, c.name]));

  const userIds = rows.flatMap((r) => [r.inputUserId, r.completedUserId]).filter((id): id is string => !!id);
  const userNames = await resolveUserNames(userIds);

  return rows.map((r) => ({
    id: r.id,
    shortCode: r.id.slice(0, 8),
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    status: r.status ?? "pending",
    channel: r.channel,
    fulfilmentMethod: r.fulfilmentMethod,
    paymentMethod: r.paymentMethod,
    total: Number(r.total) || 0,
    customerName: r.customerId ? customerNames.get(r.customerId) ?? null : null,
    enteredByName: r.inputUserId ? userNames.get(r.inputUserId) ?? r.inputUserId : null,
    completedByName: r.completedUserId ? userNames.get(r.completedUserId) ?? r.completedUserId : null,
  }));
}

export interface OrderAuditTimelineEntry {
  kind: string;
  at: string;
  actorName: string | null;
  station: string | null;
  meta: unknown;
}

export interface OrderAuditDetail {
  order: {
    id: string;
    createdAt: string;
    settledAt: string | null;
    status: string;
    channel: string;
    fulfilmentMethod: string;
    paymentMethod: string;
    total: number;
    settledTotal: number | null;
    subtotal: number | null;
    tierDiscount: number | null;
    promoCode: string | null;
    promoDiscount: number | null;
    pointsRedeemed: number | null;
    pointsDiscount: number | null;
    vatAmount: number | null;
    deliveryFee: number | null;
    customerName: string | null;
    enteredByName: string | null;
    assignedToName: string | null;
    completedByName: string | null;
  };
  items: Array<{ productName: string | null; quantity: number; unitPrice: number; totalPrice: number }>;
  payments: Array<{ method: string; amount: number; status: string; paidAt: string | null }>;
  loyalty: Array<{ pointsDelta: number; reason: string; createdAt: string }>;
  refunds: Array<{ id: string; total: number; reason: string; createdAt: string; cashierName: string | null }>;
  timeline: OrderAuditTimelineEntry[];
}

export async function getOrderAuditDetail(orgId: string, orderId: string): Promise<OrderAuditDetail | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
  if (!order) return null;

  const [items, paymentRows, loyaltyRows, refundRows, eventRows] = await Promise.all([
    db
      .select({
        productName: products.name,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        totalPrice: orderItems.totalPrice,
      })
      .from(orderItems)
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, orderId)),
    db.select().from(orderPayments).where(eq(orderPayments.orderId, orderId)),
    db.select().from(loyaltyLedger).where(eq(loyaltyLedger.orderId, orderId)),
    db.select().from(refunds).where(eq(refunds.orderId, orderId)),
    db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId)))
      .orderBy(orderEvents.at),
  ]);

  const customerRow = order.customerId
    ? (await db.select({ name: customers.name }).from(customers).where(eq(customers.id, order.customerId)))[0]
    : null;

  const actorIds = [
    order.inputUserId,
    order.assignedUserId,
    order.completedUserId,
    ...eventRows.map((e) => e.userId),
    ...refundRows.map((r) => r.cashierId),
  ].filter((id): id is string => !!id);
  const names = await resolveUserNames(actorIds);

  return {
    order: {
      id: order.id,
      createdAt: (order.createdAt ?? new Date()).toISOString(),
      settledAt: order.settledAt ? order.settledAt.toISOString() : null,
      status: order.status ?? "pending",
      channel: order.channel,
      fulfilmentMethod: order.fulfilmentMethod,
      paymentMethod: order.paymentMethod,
      total: Number(order.total) || 0,
      settledTotal: order.settledTotal != null ? Number(order.settledTotal) : null,
      subtotal: order.subtotal != null ? Number(order.subtotal) : null,
      tierDiscount: order.tierDiscount != null ? Number(order.tierDiscount) : null,
      promoCode: order.promoCode ?? null,
      promoDiscount: order.promoDiscount != null ? Number(order.promoDiscount) : null,
      pointsRedeemed: order.pointsRedeemed ?? null,
      pointsDiscount: order.pointsDiscount != null ? Number(order.pointsDiscount) : null,
      vatAmount: order.vatAmount != null ? Number(order.vatAmount) : null,
      deliveryFee: order.deliveryFee != null ? Number(order.deliveryFee) : null,
      customerName: customerRow?.name ?? null,
      enteredByName: order.inputUserId ? names.get(order.inputUserId) ?? order.inputUserId : null,
      assignedToName: order.assignedUserId ? names.get(order.assignedUserId) ?? order.assignedUserId : null,
      completedByName: order.completedUserId ? names.get(order.completedUserId) ?? order.completedUserId : null,
    },
    items: items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice) || 0,
      totalPrice: Number(i.totalPrice) || 0,
    })),
    payments: paymentRows.map((p) => ({
      method: p.method,
      amount: Number(p.amount) || 0,
      status: p.status,
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    })),
    loyalty: loyaltyRows.map((l) => ({
      pointsDelta: l.pointsDelta,
      reason: l.reason,
      createdAt: l.createdAt ? l.createdAt.toISOString() : "",
    })),
    refunds: refundRows.map((r) => ({
      id: r.id,
      total: Number(r.total) || 0,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      cashierName: r.cashierId ? names.get(r.cashierId) ?? r.cashierId : null,
    })),
    timeline: eventRows.map((e) => ({
      kind: e.kind,
      at: e.at.toISOString(),
      actorName: e.userId ? names.get(e.userId) ?? e.userId : null,
      station: e.station ?? null,
      meta: e.meta ?? null,
    })),
  };
}
