/**
 * `POST /api/orders/:id/transition` — the state machine (Phase N, N3b;
 * docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "Order lifecycle & timing model"
 * and its "API" section).
 *
 * One `withTransaction`: `SELECT … FOR UPDATE` on the org-scoped row →
 * `assertTransition` (pure legality, `shared/orders/opsTransitions.ts`, N0) →
 * role authorisation (this file — see `assertTransitionRoleAllowed`, the RBAC
 * table's row/time-dependent half that cannot live in a `requireRole`
 * middleware because it depends on who the row's CURRENT assignee or
 * completer is) → the stamp → auto-claim on `ready` / `out_for_delivery` when
 * unassigned → one `order_events` insert → alert generation and resolution
 * (N5a, `server/services/opsAlerts.ts`) → `publishEventTx`. After commit: settle a
 * backdated shift if `complete` touched one, re-read the row as a `BoardOrder`
 * (`server/services/opsBoard.ts`) and push it to `opsBus` — the identical
 * post-commit pattern `POST /api/orders` already uses — then push one
 * `{ type: 'alert' }` event per row `alertAssignedInTx`/`alertCustomerWaitingInTx`
 * actually inserted this transition (N5b gap fix: alert rows used to be
 * written with no live-push counterpart at all, leaving the reconciliation
 * poll — default 60s — as the only delivery path against the brief's ≤25s
 * DoD).
 *
 * `claim` is the one action whose "stamp" is a conditional
 * `UPDATE … WHERE assigned_user_id IS NULL`, per the brief, rather than the
 * general `SET column = COALESCE(column, now())` shape every other stamp
 * uses. The `SELECT … FOR UPDATE` above still runs first: it is what makes
 * two concurrent claims race for real (the second blocks until the first
 * commits, sees the now-assigned row, and gets a real `0`-row `UPDATE`) rather
 * than merely returning different in-memory reads.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { CashierShift } from "@shared/schema";
import { orderEvents } from "@shared/schema";
import { roleRank, type Role } from "@shared/rbac";
import {
  assertTransition,
  OpsTransitionError,
  type TransitionAction,
  type TransitionOrderInput,
} from "@shared/orders/opsTransitions";
import { currentTradingDay } from "@shared/time/tradingDay";
import { orgTimeZone } from "./tradingDayShift";
import { settleBackdatedShift } from "./orderDating";
import { completeOrderTx, reopenOrderTx, type CompleteOrderActor } from "./orderCompletion";
import { getOpsBoardOrder, type BoardOrderPayload } from "./opsBoard";
import { publishOpsEvent } from "./opsBus";
import { resolveDuePromise } from "../routes/orders";
import {
  alertAssignedInTx,
  alertCustomerWaitingInTx,
  loadStaffPresenceInTx,
  publishAlertRows,
  resolveOpsAlertsForTransition,
  type OpsAlertCreatedRow,
} from "./opsAlerts";

const TEN_MINUTES_MS = 10 * 60_000;

function isManagerPlus(role: string): boolean {
  return roleRank(role as Role) >= roleRank("MANAGER");
}

// ------------------------------------------------------------------ errors

export class OrderNotFoundError extends Error {
  readonly status = 404 as const;
  constructor() {
    super("Order not found");
    this.name = "OrderNotFoundError";
  }
}

export class OrderAlreadyAssignedError extends Error {
  readonly status = 409 as const;
  readonly code = "ORDER_ALREADY_ASSIGNED" as const;
  constructor(
    public readonly assignedUserId: string,
    public readonly assignedUserName: string | null,
  ) {
    super(`This order is already assigned to ${assignedUserName ?? assignedUserId}.`);
    this.name = "OrderAlreadyAssignedError";
  }
}

export class TransitionForbiddenError extends Error {
  readonly status = 403 as const;
  readonly code = "ORDER_TRANSITION_FORBIDDEN" as const;
  constructor(message: string) {
    super(message);
    this.name = "TransitionForbiddenError";
  }
}

export class TransitionBadRequestError extends Error {
  readonly status = 400 as const;
  readonly code: string;
  constructor(message: string, code = "ORDER_TRANSITION_INVALID_INPUT") {
    super(message);
    this.code = code;
    this.name = "TransitionBadRequestError";
  }
}

// -------------------------------------------------------------- authorisation

/** What `assertTransitionRoleAllowed` needs about the row and the actor. */
export interface TransitionRoleContext {
  action: TransitionAction;
  actorId: string;
  actorRole: string;
  /** The order's CURRENT assignee, from the locked row — null when unassigned. */
  assignedUserId: string | null;
  /** For `reopen`'s ≤10-minute-by-the-completer rule. */
  completedUserId?: string | null;
  settledAt?: Date | null;
  /** For `unready`'s ≤10-minute-by-the-marker rule — the most recent `ready` event's actor and time. */
  readyMarkedBy?: string | null;
  readyMarkedAt?: Date | null;
  now: Date;
}

/**
 * The row/time-dependent half of the brief's RBAC table (§ API): "assign to
 * someone else", "unclaim someone else's", "reopen / unready after 10 minutes
 * or of someone else's" and "station for others" are all MANAGER+ while the
 * same action on one's OWN order, or within the window, is CASHIER+. None of
 * that can be expressed as a static `requireRole(...)` middleware because it
 * depends on data only the locked row (or, for `unready`, the matching
 * `ready` event) can answer — so it lives here, called from inside the
 * transaction, straight after `assertTransition` and before any write.
 *
 * Pure and synchronous: every input is a plain value the caller already
 * fetched, so this is fully unit-testable without a database
 * (`orderTransitionRoles.test.ts`).
 */
export function assertTransitionRoleAllowed(ctx: TransitionRoleContext): void {
  const managerPlus = isManagerPlus(ctx.actorRole);
  switch (ctx.action) {
    case "assign": {
      const isOwnOrder = ctx.assignedUserId === ctx.actorId;
      if (!isOwnOrder && !managerPlus) {
        throw new TransitionForbiddenError(
          "Only a manager can assign an order that is not currently yours.",
        );
      }
      return;
    }
    case "unclaim": {
      const isOwnOrder = ctx.assignedUserId === ctx.actorId;
      if (!isOwnOrder && !managerPlus) {
        throw new TransitionForbiddenError("Only a manager can release someone else's order.");
      }
      return;
    }
    case "reopen": {
      const isCompleter = Boolean(ctx.completedUserId) && ctx.completedUserId === ctx.actorId;
      const withinWindow =
        ctx.settledAt != null && ctx.now.getTime() - ctx.settledAt.getTime() <= TEN_MINUTES_MS;
      if (!(isCompleter && withinWindow) && !managerPlus) {
        throw new TransitionForbiddenError(
          "Only the person who completed this order, within 10 minutes, or a manager, can reopen it.",
        );
      }
      return;
    }
    case "unready": {
      const isMarker = Boolean(ctx.readyMarkedBy) && ctx.readyMarkedBy === ctx.actorId;
      const withinWindow =
        ctx.readyMarkedAt != null && ctx.now.getTime() - ctx.readyMarkedAt.getTime() <= TEN_MINUTES_MS;
      if (!(isMarker && withinWindow) && !managerPlus) {
        throw new TransitionForbiddenError(
          "Only the person who marked this ready, within 10 minutes, or a manager, can undo it.",
        );
      }
      return;
    }
    default:
      // claim, ready, arrived, out_for_delivery, complete, hold, unhold,
      // set_due — every signed-in CASHIER+ may call these on any open order.
      return;
  }
}

// -------------------------------------------------------------------- runner

export interface RunTransitionActor {
  userId: string;
  role: string;
  cashierShift?: { cashierId: string | null; cashierShiftId: string } | null;
}

export interface RunTransitionParams {
  orgId: string;
  orderId: string;
  actor: RunTransitionActor;
  input: TransitionOrderInput;
}

export interface RunTransitionResult {
  order: BoardOrderPayload;
  event: { id: string; kind: string; at: string } | null;
  changed: boolean;
}

interface ActionOutcome {
  changed: boolean;
  statusChanged: boolean;
  event: { id: string; kind: string; at: Date } | null;
  backdatedShiftToSettle?: CashierShift | null;
  /** Rows `alertAssignedInTx`/`alertCustomerWaitingInTx` actually inserted this transition — pushed to `opsBus` AFTER commit, below. */
  newAlerts?: OpsAlertCreatedRow[];
}

const NO_CHANGE: ActionOutcome = { changed: false, statusChanged: false, event: null };

/**
 * Executes one transition and returns the fresh `BoardOrder`. Throws
 * `OrderNotFoundError`, `OpsTransitionError` (409, from N0), `TransitionForbiddenError`
 * (403), `OrderAlreadyAssignedError` (409), `OrderReopenRefusedError` (409, from
 * `orderCompletion.ts`), `TransitionBadRequestError` (400) or `CreditError`
 * (400, from `creditLedger.ts`) — the route maps each to its status code.
 */
export async function runOrderTransition(params: RunTransitionParams): Promise<RunTransitionResult> {
  const { orgId, orderId, actor, input } = params;
  const action = input.action;

  const { withTransaction } = await import("../../apps/server/src/db");
  const { orders } = await import("../../apps/server/src/db/schema");
  const { publishEventTx } = await import("../eventBus");

  const outcome = await withTransaction(async (tx: any) => {
    const [row] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.org_id, orgId)))
      .for("update")
      .limit(1);
    if (!row) throw new OrderNotFoundError();

    const fulfilmentMethod: "collection" | "delivery" =
      (row.fulfilment_method as string) === "delivery" ? "delivery" : "collection";

    assertTransition(
      {
        status: String(row.status ?? "pending"),
        fulfilmentMethod,
        etaGiven: row.eta_given,
      },
      action,
    );

    const now = new Date();

    let readyMarkedBy: string | null = null;
    let readyMarkedAt: Date | null = null;
    if (action === "unready") {
      const [readyEvent] = await tx
        .select({ userId: orderEvents.userId, at: orderEvents.at })
        .from(orderEvents)
        .where(
          and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId), eq(orderEvents.kind, "ready")),
        )
        .orderBy(desc(orderEvents.at))
        .limit(1);
      readyMarkedBy = readyEvent?.userId ?? null;
      readyMarkedAt = readyEvent ? new Date(readyEvent.at as unknown as string) : null;
    }

    assertTransitionRoleAllowed({
      action,
      actorId: actor.userId,
      actorRole: actor.role,
      assignedUserId: (row.assigned_user_id as string | null) ?? null,
      completedUserId: (row.completed_user_id as string | null) ?? null,
      settledAt: row.settled_at ? new Date(row.settled_at as unknown as string) : null,
      readyMarkedBy,
      readyMarkedAt,
      now,
    });

    const insertEvent = async (kind: string, meta: Record<string, unknown>) => {
      const [inserted] = await tx
        .insert(orderEvents)
        .values({ orgId, orderId, kind, userId: actor.userId, at: now, meta })
        .returning({ id: orderEvents.id, kind: orderEvents.kind, at: orderEvents.at });
      return inserted as { id: string; kind: string; at: Date };
    };

    let outcome: ActionOutcome;
    switch (action) {
      case "claim": {
        const [updated] = await tx
          .update(orders)
          .set({
            assigned_user_id: actor.userId,
            assigned_at: now,
            assigned_by_user_id: actor.userId,
            updated_at: now,
          })
          .where(and(eq(orders.id, orderId), sql`${orders.assigned_user_id} IS NULL`))
          .returning();
        if (!updated) {
          const { resolveUserNames } = await import("./userDisplayName");
          const assignedUserId = row.assigned_user_id as string;
          const names = await resolveUserNames([assignedUserId]);
          throw new OrderAlreadyAssignedError(assignedUserId, names.get(assignedUserId) ?? null);
        }
        const event = await insertEvent("assigned", { from: null, to: actor.userId, by: actor.userId });
        // No `assigned` alert on a self-claim — the brief's own carve-out
        // ("not on self-claim") — but claiming still resolves any station
        // alert (`new_unassigned`/`due_soon`/`late`) OTHER members were
        // carrying for this order, since it now has an owner.
        await resolveOpsAlertsForTransition(tx, {
          orgId,
          orderId,
          action: "claim",
          newAssigneeId: actor.userId,
          resolvedByUserId: actor.userId,
        });
        outcome = { changed: true, statusChanged: false, event };
        break;
      }
      case "unclaim": {
        if (!row.assigned_user_id) {
          outcome = NO_CHANGE;
          break;
        }
        await tx
          .update(orders)
          .set({ assigned_user_id: null, assigned_at: null, assigned_by_user_id: null, updated_at: now })
          .where(eq(orders.id, orderId));
        const event = await insertEvent("unassigned", { from: row.assigned_user_id, by: actor.userId });
        outcome = { changed: true, statusChanged: false, event };
        break;
      }
      case "assign": {
        const targetUserId = input.userId;
        if (!targetUserId) {
          throw new TransitionBadRequestError('"assign" requires userId.');
        }
        if (row.assigned_user_id === targetUserId) {
          outcome = NO_CHANGE;
          break;
        }
        await tx
          .update(orders)
          .set({
            assigned_user_id: targetUserId,
            assigned_at: now,
            assigned_by_user_id: actor.userId,
            updated_at: now,
          })
          .where(eq(orders.id, orderId));
        const event = await insertEvent("assigned", {
          from: row.assigned_user_id ?? null,
          to: targetUserId,
          by: actor.userId,
        });
        // brief: "the new assignee (not on self-claim...)" — `shouldAlertAssigned`
        // inside `alertAssignedInTx` still silences this when `targetUserId
        // === actor.userId` (someone assigning the order to themselves).
        const assignAlerts = await alertAssignedInTx(tx, {
          orgId,
          orderId,
          assigneeId: targetUserId,
          actorId: actor.userId,
          assignedAt: now,
        });
        await resolveOpsAlertsForTransition(tx, {
          orgId,
          orderId,
          action: "assign",
          newAssigneeId: targetUserId,
          resolvedByUserId: actor.userId,
        });
        outcome = { changed: true, statusChanged: false, event, newAlerts: assignAlerts };
        break;
      }
      case "ready": {
        if (row.ready_at) {
          outcome = NO_CHANGE;
          break;
        }
        const patch: Record<string, unknown> = { ready_at: now, updated_at: now };
        let autoAssignedTo: string | null = null;
        if (!row.assigned_user_id) {
          patch.assigned_user_id = actor.userId;
          patch.assigned_at = now;
          patch.assigned_by_user_id = actor.userId;
          autoAssignedTo = actor.userId;
        }
        await tx.update(orders).set(patch).where(eq(orders.id, orderId));
        const event = await insertEvent("ready", autoAssignedTo ? { autoAssignedTo } : {});
        // brief: "`ready` resolves `customer_waiting` and, on collection,
        // `due_soon` / `late`". Auto-claim above never raises an `assigned`
        // alert — the actor auto-claiming IS the new assignee, the same
        // self-claim carve-out `claim` itself applies.
        await resolveOpsAlertsForTransition(tx, {
          orgId,
          orderId,
          action: "ready",
          fulfilmentMethod,
          resolvedByUserId: actor.userId,
        });
        outcome = { changed: true, statusChanged: false, event };
        break;
      }
      case "unready": {
        if (!row.ready_at) {
          outcome = NO_CHANGE;
          break;
        }
        await tx.update(orders).set({ ready_at: null, updated_at: now }).where(eq(orders.id, orderId));
        const event = await insertEvent("unready", { by: actor.userId });
        outcome = { changed: true, statusChanged: false, event };
        break;
      }
      case "arrived": {
        if (row.customer_arrived_at) {
          outcome = NO_CHANGE;
          break;
        }
        await tx.update(orders).set({ customer_arrived_at: now, updated_at: now }).where(eq(orders.id, orderId));
        const event = await insertEvent("arrived", {});
        // brief: "`customer_waiting` | assignee, else present Collection
        // members | on `arrived` WHEN NOT READY". `assertTransition` already
        // confines `arrived` to collection orders.
        let arrivedAlerts: OpsAlertCreatedRow[] = [];
        if (!row.ready_at) {
          const staff = await loadStaffPresenceInTx(tx, orgId, now);
          arrivedAlerts = await alertCustomerWaitingInTx(tx, {
            orgId,
            orderId,
            assigneeId: (row.assigned_user_id as string | null) ?? null,
            staff,
            arrivedAt: now,
          });
        }
        outcome = { changed: true, statusChanged: false, event, newAlerts: arrivedAlerts };
        break;
      }
      case "out_for_delivery": {
        if (row.out_for_delivery_at) {
          outcome = NO_CHANGE;
          break;
        }
        // Implies ready (lifecycle diagram: "Ready|Claimed --> OnTheRoad"):
        // stamped silently alongside rather than as its own event, since the
        // dispatch tap is the thing that actually happened.
        const patch: Record<string, unknown> = { out_for_delivery_at: now, updated_at: now };
        if (!row.ready_at) patch.ready_at = now;
        let autoAssignedTo: string | null = null;
        if (!row.assigned_user_id) {
          patch.assigned_user_id = actor.userId;
          patch.assigned_at = now;
          patch.assigned_by_user_id = actor.userId;
          autoAssignedTo = actor.userId;
        }
        await tx.update(orders).set(patch).where(eq(orders.id, orderId));
        const event = await insertEvent("out_for_delivery", autoAssignedTo ? { autoAssignedTo } : {});
        outcome = { changed: true, statusChanged: false, event };
        break;
      }
      case "hold": {
        if (row.status === "on-hold") {
          outcome = NO_CHANGE;
          break;
        }
        await tx
          .update(orders)
          .set({ status: "on-hold", held_at: row.held_at ?? now, updated_at: now })
          .where(eq(orders.id, orderId));
        const event = await insertEvent("held", { reason: input.reason ?? null, fromStatus: row.status });
        // brief: "`hold` resolves `due_soon`" (only — `late` is left standing;
        // a held order can still be genuinely overdue).
        await resolveOpsAlertsForTransition(tx, { orgId, orderId, action: "hold", resolvedByUserId: actor.userId });
        outcome = { changed: true, statusChanged: true, event };
        break;
      }
      case "unhold": {
        if (row.status !== "on-hold") {
          outcome = NO_CHANGE;
          break;
        }
        const [heldEvent] = await tx
          .select({ meta: orderEvents.meta })
          .from(orderEvents)
          .where(
            and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId), eq(orderEvents.kind, "held")),
          )
          .orderBy(desc(orderEvents.at))
          .limit(1);
        const toStatus = (heldEvent?.meta as { fromStatus?: string } | null)?.fromStatus ?? "pending";
        const heldSeconds = row.held_at
          ? Math.max(0, Math.round((now.getTime() - new Date(row.held_at as unknown as string).getTime()) / 1000))
          : 0;
        await tx.update(orders).set({ status: toStatus, held_at: null, updated_at: now }).where(eq(orders.id, orderId));
        const event = await insertEvent("unheld", { heldSeconds, toStatus });
        outcome = { changed: true, statusChanged: true, event };
        break;
      }
      case "set_due": {
        const receivedAt = (row.entered_at as Date | null) ?? (row.created_at as Date | null) ?? now;
        const timezone = await orgTimeZone(orgId);
        const referenceInstant =
          row.date_kind === "live" ? receivedAt : ((row.created_at as Date | null) ?? receivedAt);
        const tradingDate = currentTradingDay(timezone, referenceInstant);
        const resolved = resolveDuePromise(
          { dueInMinutes: input.dueInMinutes, dueTime: input.dueTime },
          receivedAt,
          tradingDate,
          timezone,
        );
        if (!resolved.ok) throw new TransitionBadRequestError(resolved.message, resolved.code);
        if (!resolved.etaGiven) {
          throw new TransitionBadRequestError('"set_due" requires dueInMinutes or dueTime.');
        }
        await tx
          .update(orders)
          .set({ eta_given: resolved.etaGiven, original_eta: resolved.etaGiven, updated_at: now })
          .where(eq(orders.id, orderId));
        const event = await insertEvent("due_set", { dueAt: resolved.etaGiven.toISOString(), source: "manual" });
        outcome = { changed: true, statusChanged: false, event };
        break;
      }
      case "complete": {
        const completeActor: CompleteOrderActor = { userId: actor.userId, cashierShift: actor.cashierShift ?? null };
        const result = await completeOrderTx(tx, row, completeActor, {
          label: input.label,
          actualAt: input.actualAt,
        });
        // `completeOrderTx` already inserted the `order_events` row directly
        // (it needs to compute the resettle meta itself) — this re-selects
        // that exact row rather than re-deriving its id, so the response's
        // `event` always names the row that was really written.
        const [inserted] = await tx
          .select({ id: orderEvents.id, kind: orderEvents.kind, at: orderEvents.at })
          .from(orderEvents)
          .where(
            and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId), eq(orderEvents.kind, "completed")),
          )
          .orderBy(desc(orderEvents.at))
          .limit(1);
        // brief: "`complete` / `delete` resolve all". `delete` lives in
        // server/routes/orders.ts, outside this package's touch list — its
        // alerts are caught by `sweepOpsAlerts`'s orphan cleanup instead (see
        // server/services/opsAlerts.ts's module doc).
        await resolveOpsAlertsForTransition(tx, { orgId, orderId, action: "complete", resolvedByUserId: actor.userId });
        outcome = {
          changed: true,
          statusChanged: true,
          event: inserted ?? null,
          backdatedShiftToSettle: result.backdatedShiftToSettle,
        };
        break;
      }
      case "reopen": {
        await reopenOrderTx(tx, row, { userId: actor.userId });
        const [inserted] = await tx
          .select({ id: orderEvents.id, kind: orderEvents.kind, at: orderEvents.at })
          .from(orderEvents)
          .where(
            and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId), eq(orderEvents.kind, "reopened")),
          )
          .orderBy(desc(orderEvents.at))
          .limit(1);
        outcome = { changed: true, statusChanged: true, event: inserted ?? null };
        break;
      }
      default: {
        // Exhaustiveness: TRANSITION_ACTIONS (shared/orders/opsTransitions.ts)
        // is a closed union, so every case above is real; this only fires if
        // that union grows without this switch being updated to match.
        const exhaustive: never = action;
        throw new TransitionBadRequestError(`Unknown transition action: ${String(exhaustive)}`);
      }
    }

    if (outcome.changed && outcome.event) {
      await publishEventTx(
        tx,
        outcome.statusChanged ? "OrderStatusChanged" : "OrderStageChanged",
        orderId,
        { orderId, orgId, action, kind: outcome.event.kind },
        { actor: { type: "user", id: actor.userId }, source: "ops-transition" },
      );
    }

    return outcome;
  });

  if (outcome.backdatedShiftToSettle) {
    await settleBackdatedShift(orgId, outcome.backdatedShiftToSettle);
  }

  // Fresh re-read AFTER commit, never reused from inside the transaction —
  // the identical pattern `POST /api/orders` already uses (server/routes/
  // orders.ts), so a card pushed over the stream can never disagree with one
  // `GET /api/orders/board` would have fetched for the same row.
  const boardOrder = await getOpsBoardOrder(orgId, orderId);
  if (!boardOrder) throw new OrderNotFoundError();
  try {
    publishOpsEvent(orgId, { type: "order", order: boardOrder });
  } catch (pushError) {
    console.error("[OrderTransitions] Failed to push the transitioned order to the board stream:", pushError);
  }
  // brief, architecture: `orderTransitions` emits `{ type: 'alert', alert }`
  // after commit alongside the order delta — `publishAlertRows` is itself
  // best-effort per row, so a push failure here can never undo the
  // already-committed transition or its alert row.
  if (outcome.newAlerts && outcome.newAlerts.length > 0) {
    publishAlertRows(outcome.newAlerts);
  }

  return {
    order: boardOrder,
    event: outcome.event ? { id: outcome.event.id, kind: outcome.event.kind, at: outcome.event.at.toISOString() } : null,
    changed: outcome.changed,
  };
}

export { OpsTransitionError };
