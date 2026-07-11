import type { RequestHandler } from "express";
import { db } from "../db";
import { organizations, cashierShifts } from "../../shared/schema";
import { and, eq } from "drizzle-orm";
import { getOpenCashierShift, touchCashierShiftActivity } from "../services/cashierShiftEngine";
import { resolveSubmittedCashierShift } from "../services/cashierShiftGuards";

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

    const submittedCashierShiftId =
      typeof req.body?.cashierShiftId === "string" ? req.body.cashierShiftId : null;
    if (submittedCashierShiftId) {
      const [shift] = await db
        .select({
          id: cashierShifts.id,
          cashierId: cashierShifts.cashierId,
          status: cashierShifts.status,
          openedAt: cashierShifts.openedAt,
          closedAt: cashierShifts.closedAt,
        })
        .from(cashierShifts)
        .where(and(eq(cashierShifts.id, submittedCashierShiftId ?? ""), eq(cashierShifts.orgId, ctx.orgId)))
        .limit(1);

      const submitted = resolveSubmittedCashierShift(req.body ?? {}, shift ?? null);
      if (submitted.kind === "accepted") {
        if (!submitted.replayedOfflineOrder) {
          await touchCashierShiftActivity(submitted.cashierShiftId);
        }
        req.cashierShift = {
          cashierId: submitted.cashierId,
          cashierShiftId: submitted.cashierShiftId,
        };
        return next();
      }

      if (submitted.kind === "rejected") {
        return res.status(submitted.status).json({
          message: submitted.message,
          code: submitted.code,
        });
      }
    }

    const cashierId =
      (req.headers["x-cashier-id"] as string) ||
      (req.body?.cashierId as string) ||
      (req.query?.cashierId as string) ||
      null;

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
