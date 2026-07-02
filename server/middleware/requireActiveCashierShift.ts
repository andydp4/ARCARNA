import type { RequestHandler } from "express";
import { db } from "../db";
import { organizations, cashierShifts } from "../../shared/schema";
import { and, eq } from "drizzle-orm";
import { getOpenCashierShift, touchCashierShiftActivity } from "../services/cashierShiftEngine";
import { verifyCashierShiftReplayToken } from "../services/cashierShiftReplayToken";

export type ActiveCashierShiftContext = {
  cashierId: string;
  cashierShiftId: string;
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
 * Blocks the request with 409 when `requireCashierForSale` is on and no
 * active shift exists for the selected cashier.
 */
export const requireActiveCashierShift: RequestHandler = async (req, res, next) => {
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

    // Offline-queued orders carry the original cashier/shift context captured at
    // the time of sale. Only trust that body context with the server-issued replay
    // token so online/API clients cannot spoof arbitrary historical shifts.
    const isOfflineReplay = req.headers["x-offline-replay"] === "1";
    const offlineCashierShiftId = req.body?.cashierShiftId as string | undefined;
    const offlineCashierId = req.body?.cashierId as string | undefined;
    const offlineToken = req.body?.cashierShiftToken as string | undefined;
    if (isOfflineReplay && offlineCashierShiftId && offlineCashierId && offlineToken) {
      const [shift] = await db
        .select({
          id: cashierShifts.id,
          orgId: cashierShifts.orgId,
          cashierId: cashierShifts.cashierId,
          openedAt: cashierShifts.openedAt,
        })
        .from(cashierShifts)
        .where(and(eq(cashierShifts.id, offlineCashierShiftId), eq(cashierShifts.orgId, ctx.orgId)))
        .limit(1);
      if (
        shift &&
        shift.cashierId === offlineCashierId &&
        verifyCashierShiftReplayToken(offlineToken, {
          orgId: shift.orgId,
          cashierId: shift.cashierId,
          shiftId: shift.id,
          openedAt: shift.openedAt.toISOString(),
        })
      ) {
        req.cashierShift = { cashierId: offlineCashierId, cashierShiftId: offlineCashierShiftId };
        return next();
      }
    }

    const cashierId = (req.headers["x-cashier-id"] as string) || null;

    if (!cashierId) {
      if (org.requireCashierForSale) {
        return res.status(409).json({
          message: "An active cashier shift is required before taking sales.",
          code: "CASHIER_SHIFT_REQUIRED",
        });
      }
      return next();
    }

    const openShift = await getOpenCashierShift(ctx.orgId, cashierId);
    if (!openShift) {
      if (org.requireCashierForSale) {
        return res.status(409).json({
          message: "No active shift for this cashier. Start a cashier shift before taking sales.",
          code: "CASHIER_SHIFT_REQUIRED",
        });
      }
      return next();
    }

    await touchCashierShiftActivity(openShift.id);
    req.cashierShift = { cashierId, cashierShiftId: openShift.id };
    return next();
  } catch (error) {
    console.error("[requireActiveCashierShift]", error);
    return res.status(500).json({ message: "Failed to verify cashier shift" });
  }
};
