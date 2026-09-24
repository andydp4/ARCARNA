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

/**
 * Order Timing (v1.2 Phase 7A) and Staff Performance (7B) Evidence.
 *
 * Manager and above, like the rest of Evidence. Who appears is cut on the
 * server (Q14): admins and the owner see everyone, a manager sees cashiers and
 * themselves, and a manager asking for another manager's drill-down is
 * refused. Cashiers get My performance (7C), never these pages.
 */
export function registerStaffPerformanceRoutes(app: Express, scoped: RequestHandler[]): void {
  const evidence = requireRole(...rolesAtLeast(EVIDENCE_MIN_ROLE));
  const viewerOf = (req: any) => ({
    userId: req.user?.id ? String(req.user.id) : null,
    role: String(req.orgContext?.role ?? req.user?.role ?? ""),
  });
  const fail = (res: any, error: unknown, what: string) => {
    if (error instanceof PerformanceError || error instanceof ReportScopeError) {
      const status = error instanceof PerformanceError ? error.status : error.statusCode;
      return res.status(status).json({ message: error.message });
    }
    console.error(`[StaffPerformance] ${what}:`, error);
    return res.status(500).json({ message: `Failed to load ${what}` });
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
