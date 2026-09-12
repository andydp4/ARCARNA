/**
 * The Operations Centre's transition legality — the state-machine half of
 * the lifecycle in docs/briefs/PHASE_N_OPERATIONS_CENTRE.md ("Order
 * lifecycle & timing model" → "Legality").
 *
 * `assertTransition` is pure: it knows nothing about who is asking, when
 * `ready_at` was last set, or whether a refund exists — those are role and
 * business-rule checks the server makes with a database in front of it
 * (server/services/orderTransitions.ts, N3b). What it decides is narrower
 * and universal: given an order's CURRENT stage, is the requested action
 * structurally legal at all? That is exactly the part every caller — the
 * transition route, its tests, and a UI deciding which button to grey out —
 * needs to agree on without touching a database.
 *
 * Idempotent stamps (ready, arrived, out_for_delivery, hold, unclaim,
 * unhold, unready) are legal to repeat; the server writes them with
 * `COALESCE(column, now())` and reports `changed: false` on a repeat. That
 * is a "no news" outcome, not an illegal one, so it is not represented as an
 * error here.
 */
import { z } from "zod";

export const TRANSITION_ACTIONS = [
  "claim",
  "unclaim",
  "assign",
  "ready",
  "unready",
  "arrived",
  "out_for_delivery",
  "complete",
  "reopen",
  "hold",
  "unhold",
  "set_due",
] as const;

export type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

/** `POST /api/orders/:id/transition` body — see the brief's "API" section. */
export const transitionOrderSchema = z.object({
  action: z.enum(TRANSITION_ACTIONS),
  /** `assign`: who to assign to. */
  userId: z.string().min(1).max(255).optional(),
  /** `set_due` (and creation): the promise, as minutes from now — never an absolute instant a tablet's clock could get wrong. */
  dueInMinutes: z.number().int().positive().max(60 * 24 * 14).optional(),
  /** `set_due` (and creation): the promise, as a wall-clock "HH:MM" on the order's own date. */
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected a 24-hour HH:MM time")
    .optional(),
  /** `hold`: why. */
  reason: z.string().max(500).optional(),
  /** `complete` (delivery): when the driver says it actually happened, if later reported than the tap. */
  actualAt: z.string().datetime().optional(),
  /** `complete`: "handed_over" (collection) or "delivered" (delivery) — the customer-facing word on the receipt trail, not a new status. */
  label: z.enum(["handed_over", "delivered"]).optional(),
});

export type TransitionOrderInput = z.infer<typeof transitionOrderSchema>;

/**
 * Thrown by `assertTransition`. The route layer catches this and answers
 * `409 { code: 'ORDER_TRANSITION_INVALID', message }` — the one error code
 * every illegal transition shares; `claim`'s "someone already has it" and
 * `reopen`'s "there's a refund" are different codes raised by the route
 * itself, because both need information (the DB row count, the refund
 * table) this pure check does not have.
 */
export class OpsTransitionError extends Error {
  readonly code = "ORDER_TRANSITION_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "OpsTransitionError";
  }
}

/** The order fields a legality check needs — never the whole row. */
export interface TransitionableOrder {
  status: string;
  fulfilmentMethod: FulfilmentMethodLike;
  /** Whether a promise already exists (`eta_given`), for `set_due`'s one-shot rule. */
  etaGiven: unknown;
}

type FulfilmentMethodLike = "collection" | "delivery" | (string & {});

/**
 * Throws `OpsTransitionError` when `action` cannot legally be applied to
 * `order` in its current stage; returns normally when it can (including
 * every idempotent repeat — see the module doc comment).
 */
export function assertTransition(order: TransitionableOrder, action: TransitionAction): void {
  if (order.status === "completed" && action !== "reopen") {
    throw new OpsTransitionError(
      `cannot "${action}" a completed order — only "reopen" is allowed on one`,
    );
  }
  if (action === "reopen" && order.status !== "completed") {
    throw new OpsTransitionError('"reopen" is only valid on a completed order');
  }
  if (action === "arrived" && order.fulfilmentMethod !== "collection") {
    throw new OpsTransitionError('"arrived" applies to collection orders only');
  }
  if (action === "out_for_delivery" && order.fulfilmentMethod !== "delivery") {
    throw new OpsTransitionError('"out_for_delivery" applies to delivery orders only');
  }
  if (action === "set_due" && order.etaGiven != null) {
    throw new OpsTransitionError(
      'a due time is already set — change it through the delay path (PATCH …/operations), not "set_due"',
    );
  }
}
