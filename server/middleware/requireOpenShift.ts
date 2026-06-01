import type { RequestHandler } from "express";
import { db } from "../db";
import { shifts } from "../../shared/schema";
import { and, eq } from "drizzle-orm";

export type OpenShiftContext = {
  id: string;
  orgId: string;
  locationId: string;
  userId: string;
  openingFloat: string;
};

declare module "express-serve-static-core" {
  interface Request {
    shift?: OpenShiftContext;
  }
}

/**
 * Requires an open shift for the current user at the org location.
 * Sets req.shift; responds 409 when none exists.
 */
export const requireOpenShift: RequestHandler = async (req, res, next) => {
  try {
    const ctx = (req as { orgContext?: { orgId: string; locationId: string | null } })
      .orgContext;
    const user = req.user as { id?: string } | undefined;
    if (!ctx?.orgId || !user?.id) {
      return res.status(400).json({ message: "Org context and authenticated user required" });
    }
    const locationId = ctx.locationId;
    if (!locationId) {
      return res.status(400).json({
        message: "Location required for POS. Pass X-Location-Id or set a default location.",
      });
    }

    const [open] = await db
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.orgId, ctx.orgId),
          eq(shifts.locationId, locationId),
          eq(shifts.userId, user.id),
          eq(shifts.status, "open"),
        ),
      )
      .limit(1);

    if (!open) {
      return res.status(409).json({
        message: "No open shift for this location. Open a shift before taking orders.",
        code: "SHIFT_REQUIRED",
      });
    }

    req.shift = {
      id: open.id,
      orgId: open.orgId,
      locationId: open.locationId,
      userId: open.userId,
      openingFloat: String(open.openingFloat ?? "0"),
    };
    return next();
  } catch (error) {
    console.error("[requireOpenShift]", error);
    return res.status(500).json({ message: "Failed to verify shift" });
  }
};
