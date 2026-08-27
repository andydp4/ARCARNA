import type { RequestHandler } from "express";
import { db } from "../db";
import { organizations, cashierShifts } from "../../shared/schema";
import { and, eq } from "drizzle-orm";
import {
  getOpenCashierShift,
  touchCashierShiftActivity,
} from "../services/cashierShiftEngine";
import { validateCashierShiftReplay } from "../services/cashierShiftReplayToken";
import { resolveShiftForToday } from "../services/tradingDayShift";

export type ActiveCashierShiftContext = {
  /**
   * The cashier CODE on the shift, or null when there isn't one.
   *
   * Nullable deliberately. This was `string`, and a non-nullable field with no
   * value to put in it is an invitation to substitute something — here the
   * logged-in user's id, which is a Clerk subject and not a uuid. Every column
   * it reaches (`orders.cashier_id`, `input_cashier_id`,
   * `completed_cashier_id`) is `uuid REFERENCES cashier_profiles`, so the
   * substitution took the till down with a 500 on every sale the moment the
   * new shift model went live and shifts stopped carrying codes.
   *
   * Nothing is lost by leaving it null: attribution runs on `input_user_id`
   * and `completed_user_id` since L1, and commission is computed from those.
   */
  cashierId: string | null;
  cashierShiftId: string;
  queuedAt?: Date;
  replayedToClosedShift?: boolean;
};

declare module "express-serve-static-core" {
  interface Request {
    cashierShift?: ActiveCashierShiftContext;
  }
}

/**
 * When cashier commission tracking is enabled for the org, resolves the
 * active cashier shift for the cashier selected on the request (header
 * X-Cashier-Id, or body/query cashierId) and attaches it as req.cashierShift.
 *
 * `enforce` decides what happens when there is no shift to attach. Taking a
 * sale without one is a policy question the org answers with
 * `requireCashierForSale`, so the sale path enforces. Completing an order is
 * not: a manager clearing an order from the back office has no till and no
 * cashier shift, and refusing that would break order management to record an
 * attribution that simply is not there. The attach-only path therefore records
 * the completing cashier when one exists and steps aside when one does not.
 */
function cashierShiftMiddleware(enforce: boolean): RequestHandler {
  return async (req, res, next) => {
    try {
      const ctx = (req as { orgContext?: { orgId: string | null } }).orgContext;
      if (!ctx?.orgId) return next();

      const [org] = await db
        .select({
          cashierCommissionEnabled: organizations.cashierCommissionEnabled,
          requireCashierForSale: organizations.requireCashierForSale,
        })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId))
        .limit(1);
      if (!org?.cashierCommissionEnabled) return next();

      // Offline-queued orders carry signed cashier/shift context captured at the
      // time of sale. Only accept closed-shift attribution when the replay token
      // and queued timestamp match the original shift; direct API body fields must
      // not bypass the active-shift requirement.
      const offlineCashierShiftId = req.body?.cashierShiftId as
        | string
        | undefined;
      const offlineCashierId = req.body?.cashierId as string | undefined;
      const offlineReplay = req.body?._offlineOrderReplay === true;
      if (offlineReplay && offlineCashierShiftId && offlineCashierId) {
        const userId = (req.user as { id?: string } | undefined)?.id;
        const [shift] = await db
          .select({
            id: cashierShifts.id,
            orgId: cashierShifts.orgId,
            cashierId: cashierShifts.cashierId,
            openedAt: cashierShifts.openedAt,
            closedAt: cashierShifts.closedAt,
            status: cashierShifts.status,
            openedByUserId: cashierShifts.openedByUserId,
          })
          .from(cashierShifts)
          .where(
            and(
              eq(cashierShifts.id, offlineCashierShiftId),
              eq(cashierShifts.orgId, ctx.orgId),
            ),
          )
          .limit(1);
        if (shift && userId) {
          const replay = validateCashierShiftReplay({
            orgId: ctx.orgId,
            userId,
            cashierId: offlineCashierId,
            cashierShiftId: offlineCashierShiftId,
            token: req.body?._cashierShiftReplayToken,
            queuedAt: req.body?._offlineQueuedAt,
            shift,
          });
          if (replay.ok) {
            req.cashierShift = {
              cashierId: offlineCashierId,
              cashierShiftId: offlineCashierShiftId,
              queuedAt: replay.queuedAt,
              replayedToClosedShift: replay.replayedToClosedShift,
            };
            if (shift.status === "open")
              await touchCashierShiftActivity(shift.id);
            return next();
          }
          console.warn(
            "[requireActiveCashierShift] Rejected offline cashier shift replay:",
            replay.reason,
          );
        }
      }

      if (offlineCashierShiftId && offlineCashierId) {
        const [openShift] = await db
          .select({ id: cashierShifts.id, cashierId: cashierShifts.cashierId })
          .from(cashierShifts)
          .where(
            and(
              eq(cashierShifts.id, offlineCashierShiftId),
              eq(cashierShifts.orgId, ctx.orgId),
              eq(cashierShifts.status, "open"),
            ),
          )
          .limit(1);
        if (openShift && openShift.cashierId === offlineCashierId) {
          await touchCashierShiftActivity(openShift.id);
          req.cashierShift = {
            cashierId: offlineCashierId,
            cashierShiftId: offlineCashierShiftId,
          };
          return next();
        }
      }

      const cashierId =
        (req.headers["x-cashier-id"] as string) ||
        (req.body?.cashierId as string) ||
        (req.query?.cashierId as string) ||
        null;

      // A cashier code was named, so honour it — offline replay and any till
      // still sending one keep working exactly as they did.
      if (cashierId) {
        const openShift = await getOpenCashierShift(ctx.orgId, cashierId);
        if (openShift) {
          await touchCashierShiftActivity(openShift.id);
          req.cashierShift = { cashierId, cashierShiftId: openShift.id };
          return next();
        }
      }

      // Otherwise the shift is the logged-in person's trading day, opened on
      // their first sale of it (migration 058). Nothing is refused for the want
      // of a shift any more: the person is known, so their shift can always be
      // resolved, and making them press a button first was the thing removed.
      const shiftUserId = (req.user as { id?: string } | undefined)?.id;
      if (shiftUserId) {
        const shift = await resolveShiftForToday(ctx.orgId, shiftUserId);
        if (shift) {
          await touchCashierShiftActivity(shift.id);
          req.cashierShift = {
            // No fallback to the user id. A shift opened lazily has no cashier
            // code, and that absence is the truth — see the note on the type.
            cashierId: shift.cashierId,
            cashierShiftId: shift.id,
          };
          return next();
        }
      }

      // No user and no code at all. Only the sale path cares, and only when the
      // org insists on attribution.
      if (enforce && org.requireCashierForSale) {
        return res.status(409).json({
          message: "An active cashier shift is required before taking sales.",
          code: "CASHIER_SHIFT_REQUIRED",
        });
      }
      return next();
    } catch (error) {
      console.error("[requireActiveCashierShift]", error);
      return res
        .status(500)
        .json({ message: "Failed to verify cashier shift" });
    }
  };
}

/** Sale path: attaches the cashier shift, and blocks when the org demands one. */
export const requireActiveCashierShift = cashierShiftMiddleware(true);

/** Completion path: attaches the cashier shift when there is one, never blocks. */
export const attachActiveCashierShift = cashierShiftMiddleware(false);
