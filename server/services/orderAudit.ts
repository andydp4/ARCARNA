/**
 * The full per-order audit: every timestamped stage, who did each one, the
 * customer, the loyalty/promo boost applied, the payment split, and any
 * refund — one order's complete story on one screen. Manager+ only: it
 * carries customer names and money that a cashier's own order list does not.
 *
 * Dates are trading days (06:00–06:00 in the org's timezone), inclusive at
 * both ends, like every other Evidence page. Deleted orders stay in the list:
 * their `order_events` "deleted" row outlives the order and is the audit.
 *
 * Who did what follows Q14 (the Order Timing page's rule): below admin, a
 * viewer sees cashiers' names and their own; anyone else reads as hidden.
 */
import { db } from "../db";
import { and, desc, eq, gte, inArray, lt, or, isNull, ne, sql } from "drizzle-orm";
import { orders, orderItems, products, customers, orderEvents, orderPayments, loyaltyLedger, refunds, allowedUsers } from "@shared/schema";
import { isRole, roleRank } from "@shared/rbac";
import { shiftIsoDate, tradingDayBounds } from "@shared/time/tradingDay";
import { resolveUserNames } from "./userDisplayName";
import { orgTimeZone } from "./tradingDayShift";
import { mayFilterEvidenceBy, type EvidenceViewer } from "./evidenceStaff";

/** Longest range the list answers in one go (about a quarter). */
export const ORDER_AUDIT_MAX_DAYS = 93;
/** Most rows returned; the response says when there were more. */
export const ORDER_AUDIT_ROW_LIMIT = 2000;
/** What a person reads as when the viewer may not see who it is (Q14). */
export const HIDDEN_NAME = "Senior staff (hidden)";

export class OrderAuditError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(iso: string): boolean {
  if (!ISO_DAY.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** `from`/`to` (or the older `startDate`/`endDate`) as trading days, inclusive, validated and capped. */
export function parseOrderAuditQuery(q: Record<string, unknown>): { fromIso: string; toIso: string } {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 10) : null);
  const fromIso = str(q.from) ?? str(q.startDate);
  const toIso = str(q.to) ?? str(q.endDate) ?? fromIso;
  if (!fromIso || !toIso || !isRealDate(fromIso) || !isRealDate(toIso)) {
    throw new OrderAuditError("Dates must be real days, as YYYY-MM-DD.", 400);
  }
  if (fromIso > toIso) throw new OrderAuditError("From must be on or before To.", 400);
  if (shiftIsoDate(fromIso, ORDER_AUDIT_MAX_DAYS - 1) < toIso) {
    throw new OrderAuditError(`Pick at most ${ORDER_AUDIT_MAX_DAYS} days at a time.`, 400);
  }
  return { fromIso, toIso };
}

/** Resolves ids to display names, masking anyone the viewer may not see. */
/**
 * The org's staff, reachable by EITHER of each person's ids. Orders and
 * events keyed in before someone's login was linked to Clerk carry their
 * legacy id; keyed by one id only, those rows would read as an unknown
 * person and be hidden from a manager — even the manager's own.
 */
async function staffByAnyId(orgId: string): Promise<Map<string, { name: string; role: string; primary: string }>> {
  const rows = await db
    .select({ authUserId: allowedUsers.authUserId, replitUserId: allowedUsers.replitUserId, name: allowedUsers.name, role: allowedUsers.role })
    .from(allowedUsers)
    .where(
      and(
        ne(allowedUsers.role, "CUSTOMER"),
        or(eq(allowedUsers.orgId, orgId), and(isNull(allowedUsers.orgId), eq(allowedUsers.role, "SUPER_ADMIN"))),
      ),
    );
  const map = new Map<string, { name: string; role: string; primary: string }>();
  for (const r of rows) {
    const role = String(r.role ?? "CASHIER");
    const primary = r.authUserId || r.replitUserId;
    const person = { name: r.name?.trim() || `Unnamed ${role.toLowerCase()}`, role, primary };
    for (const id of [r.authUserId, r.replitUserId]) if (id) map.set(id, person);
  }
  return map;
}

async function namer(orgId: string, ids: Iterable<string>, viewer: EvidenceViewer): Promise<(id: string | null | undefined) => string | null> {
  const all = [...new Set([...ids].filter(Boolean))];
  const seesEveryone = !!viewer.role && isRole(viewer.role) && roleRank(viewer.role) >= roleRank("ADMIN");
  const [names, people] = await Promise.all([resolveUserNames(all), seesEveryone ? Promise.resolve(null) : staffByAnyId(orgId)]);
  const me = viewer.userId ? people?.get(viewer.userId)?.primary ?? viewer.userId : null;
  return (id) => {
    if (!id) return null;
    if (people) {
      const person = people.get(id);
      // Compared by the person, not the raw id, so both of someone's ids count as them.
      const target = { id: person?.primary ?? id, role: person?.role ?? null };
      if (!mayFilterEvidenceBy({ userId: me, role: viewer.role }, target)) return HIDDEN_NAME;
      return person?.name ?? names.get(id) ?? id;
    }
    return names.get(id) ?? id;
  };
}

/** A UTC instant as the naive-UTC timestamp these columns hold. */
const utcTs = (d: Date) => sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export interface OrderAuditRow {
  id: string;
  shortCode: string;
  createdAt: string;
  status: string;
  channel: string | null;
  fulfilmentMethod: string | null;
  paymentMethod: string | null;
  total: number;
  customerName: string | null;
  enteredByName: string | null;
  completedByName: string | null;
  /** Set on an order that has since been deleted: when, and by whom. */
  deletedAt: string | null;
  deletedByName: string | null;
}

export interface OrderAuditList {
  period: { from: string; to: string; timezone: string };
  rows: OrderAuditRow[];
  /** True when there were more than `limit` orders; narrow the range to see them all. */
  truncated: boolean;
  limit: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getOrderAuditList(
  orgId: string,
  range: { fromIso: string; toIso: string },
  viewer: EvidenceViewer,
): Promise<OrderAuditList> {
  const timezone = await orgTimeZone(orgId);
  const start = tradingDayBounds(range.fromIso, timezone).start;
  const end = tradingDayBounds(range.toIso, timezone).end;

  const [rows, deletedRows] = await Promise.all([
    db
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
      .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, start), lt(orders.createdAt, end)))
      .orderBy(desc(orders.createdAt))
      .limit(ORDER_AUDIT_ROW_LIMIT + 1),
    // Deleted orders TAKEN in range, whenever they were deleted: when an
    // order was taken is recorded on the delete (newer deletions), else on its
    // "received" event, else — for the oldest rows — it is the deletion itself.
    // Decided in the query, so the row limit counts only rows that belong here.
    (() => {
      const takenAt = sql`COALESCE(
        (${orderEvents.meta}->>'createdAt')::timestamptz AT TIME ZONE 'UTC',
        (SELECT min(r.at) FROM order_events r
          WHERE r.org_id = ${orderEvents.orgId} AND r.order_id = ${orderEvents.orderId} AND r.kind = 'received'),
        ${orderEvents.at})`;
      return db
        .select({ orderId: orderEvents.orderId, at: orderEvents.at, userId: orderEvents.userId, meta: orderEvents.meta })
        .from(orderEvents)
        .where(
          and(
            eq(orderEvents.orgId, orgId),
            eq(orderEvents.kind, "deleted"),
            gte(orderEvents.at, start),
            sql`${takenAt} >= ${utcTs(start)}`,
            sql`${takenAt} < ${utcTs(end)}`,
          ),
        )
        .orderBy(desc(orderEvents.at))
        .limit(ORDER_AUDIT_ROW_LIMIT + 1);
    })(),
  ]);

  // When a deleted order was entered is on its "received" event, if it had one.
  const deletedIds = deletedRows.map((d) => d.orderId).filter((id): id is string => !!id);
  const receivedRows = deletedIds.length
    ? await db
        .select({ orderId: orderEvents.orderId, at: orderEvents.at, userId: orderEvents.userId })
        .from(orderEvents)
        .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.kind, "received"), inArray(orderEvents.orderId, deletedIds)))
    : [];
  const received = new Map(receivedRows.map((r) => [r.orderId, r]));

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((id): id is string => !!id))];
  const customerRows = customerIds.length
    ? await db
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(and(eq(customers.orgId, orgId), inArray(customers.id, customerIds)))
    : [];
  const customerNames = new Map(customerRows.map((c) => [c.id, c.name]));

  const name = await namer(
    orgId,
    [
      ...rows.flatMap((r) => [r.inputUserId, r.completedUserId]),
      ...deletedRows.map((d) => d.userId),
      ...deletedRows.map((d) => (d.meta as Record<string, unknown> | null)?.inputUserId).filter((v): v is string => typeof v === "string"),
      ...receivedRows.map((r) => r.userId),
    ].filter((id): id is string => !!id),
    viewer,
  );

  const live: OrderAuditRow[] = rows.map((r) => ({
    id: r.id,
    shortCode: r.id.slice(0, 8),
    createdAt: (r.createdAt ?? new Date()).toISOString(),
    status: r.status ?? "pending",
    channel: r.channel,
    fulfilmentMethod: r.fulfilmentMethod,
    paymentMethod: r.paymentMethod,
    total: num(r.total),
    customerName: r.customerId ? customerNames.get(r.customerId) ?? null : null,
    enteredByName: name(r.inputUserId),
    completedByName: name(r.completedUserId),
    deletedAt: null,
    deletedByName: null,
  }));

  const liveIds = new Set(live.map((r) => r.id));
  // When a deleted order was taken: recorded on the delete (newer deletions),
  // else its "received" event, else — for the oldest rows — the deletion itself.
  const takenAt = (d: (typeof deletedRows)[number]): Date => {
    const meta = (d.meta ?? {}) as Record<string, unknown>;
    if (typeof meta.createdAt === "string" && !Number.isNaN(Date.parse(meta.createdAt))) return new Date(meta.createdAt);
    return received.get(d.orderId!)?.at ?? d.at;
  };
  const gone: OrderAuditRow[] = deletedRows
    .filter((d) => d.orderId && !liveIds.has(d.orderId))
    .filter((d) => {
      const t = takenAt(d).getTime();
      return t >= start.getTime() && t < end.getTime();
    })
    .map((d) => {
      const meta = (d.meta ?? {}) as Record<string, unknown>;
      const rec = received.get(d.orderId!);
      const enteredBy = typeof meta.inputUserId === "string" ? meta.inputUserId : rec?.userId;
      return {
        id: d.orderId!,
        shortCode: d.orderId!.slice(0, 8),
        createdAt: takenAt(d).toISOString(),
        status: "deleted",
        channel: null,
        fulfilmentMethod: typeof meta.fulfilmentMethod === "string" ? meta.fulfilmentMethod : null,
        paymentMethod: null,
        total: num(meta.total),
        customerName: typeof meta.customerName === "string" ? meta.customerName : null,
        enteredByName: name(enteredBy),
        completedByName: null,
        deletedAt: d.at.toISOString(),
        deletedByName: name(d.userId) ?? "System",
      };
    });

  const all = [...live, ...gone].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const truncated = rows.length > ORDER_AUDIT_ROW_LIMIT || deletedRows.length > ORDER_AUDIT_ROW_LIMIT || all.length > ORDER_AUDIT_ROW_LIMIT;
  return {
    period: { from: range.fromIso, to: range.toIso, timezone },
    rows: all.slice(0, ORDER_AUDIT_ROW_LIMIT),
    truncated,
    limit: ORDER_AUDIT_ROW_LIMIT,
  };
}

export interface OrderAuditTimelineEntry {
  kind: string;
  at: string;
  actorName: string | null;
  station: string | null;
}

export interface OrderAuditDetail {
  order: {
    id: string;
    createdAt: string;
    settledAt: string | null;
    status: string;
    channel: string | null;
    fulfilmentMethod: string | null;
    paymentMethod: string | null;
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
    deletedAt: string | null;
    deletedByName: string | null;
  };
  items: Array<{ productName: string | null; quantity: number; unitPrice: number; totalPrice: number }>;
  payments: Array<{ method: string; amount: number; status: string; paidAt: string | null }>;
  loyalty: Array<{ pointsDelta: number; reason: string; createdAt: string }>;
  refunds: Array<{ id: string; total: number; reason: string; createdAt: string; cashierName: string | null }>;
  timeline: OrderAuditTimelineEntry[];
}

const numOrNull = (v: unknown) => (v != null ? Number(v) : null);

export async function getOrderAuditDetail(orgId: string, orderId: string, viewer: EvidenceViewer): Promise<OrderAuditDetail | null> {
  const eventRows = await db
    .select()
    .from(orderEvents)
    .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId)))
    .orderBy(orderEvents.at);
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));

  const timeline = (name: (id: string | null | undefined) => string | null): OrderAuditTimelineEntry[] =>
    eventRows.map((e) => ({ kind: e.kind, at: e.at.toISOString(), actorName: name(e.userId), station: e.station ?? null }));

  if (!order) {
    // A deleted order: its events (scoped to this org above) are all that is left.
    const deleted = eventRows.find((e) => e.kind === "deleted");
    if (!deleted) return null;
    const meta = (deleted.meta ?? {}) as Record<string, unknown>;
    const receivedEv = eventRows.find((e) => e.kind === "received");
    const name = await namer(
      orgId,
      [...eventRows.map((e) => e.userId), typeof meta.inputUserId === "string" ? meta.inputUserId : null].filter((id): id is string => !!id),
      viewer,
    );
    return {
      order: {
        id: orderId,
        createdAt:
          typeof meta.createdAt === "string" && !Number.isNaN(Date.parse(meta.createdAt))
            ? new Date(meta.createdAt).toISOString()
            : (receivedEv?.at ?? eventRows[0].at).toISOString(),
        settledAt: null,
        status: "deleted",
        channel: null,
        fulfilmentMethod: typeof meta.fulfilmentMethod === "string" ? meta.fulfilmentMethod : null,
        paymentMethod: null,
        total: num(meta.total),
        settledTotal: null,
        subtotal: null,
        tierDiscount: null,
        promoCode: null,
        promoDiscount: null,
        pointsRedeemed: null,
        pointsDiscount: null,
        vatAmount: null,
        deliveryFee: null,
        customerName: typeof meta.customerName === "string" ? meta.customerName : null,
        enteredByName: name(typeof meta.inputUserId === "string" ? meta.inputUserId : receivedEv?.userId),
        assignedToName: null,
        completedByName: null,
        deletedAt: deleted.at.toISOString(),
        deletedByName: name(deleted.userId) ?? "System",
      },
      items: [],
      payments: [],
      loyalty: [],
      refunds: [],
      timeline: timeline(name),
    };
  }

  const [items, paymentRows, loyaltyRows, refundRows] = await Promise.all([
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
  ]);

  const customerRow = order.customerId
    ? (
        await db
          .select({ name: customers.name })
          .from(customers)
          .where(and(eq(customers.id, order.customerId), eq(customers.orgId, orgId)))
      )[0]
    : null;

  const name = await namer(
    orgId,
    [
      order.inputUserId,
      order.assignedUserId,
      order.completedUserId,
      ...eventRows.map((e) => e.userId),
      ...refundRows.map((r) => r.cashierId),
    ].filter((id): id is string => !!id),
    viewer,
  );

  return {
    order: {
      id: order.id,
      createdAt: (order.createdAt ?? new Date()).toISOString(),
      settledAt: order.settledAt ? order.settledAt.toISOString() : null,
      status: order.status ?? "pending",
      channel: order.channel,
      fulfilmentMethod: order.fulfilmentMethod,
      paymentMethod: order.paymentMethod,
      total: num(order.total),
      settledTotal: numOrNull(order.settledTotal),
      subtotal: numOrNull(order.subtotal),
      tierDiscount: numOrNull(order.tierDiscount),
      promoCode: order.promoCode ?? null,
      promoDiscount: numOrNull(order.promoDiscount),
      pointsRedeemed: order.pointsRedeemed ?? null,
      pointsDiscount: numOrNull(order.pointsDiscount),
      vatAmount: numOrNull(order.vatAmount),
      deliveryFee: numOrNull(order.deliveryFee),
      customerName: customerRow?.name ?? null,
      enteredByName: name(order.inputUserId),
      assignedToName: name(order.assignedUserId),
      completedByName: name(order.completedUserId),
      deletedAt: null,
      deletedByName: null,
    },
    items: items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: num(i.unitPrice),
      totalPrice: num(i.totalPrice),
    })),
    payments: paymentRows.map((p) => ({
      method: p.method,
      amount: num(p.amount),
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
      total: num(r.total),
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      cashierName: name(r.cashierId),
    })),
    timeline: timeline(name),
  };
}
