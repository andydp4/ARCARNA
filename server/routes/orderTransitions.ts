/**
 * `POST /api/orders/:id/transition` — the Operations Centre's one lifecycle
 * endpoint (Phase N, N3b; docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "API").
 *
 * Thin by design: validate the body against N0's own `transitionOrderSchema`
 * (`shared/orders/opsTransitions.ts` — reused verbatim, never redefined),
 * resolve the actor, hand everything to `runOrderTransition`
 * (`server/services/orderTransitions.ts`), and translate whatever it throws
 * into the brief's exact status/code pairs. All of the state machine, the
 * locking, and the money live in the service layer.
 */
import type { Express, RequestHandler } from "express";
import { transitionOrderSchema } from "@shared/orders/opsTransitions";
import { attachActiveCashierShift } from "../middleware/requireActiveCashierShift";
import { CreditError } from "../services/creditLedger";
import { OrderReopenRefusedError } from "../services/orderCompletion";
import {
  OpsTransitionError,
  OrderAlreadyAssignedError,
  OrderNotFoundError,
  runOrderTransition,
  TransitionBadRequestError,
  TransitionForbiddenError,
} from "../services/orderTransitions";

export function registerOrderTransitionRoutes(app: Express, scoped: RequestHandler[]): void {
  // `attachActiveCashierShift` is soft (never blocks the request) — it only
  // makes `req.cashierShift` available so `complete` can resolve the same
  // completing-cashier attribution `PATCH /api/orders/:id` already does.
  app.post("/api/orders/:id/transition", ...scoped, attachActiveCashierShift, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null } | undefined;
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Order transitions require org context." });
      }
      const parsed = transitionOrderSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid transition request", errors: parsed.error.errors });
      }
      const actorId = req.user?.id;
      if (!actorId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const actorRole = req.user?.role ?? "CASHIER";
      const cashierShift = (req as { cashierShift?: { cashierId: string | null; cashierShiftId: string } }).cashierShift;

      const result = await runOrderTransition({
        orgId: ctx.orgId,
        orderId: req.params.id,
        actor: { userId: actorId, role: actorRole, cashierShift: cashierShift ?? null },
        input: parsed.data,
      });
      res.json(result);
    } catch (error: any) {
      if (error instanceof OrderNotFoundError) {
        return res.status(404).json({ message: "Order not found" });
      }
      if (error instanceof TransitionForbiddenError) {
        return res.status(403).json({ message: error.message, code: error.code });
      }
      if (error instanceof OrderAlreadyAssignedError) {
        return res.status(409).json({
          message: error.message,
          code: error.code,
          assignedUserId: error.assignedUserId,
          assignedUserName: error.assignedUserName,
        });
      }
      if (error instanceof OrderReopenRefusedError) {
        return res.status(409).json({ message: error.message, code: error.code });
      }
      if (error instanceof OpsTransitionError) {
        return res.status(409).json({ message: error.message, code: error.code });
      }
      if (error instanceof TransitionBadRequestError) {
        return res.status(400).json({ message: error.message, code: error.code });
      }
      if (error instanceof CreditError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      console.error("Error running order transition:", error);
      res.status(500).json({ message: "Failed to run order transition" });
    }
  });
}
