import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { requireRole } from "../auth";
import { PROBLEM_INBOX_MIN_ROLE, rolesAtLeast, STAFF_ROLES } from "@shared/accessPolicy";
import { PROBLEM_STATUSES, problemReportInputSchema, problemResolveSchema, type ProblemStatus } from "@shared/problemReports";
import { recordAdminAudit } from "../adminAudit";
import {
  createProblemReport,
  listProblemReports,
  ProblemReportError,
  resolveProblemReport,
} from "../services/problemReports";

/**
 * The "Problem?" button and its inbox (v1.2 Phase 8A, UXA-09).
 *
 *  - Any member of staff sends a report from the header or the till.
 *  - Admins and the owner read the inbox and mark a report fixed (the
 *    reporter is thanked with the version) or closed. Both are logged.
 */
export function registerProblemReportRoutes(app: Express, scoped: RequestHandler[]): void {
  const staff = requireRole(...STAFF_ROLES);
  const admins = requireRole(...rolesAtLeast(PROBLEM_INBOX_MIN_ROLE));
  const roleOf = (req: any) => String(req.orgContext?.role ?? req.user?.role ?? "");

  app.post("/api/problem-reports", ...scoped, staff, async (req: any, res) => {
    const parsed = problemReportInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Choose what went wrong: Too slow, Can't find it, Did the wrong thing, Error message or Other." });
    }
    try {
      const out = await createProblemReport({
        orgId: req.orgContext.orgId,
        reporterUserId: String(req.user?.id ?? ""),
        reporterRole: roleOf(req),
        input: parsed.data,
      });
      res.status(out.duplicate ? 200 : 201).json(out);
    } catch (error) {
      if (error instanceof ProblemReportError) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("[ProblemReports] create:", error);
      res.status(500).json({ message: "Could not send the report" });
    }
  });

  app.get("/api/problem-reports", ...scoped, admins, async (req: any, res) => {
    const q = typeof req.query?.status === "string" ? req.query.status : "open";
    const status: ProblemStatus | "all" = q === "all" || (PROBLEM_STATUSES as readonly string[]).includes(q) ? q : "open";
    try {
      res.json(await listProblemReports(req.orgContext.orgId, status));
    } catch (error) {
      console.error("[ProblemReports] list:", error);
      res.status(500).json({ message: "Failed to load the Problem? inbox" });
    }
  });

  app.post("/api/problem-reports/:id/resolve", ...scoped, admins, async (req: any, res) => {
    const parsed = problemResolveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Mark it fixed with the version it is fixed in (for example 1.2.0), or closed." });
    }
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(404).json({ message: "That report is not in this shop's inbox." });
    }
    try {
      const orgId = req.orgContext.orgId as string;
      const out = await resolveProblemReport({ orgId, id: req.params.id, actorUserId: String(req.user?.id ?? ""), input: parsed.data });
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: roleOf(req) || "ADMIN",
        action: "problem_report.resolved",
        targetType: "problem_report",
        targetId: req.params.id,
        orgId,
        metadata: { ...parsed.data, thanked: out.thanked },
      });
      res.json(out);
    } catch (error) {
      if (error instanceof ProblemReportError) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("[ProblemReports] resolve:", error);
      res.status(500).json({ message: "Failed to save" });
    }
  });
}
