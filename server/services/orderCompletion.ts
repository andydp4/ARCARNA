/**
 * The single completion path — and its inverse, reopen — for the Operations
 * Centre (Phase N, N3b; docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "Order
 * lifecycle & timing model" → "Decisions locked" → Completion / Reopen).
 *
 * `completeOrderTx` is called from exactly two places (`PATCH /api/orders/:id`
 * and `POST /api/orders/:id/transition` with `{action:'complete'}`), always
 * inside the CALLER's own `SELECT … FOR UPDATE` transaction and always with
 * the row that lock just read — never a second, independently-read copy. That
 * is the fix for the brief's finding G4: two "Delivered" taps racing each
 * other used to both settle, because the pre-N3b PATCH handler read
 * `currentOrder` on the pooled `db` OUTSIDE any lock, decided `isSettling`
 * from that stale read, and only entered a transaction afterwards — by which
 * point a second tap could have read the very same "not yet settled" row.
 * Locking first and deciding everything from the locked row closes that
 * window structurally rather than by making the race merely unlikely.
 *
 * No bare `db.` read lives in this file — every statement below takes the
 * transaction client that was passed in, including every credit-ledger call
 * (`creditLegTotal`, `openCreditForOrder`, `voidCredit`, all of which accept
 * an explicit client for exactly this reason). `completionSinglePath.test.ts`
 * greps this file's source for a bare `db.` to keep that true.
 *
 * `settleBackdatedShift` is deliberately NOT called from here — the brief is
 * explicit that it "stays post-commit (it is its own idempotent update, do
 * not move it into the transaction)". `completeOrderTx` instead returns the
 * shift the caller should settle once its own transaction has committed.
 */
import { and, desc, eq } from "drizzle-orm";
import type { CashierShift } from "@shared/schema";
import { currentTradingDay } from "@shared/time/tradingDay";
import { cashierShiftForBackdatedOrder } from "./orderDating";
import { creditLegTotal, openCreditForOrder, voidCredit } from "./creditLedger";

/** The snake_case row shape `apps/server/src/db/schema.ts`'s `orders` table returns. */
export type OrderRow = Record<string, unknown>;

export interface CompletionCashierShift {
  cashierId: string | null;
  cashierShiftId: string;
}

export interface CompleteOrderActor {
  /** The auth subject completing the order — becomes `completed_user_id`. */
  userId: string | null;
  /** The cashier code in use right now, if any (migration 057's soft resolution). */
  cashierShift?: CompletionCashierShift | null;
}

export interface CompleteOrderOptions {
  /** "handed_over" (collection) or "delivered" (delivery) — defaults from fulfilment. */
  label?: "handed_over" | "delivered";
  /** When the driver actually reported delivery, if later than the tap itself. */
  actualAt?: string;
}

export interface CompleteOrderResult {
  /** The order row after the settlement patch, freshly `RETURNING`'d. */
  row: OrderRow;
  /** True when this is a re-complete after `reopen` rather than the first settle. */
  resettled: boolean;
  /** The `order_events` row this wrote — kind is always `'completed'`, see the module doc on `resettled` meta below. */
  event: { kind: "completed"; meta: Record<string, unknown> };
  /**
   * A backdated day's shift that needs `settleBackdatedShift` AFTER this
   * transaction commits. Null when the order is not backdated, or there is no
   * cashier shift to resolve one against.
   */
  backdatedShiftToSettle: CashierShift | null;
}

/**
 * Settles `lockedRow` — the caller's already-locked (`SELECT … FOR UPDATE`)
 * read of the order — as completed, inside the caller's transaction.
 *
 * Idempotent only in the sense that matters: `assertTransition`
 * (`shared/orders/opsTransitions.ts`) refuses `complete` on a row that is
 * STILL `status = 'completed'`, so by the time this runs the row is always
 * either completing for the first time, or completing again after a
 * `reopen` — never completing twice in a row. `resettled` tells the two
 * apart by asking whether a `completed` event already exists for this order,
 * not by trusting anything the caller passed in.
 *
 * Every money decision — `isSettling` (implicit: this function always
 * settles, by construction above), which payment method, how much of the
 * total is on tick — reads `lockedRow`, never a second query against `orders`.
 */
export async function completeOrderTx(
  tx: any,
  lockedRow: OrderRow,
  actor: CompleteOrderActor,
  options: CompleteOrderOptions = {},
): Promise<CompleteOrderResult> {
  const { orders } = await import("../../apps/server/src/db/schema");
  const { orderEvents } = await import("@shared/schema");

  const orgId = String(lockedRow.org_id);
  const orderId = String(lockedRow.id);

  // A prior `completed` event can only exist here if the order was reopened
  // since — assertTransition already refused `complete` on a row that is
  // still completed, so this is never "completing the same settlement twice".
  const [priorCompleted] = await tx
    .select({ meta: orderEvents.meta })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orgId, orgId),
        eq(orderEvents.orderId, orderId),
        eq(orderEvents.kind, "completed"),
      ),
    )
    .orderBy(desc(orderEvents.at))
    .limit(1);
  const resettled = Boolean(priorCompleted);

  const paymentMethod = String(lockedRow.payment_method ?? "");
  const orderTotal = parseFloat(String(lockedRow.total ?? "0"));
  const creditAmountToOpen = await creditLegTotal(orderId, paymentMethod, orderTotal, tx);

  // Backdated: belongs to the shift of the day it was SOLD on, not the day it
  // happened to be completed (same rule the create route and the pre-N3b
  // PATCH handler both already applied) — resolved here, from the locked row,
  // settled by the caller after commit.
  let completingCashier = actor.cashierShift ?? null;
  let backdatedShiftToSettle: CashierShift | null = null;
  if (lockedRow.date_kind === "backdated" && completingCashier && actor.userId && lockedRow.created_at) {
    const shift = await cashierShiftForBackdatedOrder(
      orgId,
      actor.userId,
      new Date(lockedRow.created_at as string | Date),
    );
    if (shift) {
      completingCashier = { cashierId: shift.cashierId, cashierShiftId: shift.id };
      backdatedShiftToSettle = shift;
    }
  }

  const fulfilmentMethod = lockedRow.fulfilment_method === "delivery" ? "delivery" : "collection";
  const label = options.label ?? (fulfilmentMethod === "delivery" ? "delivered" : "handed_over");
  const actualAt = options.actualAt ? new Date(options.actualAt) : undefined;
  const now = new Date();

  // Settlement snapshot — rewritten every time this runs (first settle AND
  // every re-settle), from the CURRENT row: reopen is refused once the
  // settlement's trading day has closed, which is what makes rewriting this
  // safe — commission is computed at that close from these very columns, and
  // by the time the day closes they cannot move again.
  const settlementPatch: Record<string, unknown> = {
    status: "completed",
    // The row's own `total` string, verbatim — never round-tripped through a
    // float, so a figure like "12.50" cannot lose its trailing zero on the way
    // back into a numeric(10,2) column.
    settled_total: lockedRow.total,
    settled_at: now,
    updated_at: now,
    ...(actor.userId ? { completed_user_id: actor.userId } : {}),
    ...(completingCashier
      ? {
          completed_cashier_shift_id: completingCashier.cashierShiftId,
          ...(completingCashier.cashierId
            ? {
                completed_cashier_id: completingCashier.cashierId,
                cashier_id: lockedRow.cashier_id ?? completingCashier.cashierId,
              }
            : {}),
        }
      : {}),
  };

  const [updated] = await tx.update(orders).set(settlementPatch).where(eq(orders.id, orderId)).returning();

  // A sale on tick joins (or, on a re-settle, REJOINS after `reopen` voided
  // it) the credit list the moment the goods leave. Guarded inside
  // `openCreditForOrder` itself: zero amount is a no-op, and no customer on a
  // tick sale is a 400 `CREDIT_CUSTOMER_REQUIRED` raised as `CreditError`.
  await openCreditForOrder(
    orgId,
    { id: orderId, customerId: (lockedRow.customer_id as string | null) ?? null, amount: creditAmountToOpen },
    tx,
  );

  const meta: Record<string, unknown> = {
    label,
    fromStatus: lockedRow.status,
    ...(actualAt ? { actualAt: actualAt.toISOString() } : {}),
  };
  if (resettled) {
    // migrations/065_operations_centre.sql's `order_events_kind_check` (N2,
    // already merged) does not include a `resettled` kind, and 066 is
    // reserved for N5a's alerts table — see this package's PR description for
    // why a new migration is not the right fix here. The re-settlement is
    // still a `'completed'` event, carrying the old and new settlement
    // figures the brief's `resettled {from, to}` meta shape asks for, plus
    // `resettled: true` so a reader can tell the two apart without a second
    // query.
    meta.resettled = true;
    meta.from = {
      settledTotal: lockedRow.settled_total ?? null,
      settledAt: lockedRow.settled_at ?? null,
      completedUserId: lockedRow.completed_user_id ?? null,
    };
    meta.to = {
      settledTotal: updated.settled_total ?? null,
      settledAt: updated.settled_at ?? null,
      completedUserId: updated.completed_user_id ?? null,
    };
  }

  await tx.insert(orderEvents).values({ orgId, orderId, kind: "completed", userId: actor.userId, meta });

  return {
    row: updated,
    resettled,
    event: { kind: "completed", meta },
    backdatedShiftToSettle,
  };
}

// ------------------------------------------------------------------- reopen

export type ReopenRefusalCode = "ORDER_REOPEN_REFUSED" | "ORDER_REOPEN_CLOSED_DAY";

/** Thrown by `reopenOrderTx` for every business-rule refusal — the route maps it to 409. */
export class OrderReopenRefusedError extends Error {
  readonly code: ReopenRefusalCode;
  constructor(message: string, code: ReopenRefusalCode = "ORDER_REOPEN_REFUSED") {
    super(message);
    this.code = code;
    this.name = "OrderReopenRefusedError";
  }
}

export interface ReopenOrderActor {
  userId: string | null;
}

export interface ReopenOrderResult {
  row: OrderRow;
  event: { kind: "reopened"; meta: Record<string, unknown> };
  creditVoided: boolean;
}

/**
 * Reverses a completion, inside the caller's transaction and on the same
 * locked row.
 *
 * Refuses (never writes anything) when:
 *  - a refund has been issued against the order — undoing a completion that
 *    has already been partly given back would double the accounting;
 *  - the order's credit leg has payments recorded against it — the debt is no
 *    longer purely notional, so voiding it would erase money already repaid;
 *  - the settlement's trading day has already closed — commission for that
 *    day was computed from these very columns at the close, and reopening
 *    afterwards would move money that has already been paid out. Refunds and
 *    a fresh order are the tools for a mistake noticed after the close.
 *
 * Restores `status` to whatever the interrupted `completed` event recorded as
 * `meta.fromStatus` — never to a status the caller supplied — so an old
 * client sending a stale guess cannot land the order somewhere it never was.
 */
export async function reopenOrderTx(
  tx: any,
  lockedRow: OrderRow,
  actor: ReopenOrderActor,
): Promise<ReopenOrderResult> {
  const { orders } = await import("../../apps/server/src/db/schema");
  const { orderEvents, orderCredit, refunds: refundsTable, creditPayments, organizations, dailyCloseRuns } =
    await import("@shared/schema");

  const orgId = String(lockedRow.org_id);
  const orderId = String(lockedRow.id);

  const [refundRow] = await tx
    .select({ id: refundsTable.id })
    .from(refundsTable)
    .where(eq(refundsTable.orderId, orderId))
    .limit(1);
  if (refundRow) {
    throw new OrderReopenRefusedError(
      "A refund has been issued against this order — reopening it would double-count money already given back.",
    );
  }

  const [creditRow] = await tx
    .select()
    .from(orderCredit)
    .where(and(eq(orderCredit.orderId, orderId), eq(orderCredit.orgId, orgId)))
    .limit(1);
  if (creditRow) {
    const [paymentRow] = await tx
      .select({ id: creditPayments.id })
      .from(creditPayments)
      .where(eq(creditPayments.orderId, orderId))
      .limit(1);
    if (paymentRow) {
      throw new OrderReopenRefusedError(
        "This order's credit has payments recorded against it — settle or void the credit directly rather than reopening the order.",
      );
    }
  }

  const [org] = await tx
    .select({ timezone: organizations.timezone })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const timezone = org?.timezone ?? "Europe/London";
  const settledAt = lockedRow.settled_at ? new Date(lockedRow.settled_at as string | Date) : new Date();
  const tradingDay = currentTradingDay(timezone, settledAt);
  const [closeRun] = await tx
    .select({ id: dailyCloseRuns.id })
    .from(dailyCloseRuns)
    .where(and(eq(dailyCloseRuns.orgId, orgId), eq(dailyCloseRuns.tradingDay, tradingDay)))
    .limit(1);
  if (closeRun) {
    throw new OrderReopenRefusedError(
      `The trading day of ${tradingDay} has already closed — use a refund or a new order instead.`,
      "ORDER_REOPEN_CLOSED_DAY",
    );
  }

  const [completedEvent] = await tx
    .select({ meta: orderEvents.meta })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orgId, orgId),
        eq(orderEvents.orderId, orderId),
        eq(orderEvents.kind, "completed"),
      ),
    )
    .orderBy(desc(orderEvents.at))
    .limit(1);
  const fromStatus = (completedEvent?.meta as { fromStatus?: string } | null)?.fromStatus ?? "pending";

  let creditVoided = false;
  if (creditRow && creditRow.status !== "voided" && creditRow.status !== "written_off") {
    await voidCredit(orgId, orderId, tx);
    creditVoided = true;
  }

  const [updated] = await tx
    .update(orders)
    .set({ status: fromStatus, updated_at: new Date() })
    .where(eq(orders.id, orderId))
    .returning();

  const meta = {
    settledTotal: lockedRow.settled_total ?? null,
    settledAt: lockedRow.settled_at ?? null,
    completedUserId: lockedRow.completed_user_id ?? null,
    creditVoided,
  };
  await tx.insert(orderEvents).values({ orgId, orderId, kind: "reopened", userId: actor.userId, meta });

  return { row: updated, event: { kind: "reopened", meta }, creditVoided };
}
