import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import { organizations } from "@shared/schema";
import type { Role } from "@shared/rbac";
import { EXCEPTION_STATES, NEEDS_A_LOOK_MIN_ROLE, reviewRulesSchema } from "@shared/review/exceptions";
import { bulkMinRequestSchema } from "@shared/pricing/bulkMinPrice";
import { canEditMinPrice } from "@shared/accessPolicy";
import { recordAdminAudit } from "../adminAudit";
import { listNeedsALook, reviewException, ReviewError } from "../services/exceptionReviews";
import { priceOverrides } from "../services/priceOverrides";
import { wouldHaveFlaggedRange } from "../services/priceExceptions";
import { orgTimeZone } from "../services/tradingDayShift";
import { orgReviewRules } from "../services/refundExceptions";
import { applyBulkMin, previewBulkMin } from "../services/bulkMinPrice";

/**
 * Review of exceptions and the price guard's admin settings (v1.2 Phase 4):
 *  - Needs a look (CMP-02): the inbox and its review action, manager and
 *    above; each viewer sees only exceptions about people they outrank.
 *  - Price overrides Evidence (PRC-09): manager and above, rows cut the same way.
 *  - The rules (PRC-04, CMP-04): when below-minimum Signals go out and the
 *    refund thresholds. Admin only, every change logged.
 *  - Bulk "Set minimum price" (PRC-05): manager and above, preview then apply.
 */
export function registerNeedsALookRoutes(app: Express, scoped: RequestHandler[]): void {
  const managers = requireRole(...rolesAtLeast(NEEDS_A_LOOK_MIN_ROLE));
  const viewerOf = (req: any) => ({
    userId: String(req.user?.id ?? ""),
    role: String(req.orgContext?.role ?? req.user?.role ?? ""),
  });

  app.get("/api/needs-a-look", ...scoped, managers, async (req: any, res) => {
    try {
      const q = req.query ?? {};
      const state = typeof q.state === "string" && (q.state === "all" || (EXCEPTION_STATES as readonly string[]).includes(q.state)) ? q.state : "open";
      const queue = typeof q.queue === "string" ? (q.queue as Role) : null;
      const kind = q.kind === "price" || q.kind === "refund" ? q.kind : null;
      res.json(await listNeedsALook(req.orgContext.orgId, viewerOf(req), { state, queue, kind }));
    } catch (error) {
      console.error("[NeedsALook] list:", error);
      res.status(500).json({ message: "Failed to load Needs a look" });
    }
  });

  app.post("/api/needs-a-look/:id/review", ...scoped, managers, async (req: any, res) => {
    const parsed = z
      .object({ state: z.enum(EXCEPTION_STATES), note: z.string().max(2000).optional().nullable() })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Choose a state: open, acknowledged, explained or escalated." });
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(404).json({ message: "There is nothing here for you to review." });
    }
    try {
      res.json(
        await reviewException({
          orgId: req.orgContext.orgId,
          id: req.params.id,
          viewer: viewerOf(req),
          state: parsed.data.state,
          note: parsed.data.note ?? null,
        }),
      );
    } catch (error) {
      if (error instanceof ReviewError) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("[NeedsALook] review:", error);
      res.status(500).json({ message: "Failed to save the review" });
    }
  });

  app.get("/api/evidence/price-overrides", ...scoped, managers, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const range = wouldHaveFlaggedRange(req.query ?? {}, await orgTimeZone(orgId));
      res.json(await priceOverrides(orgId, viewerOf(req), range));
    } catch (error) {
      console.error("[PriceOverrides] evidence:", error);
      res.status(500).json({ message: "Failed to load Price overrides" });
    }
  });

  app.get("/api/settings/review-rules", ...scoped, managers, async (req: any, res) => {
    try {
      res.json(await orgReviewRules(req.orgContext.orgId));
    } catch (error) {
      console.error("[ReviewRules] read:", error);
      res.status(500).json({ message: "Failed to load the rules" });
    }
  });

  app.put("/api/settings/review-rules", ...scoped, requireRole(...rolesAtLeast("ADMIN")), async (req: any, res) => {
    const parsed = reviewRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Check the rules: a mode, a cash amount, and whole numbers of days and hours.", errors: parsed.error.errors });
    }
    try {
      const orgId = req.orgContext.orgId as string;
      const { db } = await import("../db");
      const before = await orgReviewRules(orgId);
      const next = parsed.data;
      await db
        .update(organizations)
        .set({
          priceGuardMinSignal: next.priceGuardMinSignal,
          refundCashOver: next.refundCashOver.toFixed(2),
          refundAfterDays: next.refundAfterDays,
          refundSameCashierHours: next.refundSameCashierHours,
        })
        .where(eq(organizations.id, orgId));
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: req.orgContext?.role ?? req.user?.role ?? "ADMIN",
        action: "review_rules.updated",
        targetType: "organization",
        targetId: orgId,
        orgId,
        metadata: { from: before, to: next },
      });
      res.json(next);
    } catch (error) {
      console.error("[ReviewRules] save:", error);
      res.status(500).json({ message: "Failed to save the rules" });
    }
  });

  const minEditors = requireRole(...rolesAtLeast("MANAGER"));
  const readBulk = (req: any, res: any) => {
    const parsed = bulkMinRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Pick products and a rule for the minimum price.", errors: parsed.error.errors });
      return null;
    }
    // The route is manager and above already; the service rule is checked
    // again so a future caller cannot skip it.
    if (!canEditMinPrice(req.orgContext?.role)) {
      res.status(403).json({ message: "Only a manager or an admin can set a minimum price." });
      return null;
    }
    return parsed.data;
  };

  app.post("/api/products/min-price/preview", ...scoped, minEditors, async (req: any, res) => {
    const body = readBulk(req, res);
    if (!body) return;
    try {
      res.json({ rows: await previewBulkMin(req.orgContext.orgId, body.productIds, body.rule) });
    } catch (error) {
      console.error("[BulkMinPrice] preview:", error);
      res.status(500).json({ message: "Failed to preview the minimum prices" });
    }
  });

  app.post("/api/products/min-price/apply", ...scoped, minEditors, async (req: any, res) => {
    const body = readBulk(req, res);
    if (!body) return;
    try {
      const out = await applyBulkMin({
        orgId: req.orgContext.orgId,
        productIds: body.productIds,
        rule: body.rule,
        actorId: String(req.user?.id ?? ""),
        actorRole: String(req.orgContext?.role ?? ""),
      });
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: req.orgContext?.role ?? "MANAGER",
        action: "product.min_price_bulk",
        targetType: "organization",
        targetId: req.orgContext.orgId,
        orgId: req.orgContext.orgId,
        metadata: { rule: body.rule, changed: out.changed, skipped: out.skipped },
      });
      res.json(out);
    } catch (error) {
      console.error("[BulkMinPrice] apply:", error);
      res.status(500).json({ message: "Failed to set the minimum prices" });
    }
  });
}
