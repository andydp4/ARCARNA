import type { RequestHandler } from "express";
import { db } from "../db";
import { locations, shifts } from "../../shared/schema";
import { and, desc, eq } from "drizzle-orm";

export type OpenShiftContext = {
  id: string;
  orgId: string;
  locationId: string;
  userId: string;
  openingFloat: string;
};

type RequestWithOpenShift = Parameters<RequestHandler>[0] & {
  shift?: OpenShiftContext;
};

/**
 * Resolves the current user's till shift at the org location, opening one if
 * there is not already one running.
 *
 * There is no "open a shift" step any more (migration 058): the first sale of
 * the day opens the drawer, and it stays open until the 06:00 close. Refusing a
 * sale because nobody pressed a button first was the thing being removed, so
 * this no longer answers 409 for a missing shift — only for a missing location,
 * which it genuinely cannot invent.
 *
 * THE OPENING FLOAT is carried forward from the last closed shift's counted
 * cash at that location, falling back to zero. That mirrors what physically
 * happens — the drawer is not emptied between days, so this morning's float is
 * last night's count — and it keeps the variance meaningful, which a hard-coded
 * zero would not. Where a shop floats its drawer up or down to a fixed amount
 * instead, this is the figure to change.
 */
/**
 * Opens a till shift, floating the drawer at whatever was last counted into it.
 *
 * Racing callers are tolerated: if a concurrent first sale opened one first,
 * that one is returned rather than a second being created, so the day's cash
 * cannot end up split across two drawers.
 */
async function openShiftForUser(orgId: string, locationId: string, userId: string) {
  const [lastClosed] = await db
    .select({ closingCount: shifts.closingCount })
    .from(shifts)
    .where(and(eq(shifts.orgId, orgId), eq(shifts.locationId, locationId), eq(shifts.status, "closed")))
    .orderBy(desc(shifts.closedAt))
    .limit(1);

  const openingFloat = lastClosed?.closingCount != null ? String(lastClosed.closingCount) : "0";

  const [created] = await db
    .insert(shifts)
    .values({ orgId, locationId, userId, openingFloat, status: "open" })
    .returning();
  if (created) return created;

  const [existing] = await db
    .select()
    .from(shifts)
    .where(
      and(
        eq(shifts.orgId, orgId),
        eq(shifts.locationId, locationId),
        eq(shifts.userId, userId),
        eq(shifts.status, "open"),
      ),
    )
    .limit(1);
  return existing ?? null;
}

export const requireOpenShift: RequestHandler = async (req, res, next) => {
  try {
    const request = req as RequestWithOpenShift;
    const ctx = (req as { orgContext?: { orgId: string; locationId: string | null } })
      .orgContext;
    const user = req.user as { id?: string } | undefined;
    if (!ctx?.orgId || !user?.id) {
      return res.status(400).json({ message: "Org context and authenticated user required" });
    }
    let locationId = ctx.locationId;
    if (!locationId) {
      const [openForUser] = await db
        .select({ locationId: shifts.locationId })
        .from(shifts)
        .where(
          and(
            eq(shifts.orgId, ctx.orgId),
            eq(shifts.userId, user.id),
            eq(shifts.status, "open"),
          ),
        )
        .limit(1);
      if (openForUser?.locationId) {
        locationId = openForUser.locationId;
        ctx.locationId = locationId;
      }
    }
    if (!locationId) {
      return res.status(400).json({
        message: "Location required for POS. Pass X-Location-Id or set a default location.",
      });
    }
    const [location] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.orgId, ctx.orgId)))
      .limit(1);
    if (!location) {
      return res.status(404).json({ message: "Location not found for organization" });
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
    const shift = open ?? (await openShiftForUser(ctx.orgId, locationId, user.id));
    if (!shift) {
      return res.status(500).json({ message: "Could not open a till shift" });
    }
    request.shift = {
      id: shift.id,
      orgId: shift.orgId,
      locationId: shift.locationId,
      userId: shift.userId,
      openingFloat: String(shift.openingFloat ?? "0"),
    };
    return next();
  } catch (error) {
    console.error("[requireOpenShift]", error);
    return res.status(500).json({ message: "Failed to verify shift" });
  }
};
