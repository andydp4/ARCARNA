import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { rolesAtLeast, WOULD_HAVE_FLAGGED_MIN_ROLE } from "@shared/accessPolicy";
import { orgTimeZone } from "../services/tradingDayShift";
import { wouldHaveFlagged, wouldHaveFlaggedRange } from "../services/priceExceptions";

/**
 * "Would have flagged" (PRC-03, CMP-03): admins and the owner only. Managers
 * are excluded so nobody reviews flags raised about their own prices.
 */
export function registerPriceExceptionRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get(
    "/api/price-exceptions/would-have-flagged",
    ...scoped,
    requireRole(...rolesAtLeast(WOULD_HAVE_FLAGGED_MIN_ROLE)),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const range = wouldHaveFlaggedRange(req.query ?? {}, await orgTimeZone(ctx.orgId));
        res.json(await wouldHaveFlagged(ctx.orgId, range));
      } catch (error) {
        console.error("[PriceExceptions] would-have-flagged:", error);
        res.status(500).json({ message: "Failed to load Would have flagged" });
      }
    },
  );
}
