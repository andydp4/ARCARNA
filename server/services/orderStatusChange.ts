/**
 * One way to change an order's status (v1.2 Phase 1B, "API status changes
 * settle properly"). Shared by `PATCH /api/orders/:id` and the public API's
 * `PATCH /v1/orgs/:orgId/orders/:orderId`, which used to write `status`
 * straight onto the row: an order "completed" that way had no settled total,
 * no credit leg on the Credit List and no commission, and reopening one never
 * voided its credit.
 *
 * Runs inside the caller's transaction, on the row the caller has just locked
 * (`SELECT … FOR UPDATE`), and makes every decision from that one read:
 * completing goes through `completeOrderTx`, reopening through
 * `reopenOrderTx` (only where the caller allows it), holds and resumes stamp
 * `held_at`, and every change writes its `order_events` row and publishes
 * `OrderStatusChanged` in the same transaction.
 */
import { eq } from "drizzle-orm";
import { orderEvents } from "@shared/schema";
import type { CashierShift } from "@shared/schema";
import { completeOrderTx, reopenOrderTx } from "./orderCompletion";
import { assertTransitionRoleAllowed } from "./orderTransitions";
import { publishEventTx } from "../eventBus";

export type OrderStatusChangeOptions = {
  requestedStatus: string;
  actorId: string | null;
  actorRole: string | null;
  cashierShift?: { cashierId: string | null; cashierShiftId: string } | null;
  /** Written into the event's meta so the timeline says where it came from. */
  via: "patch" | "api";
  source: string;
  /**
   * Reopening a completed order voids its credit and moves settled money.
   * The till's managers may; the public API may not (there is no person
   * behind a key to check the reopen window against).
   */
  allowReopen: boolean;
};

export type OrderStatusChangeResult = {
  updated: Record<string, any>;
  eventId: string | null;
  kind: string | null;
  backdatedShiftToSettle: CashierShift | null;
};

export async function changeOrderStatusTx(
  tx: any,
  row: Record<string, any>,
  opts: OrderStatusChangeOptions,
): Promise<OrderStatusChangeResult> {
  const { orders } = await import("../../apps/server/src/db/schema");
  const orderId = String(row.id);
  const requestedStatus = opts.requestedStatus;
  const actorId = opts.actorId;
  const actorRole = opts.actorRole ?? "CASHIER";
  const cashierShift = opts.cashierShift ?? null;
  const via = opts.via;
  const source = opts.source;
  const ctx = { orgId: String(row.org_id) };
  const previousStatus = String(row.status ?? "pending");
  let backdatedShiftToSettle: CashierShift | null = null;

  if (previousStatus === "completed") {
    if (requestedStatus === "completed") {
      const err: any = new Error('This order is already completed — only "reopen" is allowed on it.');
      err.statusCode = 409;
      err.code = "ORDER_TRANSITION_INVALID";
      throw err;
    }
    if (!opts.allowReopen) {
      const err: any = new Error("This order is completed. Reopen it in arcarna before changing its status.");
      err.statusCode = 409;
      err.code = "ORDER_TRANSITION_INVALID";
      throw err;
    }
    assertTransitionRoleAllowed({
      action: "reopen",
      actorId: actorId ?? "",
      actorRole,
      assignedUserId: row.assigned_user_id ?? null,
      completedUserId: row.completed_user_id ?? null,
      settledAt: row.settled_at ? new Date(row.settled_at) : null,
      now: new Date(),
    });
    const result = await reopenOrderTx(tx, row, { userId: actorId });
    const eventId = await publishEventTx(
      tx,
      "OrderStatusChanged",
      orderId,
      {
        orderId: orderId,
        from: previousStatus,
        to: result.row.status,
        changedAt: new Date().toISOString(),
      },
      { source },
    );
    return { updated: result.row, eventId, kind: "reopened" as const, backdatedShiftToSettle };
  }

  if (requestedStatus === "completed") {
    const result = await completeOrderTx(
      tx,
      row,
      { userId: actorId, cashierShift: cashierShift ?? null, role: actorRole },
      {},
    );
    backdatedShiftToSettle = result.backdatedShiftToSettle;
    const eventId = await publishEventTx(
      tx,
      "OrderStatusChanged",
      orderId,
      {
        orderId: orderId,
        from: previousStatus,
        to: "completed",
        changedAt: new Date().toISOString(),
      },
      { source },
    );
    return { updated: result.row, eventId, kind: result.event.kind, backdatedShiftToSettle };
  }

  if (requestedStatus === previousStatus) {
    // Repeats are "no news", the same as every transition stamp.
    return { updated: row, eventId: null, kind: null, backdatedShiftToSettle };
  }

  const now = new Date();
  const patch: Record<string, unknown> = { status: requestedStatus, updated_at: now };
  let eventKind: string;
  let eventMeta: Record<string, unknown>;
  if (requestedStatus === "on-hold") {
    patch.held_at = row.held_at ?? now;
    eventKind = "held";
    eventMeta = { reason: null, fromStatus: previousStatus, via };
  } else if (previousStatus === "on-hold") {
    patch.held_at = null;
    const heldSeconds = row.held_at
      ? Math.max(0, Math.round((now.getTime() - new Date(row.held_at).getTime()) / 1000))
      : 0;
    eventKind = "unheld";
    eventMeta = { heldSeconds, toStatus: requestedStatus, via };
  } else {
    eventKind = "status_changed";
    eventMeta = { from: previousStatus, to: requestedStatus, via };
  }
  // Choosing "awaiting-customer" on the board's status select runs the
  // `ready` transition in spirit (brief, "Decisions locked" → Ready):
  // PATCH writing it stamps `ready_at` too, first-write-wins.
  if (requestedStatus === "awaiting-customer" && !row.ready_at) {
    patch.ready_at = now;
  }

  const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, orderId)).returning();
  await tx.insert(orderEvents).values({
    orgId: ctx.orgId,
    orderId: orderId,
    kind: eventKind,
    userId: actorId,
    at: now,
    meta: eventMeta,
  });
  const eventId = await publishEventTx(
    tx,
    "OrderStatusChanged",
    orderId,
    {
      orderId: orderId,
      from: previousStatus,
      to: requestedStatus,
      changedAt: now.toISOString(),
    },
    { source },
  );

  return { updated, eventId, kind: eventKind, backdatedShiftToSettle };
}
