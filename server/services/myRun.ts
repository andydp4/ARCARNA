/**
 * My run (v1.2): a driver's own deliveries, the order they put them in, and
 * "Couldn't deliver". Start run and Delivered go through the existing
 * transition route (out_for_delivery, complete with label "delivered"); only
 * the failed attempt needed a new write, because no transition takes a
 * delivery off the road.
 *
 * Reads the snake_case `orders` (apps/server/src/db/schema.ts) like the board
 * does; the saved order, payments and Signals live in @shared/schema. Same
 * physical database.
 */
import { and, eq, inArray, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { deliveryRunOrders, orderPayments, organizations } from "@shared/schema";
import { currentTradingDay } from "@shared/time/tradingDay";
import { roleRank, type Role } from "@shared/rbac";
import {
  deliveryIssueNote,
  orderRunStops,
  reasonLabel,
  type CouldntDeliverInput,
  type RunStop,
} from "@shared/orders/myRun";
import { resolveUserNames } from "./userDisplayName";

/** Statuses that are not on anybody's run, whatever their stamps say. */
const OFF_RUN_STATUSES = ["completed", "on-hold", "cancelled", "refunded"];

export function isManagerPlus(role: string | null | undefined): boolean {
  return !!role && roleRank(role as Role) >= roleRank("MANAGER");
}

async function orgRunSettings(orgId: string): Promise<{ timezone: string; deliveryLeadMinutes: number }> {
  const { db } = await import("../db");
  const [org] = await db
    .select({ timezone: organizations.timezone, lead: organizations.opsDeliveryLeadMinutes })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return { timezone: org?.timezone || "Europe/London", deliveryLeadMinutes: org?.lead ?? 45 };
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * How much of each order is on tick. Same rule as creditLegTotal: the tick
 * legs of a split, or the whole total when the sale was rung as tick alone.
 */
async function tickAmounts(rows: Array<{ id: string; paymentMethod: string | null; total: string }>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (rows.length === 0) return out;
  const { db } = await import("../db");
  const legs = await db
    .select({ orderId: orderPayments.orderId, method: orderPayments.method, amount: orderPayments.amount })
    .from(orderPayments)
    .where(inArray(orderPayments.orderId, rows.map((r) => r.id)));
  const withLegs = new Set<string>();
  for (const leg of legs) {
    withLegs.add(leg.orderId);
    if (leg.method.toLowerCase() !== "tick") continue;
    out.set(leg.orderId, money((out.get(leg.orderId) ?? 0) + parseFloat(String(leg.amount))));
  }
  for (const r of rows) {
    if (withLegs.has(r.id)) continue;
    if ((r.paymentMethod ?? "").toLowerCase() === "tick") out.set(r.id, money(parseFloat(r.total)));
  }
  return out;
}

async function itemCounts(orderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (orderIds.length === 0) return out;
  const { db } = await import("../../apps/server/src/db");
  const { order_items } = await import("../../apps/server/src/db/schema");
  const rows = await db
    .select({ orderId: order_items.order_id, n: sql<number>`count(*)::int` })
    .from(order_items)
    .where(inArray(order_items.order_id, orderIds))
    .groupBy(order_items.order_id);
  for (const r of rows) if (r.orderId) out.set(r.orderId as string, Number(r.n));
  return out;
}

export async function loadSavedRunOrder(orgId: string, userId: string, day: string): Promise<string[]> {
  const { db } = await import("../db");
  const [row] = await db
    .select({ orderIds: deliveryRunOrders.orderIds })
    .from(deliveryRunOrders)
    .where(and(eq(deliveryRunOrders.orgId, orgId), eq(deliveryRunOrders.userId, userId), eq(deliveryRunOrders.runDate, day)))
    .limit(1);
  return Array.isArray(row?.orderIds) ? row.orderIds : [];
}

/** Saves the driver's order for today. Their own row only: the route passes the signed-in person. */
export async function saveRunOrder(orgId: string, userId: string, orderIds: string[]): Promise<{ day: string; orderIds: string[] }> {
  const { timezone } = await orgRunSettings(orgId);
  const day = currentTradingDay(timezone);
  const { db } = await import("../db");
  const now = new Date();
  await db
    .insert(deliveryRunOrders)
    .values({ orgId, userId, runDate: day, orderIds, updatedAt: now })
    .onConflictDoUpdate({
      target: [deliveryRunOrders.orgId, deliveryRunOrders.userId, deliveryRunOrders.runDate],
      set: { orderIds, updatedAt: now },
    });
  return { day, orderIds };
}

/**
 * One person's run: their open deliveries that are ready or on the road, in
 * the order they saved for today, then by due time. Never anyone else's —
 * the filter is on assigned_user_id, and the route decides whose id that is.
 */
export async function loadRun(
  orgId: string,
  driverUserId: string,
): Promise<{ day: string; timezone: string; stops: RunStop[] }> {
  const { timezone, deliveryLeadMinutes } = await orgRunSettings(orgId);
  const day = currentTradingDay(timezone);
  const { db } = await import("../../apps/server/src/db");
  const { orders, customers } = await import("../../apps/server/src/db/schema");
  const rows = await db
    .select({
      id: orders.id,
      customerId: orders.customer_id,
      customerName: customers.name,
      total: orders.total,
      paymentMethod: orders.payment_method,
      status: orders.status,
      createdAt: orders.created_at,
      enteredAt: orders.entered_at,
      etaGiven: orders.eta_given,
      revisedEta: orders.revised_eta,
      readyAt: orders.ready_at,
      outForDeliveryAt: orders.out_for_delivery_at,
      assignedUserId: orders.assigned_user_id,
      deliveryAddress: orders.delivery_address,
      deliveryPostcode: orders.delivery_postcode,
      deliveryNotes: orders.delivery_notes,
      deliveryIssue: orders.delivery_issue,
      deliveryIssueAt: orders.delivery_issue_at,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customer_id, customers.id))
    .where(
      and(
        eq(orders.org_id, orgId),
        eq(orders.assigned_user_id, driverUserId),
        eq(orders.fulfilment_method, "delivery"),
        or(sql`${orders.status} IS NULL`, notInArray(orders.status, OFF_RUN_STATUSES)),
        or(isNotNull(orders.ready_at), isNotNull(orders.out_for_delivery_at)),
      ),
    );

  const ids = rows.map((r: any) => r.id as string);
  const [counts, ticks, saved] = await Promise.all([
    itemCounts(ids),
    tickAmounts(rows.map((r: any) => ({ id: r.id, paymentMethod: r.paymentMethod, total: String(r.total) }))),
    loadSavedRunOrder(orgId, driverUserId, day),
  ]);

  const stops: RunStop[] = rows.map((r: any) => {
    // The same due time the board shows: the promise, else the lead time
    // from when the order came in.
    const promised = r.revisedEta ?? r.etaGiven;
    const received = r.enteredAt ?? r.createdAt;
    const due = promised ?? (received ? new Date(new Date(received).getTime() + deliveryLeadMinutes * 60_000) : null);
    return {
      id: r.id,
      shortCode: String(r.id).slice(0, 8),
      customerName: r.customerName?.trim() ? r.customerName.trim() : null,
      hasCustomer: Boolean(r.customerId),
      deliveryAddress: r.deliveryAddress ?? null,
      deliveryPostcode: r.deliveryPostcode ?? null,
      deliveryNotes: r.deliveryNotes ?? null,
      deliveryIssue: r.deliveryIssue ?? null,
      deliveryIssueAt: iso(r.deliveryIssueAt),
      itemCount: counts.get(r.id) ?? 0,
      total: String(r.total),
      onTick: ticks.get(r.id) ?? 0,
      dueAt: iso(due),
      createdAt: iso(r.createdAt),
      readyAt: iso(r.readyAt),
      outForDeliveryAt: iso(r.outForDeliveryAt),
      status: r.status ?? "pending",
      assignedUserId: r.assignedUserId ?? null,
    };
  });
  return { day, timezone, stops: orderRunStops(stops, saved) };
}

/** For a manager's "whose run": everyone with a live delivery, plus the viewer. */
export async function listDrivers(orgId: string, viewerUserId: string): Promise<Array<{ userId: string; name: string }>> {
  const { db } = await import("../../apps/server/src/db");
  const { orders } = await import("../../apps/server/src/db/schema");
  const rows = await db
    .selectDistinct({ userId: orders.assigned_user_id })
    .from(orders)
    .where(
      and(
        eq(orders.org_id, orgId),
        eq(orders.fulfilment_method, "delivery"),
        isNotNull(orders.assigned_user_id),
        or(sql`${orders.status} IS NULL`, notInArray(orders.status, OFF_RUN_STATUSES)),
        or(isNotNull(orders.ready_at), isNotNull(orders.out_for_delivery_at)),
      ),
    );
  const ids = [viewerUserId, ...rows.map((r: any) => r.userId as string).filter((id: string) => id !== viewerUserId)];
  const names = await resolveUserNames(ids);
  return ids.map((userId) => ({ userId, name: names.get(userId) ?? userId }));
}

// ---------------------------------------------------------------------------
// Couldn't deliver.
// ---------------------------------------------------------------------------

export class RunError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunError";
  }
}

export type CouldntDeliverActor = { userId: string; role: string };

/**
 * Takes a delivery off the road and back to ready: out_for_delivery_at is
 * cleared, ready_at and the assignee kept, so it is back on the same driver's
 * run for the next attempt. Leaves a note on the board card and tells the
 * managers with a Signal — in the same transaction, so there is never a
 * returned delivery nobody was told about.
 *
 * Only the person the delivery is assigned to, or a manager and above. Only
 * while it is on the road: a repeat (a queued tap replayed twice) is refused
 * with NOT_OUT rather than sending a second Signal.
 */
export async function couldntDeliver(
  orgId: string,
  orderId: string,
  actor: CouldntDeliverActor,
  input: CouldntDeliverInput,
): Promise<{ orderId: string; deliveryIssue: string }> {
  const { withTransaction } = await import("../../apps/server/src/db");
  const { orders } = await import("../../apps/server/src/db/schema");
  const { notify } = await import("./signals");

  return withTransaction(async (tx: any) => {
    const [row] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.org_id, orgId)))
      .for("update")
      .limit(1);
    if (!row) throw new RunError(404, "NOT_FOUND", "Order not found");
    if (row.fulfilment_method !== "delivery") throw new RunError(409, "NOT_A_DELIVERY", "This order is a collection.");
    if (row.assigned_user_id !== actor.userId && !isManagerPlus(actor.role)) {
      throw new RunError(403, "NOT_YOUR_DELIVERY", "Only the person delivering this order can say it could not be delivered.");
    }
    if (row.status === "completed") throw new RunError(409, "ORDER_COMPLETED", "This delivery is finished.");
    if (!row.out_for_delivery_at) {
      throw new RunError(409, "NOT_OUT", "This delivery is not out for delivery.");
    }

    const now = new Date();
    const tapped = input.tappedAt ? new Date(input.tappedAt) : now;
    // A queued tap keeps the time it was made, but never a time in the future.
    const issueAt = tapped.getTime() > now.getTime() ? now : tapped;
    const note = deliveryIssueNote(input.reason, input.note);
    await tx
      .update(orders)
      .set({
        out_for_delivery_at: null,
        ready_at: row.ready_at ?? now,
        delivery_issue: note,
        delivery_issue_at: issueAt,
        updated_at: now,
      })
      .where(eq(orders.id, orderId));

    const names = await resolveUserNames([actor.userId]);
    const who = names.get(actor.userId) ?? actor.userId;
    const code = String(orderId).slice(0, 8);
    const where = row.delivery_postcode ? ` (${row.delivery_postcode})` : "";
    await notify(
      {
        orgId,
        source: "delivery_failed",
        severity: "warning",
        title: `Couldn't deliver #${code}`,
        message: `${who} couldn't deliver #${code}${where}: ${reasonLabel(input.reason)}${
          input.note ? ` — ${input.note}` : ""
        }. It is back to ready.`,
        metadata: { entityId: orderId, reason: input.reason, driverUserId: actor.userId },
      },
      tx,
    );
    return { orderId, deliveryIssue: note };
  });
}
