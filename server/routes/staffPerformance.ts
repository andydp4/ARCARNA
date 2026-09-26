import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { EVIDENCE_MIN_ROLE, rolesAtLeast } from "@shared/accessPolicy";
import { orgTimeZone } from "../services/tradingDayShift";
import {
  PerformanceError,
  parsePerformanceQuery,
  staffPerformance,
  staffPerformanceDetail,
} from "../services/staffPerformance";
import { orderTimingPage, parseTimingQuery } from "../services/orderTimingPage";
import { ReportScopeError, validateReportScope } from "../services/reportsEngine";
import { buildWeeklyDigest, lastWeekOf, myPerformance, parseMyRange } from "../services/myPerformance";
import { currentTargets, setTargets, targetHistory, TargetsError, TARGETS_MIN_ROLE } from "../services/staffTargets";
import { recordAdminAudit } from "../adminAudit";
import { currentTradingDay, shiftIsoDate } from "@shared/time/tradingDay";

/**
 * Order Timing (v1.2 Phase 7A) and Staff Performance (7B) Evidence.
 *
 * Manager and above, like the rest of Evidence. Who appears is cut on the
 * server (Q14): admins and the owner see everyone, a manager sees cashiers and
 * themselves, and a manager asking for another manager's drill-down is
 * refused. Cashiers get My performance (7C), never these pages.
 *
 * My performance (7C) is for every role and answers only with the caller's
 * own figures — there is no user id in its path to change. Targets are read
 * by everyone (for their colours) and written by admins only.
 */
export function registerStaffPerformanceRoutes(app: Express, scoped: RequestHandler[]): void {
  const evidence = requireRole(...rolesAtLeast(EVIDENCE_MIN_ROLE));
  const viewerOf = (req: any) => ({
    userId: req.user?.id ? String(req.user.id) : null,
    role: String(req.orgContext?.role ?? req.user?.role ?? ""),
  });
  const fail = (res: any, error: unknown, what: string, action: "load" | "save" = "load") => {
    if (error instanceof PerformanceError || error instanceof ReportScopeError || error instanceof TargetsError) {
      const status = error instanceof ReportScopeError ? error.statusCode : error.status;
      return res.status(status).json({ message: error.message });
    }
    console.error(`[StaffPerformance] ${action} ${what}:`, error);
    return res.status(500).json({ message: `Failed to ${action} ${what}` });
  };
  // Named figures about people: never kept by a browser or a proxy.
  const noStore = (res: any) => res.setHeader("Cache-Control", "no-store, private");

  app.get("/api/evidence/order-timing", ...scoped, evidence, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const query = parseTimingQuery(req.query ?? {}, await orgTimeZone(orgId));
      noStore(res);
      res.json(await orderTimingPage(orgId, query, viewerOf(req)));
    } catch (error) {
      fail(res, error, "Order Timing");
    }
  });

  app.get("/api/evidence/staff-performance", ...scoped, evidence, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const query = parsePerformanceQuery(req.query ?? {}, await orgTimeZone(orgId));
      if (query.locationId) await validateReportScope(orgId, { locationId: query.locationId });
      noStore(res);
      res.json(await staffPerformance(orgId, query, viewerOf(req)));
    } catch (error) {
      fail(res, error, "Staff Performance");
    }
  });

  const staff = requireRole(...rolesAtLeast("CASHIER"));

  app.get("/api/my-performance", ...scoped, staff, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const viewer = viewerOf(req);
      if (!viewer.userId) return res.status(401).json({ message: "Sign in first." });
      const range = parseMyRange(req.query ?? {}, await orgTimeZone(orgId));
      // Never cached on the device: today's figures are provisional, and they are someone's own.
      noStore(res);
      res.json(await myPerformance(orgId, { userId: viewer.userId, role: viewer.role }, range));
    } catch (error) {
      fail(res, error, "My performance");
    }
  });

  app.get("/api/my-performance/digest", ...scoped, staff, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const viewer = viewerOf(req);
      if (!viewer.userId) return res.status(401).json({ message: "Sign in first." });
      const today = currentTradingDay(await orgTimeZone(orgId));
      const from = typeof req.query?.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week) ? req.query.week : null;
      const week = from ? lastWeekOf(shiftIsoDate(from, 7)) : lastWeekOf(today);
      if (week.to >= today) throw new PerformanceError("That week has not finished yet.", 400);
      noStore(res);
      res.json(await buildWeeklyDigest(orgId, { userId: viewer.userId, role: viewer.role }, week));
    } catch (error) {
      fail(res, error, "the weekly digest");
    }
  });

  app.get("/api/staff-targets", ...scoped, staff, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const viewer = viewerOf(req);
      const current = await currentTargets(orgId);
      const isAdmin = rolesAtLeast(TARGETS_MIN_ROLE).includes(viewer.role as never);
      res.json({ ...current, canEdit: isAdmin, history: isAdmin ? await targetHistory(orgId) : [] });
    } catch (error) {
      fail(res, error, "the targets");
    }
  });

  app.put("/api/staff-targets", ...scoped, requireRole(...rolesAtLeast(TARGETS_MIN_ROLE)), async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const viewer = viewerOf(req);
      const { saved, previous } = await setTargets(orgId, req.body ?? {}, { userId: viewer.userId ?? "unknown", role: viewer.role });
      await recordAdminAudit(req, {
        actorUserId: viewer.userId ?? "unknown",
        actorRole: viewer.role,
        action: "staff_targets.set",
        targetType: "organization",
        targetId: orgId,
        orgId,
        metadata: { version: saved.version, from: previous?.targets ?? null, to: saved.targets, note: saved.note },
      });
      res.json(saved);
    } catch (error) {
      fail(res, error, "the targets", "save");
    }
  });

  app.get("/api/evidence/staff-performance/:userId", ...scoped, evidence, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const query = parsePerformanceQuery(req.query ?? {}, await orgTimeZone(orgId));
      if (query.locationId) await validateReportScope(orgId, { locationId: query.locationId });
      noStore(res);
      res.json(await staffPerformanceDetail(orgId, String(req.params.userId), query, viewerOf(req)));
    } catch (error) {
      fail(res, error, "the drill-down");
    }
  });
}
