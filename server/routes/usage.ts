import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { FRICTION_TRUTHS_MIN_ROLE, rolesAtLeast, STAFF_ROLES } from "@shared/accessPolicy";
import { studyWindowProblem, studyWindowSchema, usageBatchSchema } from "@shared/usage";
import { recordAdminAudit } from "../adminAudit";
import {
  frictionTruths,
  getStudyWindow,
  recordUsageBatch,
  saveStudyWindow,
  todayFor,
  UsageError,
} from "../services/usage";

/**
 * Our own usage record and Friction Truths (v1.2 Phase 8B/8C).
 *
 *  - Every member of staff's device sends usage in batches. The role is taken
 *    from the session, never from the body, and no user id is stored (Q18).
 *  - Friction Truths (usage data) is the owner's alone (SUPER_ADMIN, Q18).
 *  - The improvement-study window: staff read it (for the banner); only the
 *    owner changes it, and the change is logged.
 */
export function registerUsageRoutes(app: Express, scoped: RequestHandler[]): void {
  const staff = requireRole(...STAFF_ROLES);
  const owner = requireRole(...rolesAtLeast(FRICTION_TRUTHS_MIN_ROLE));
  const roleOf = (req: any) => String(req.orgContext?.role ?? req.user?.role ?? "");

  app.post("/api/usage/events", ...scoped, staff, async (req: any, res) => {
    const parsed = usageBatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "That usage batch is not in the expected shape." });
    try {
      res.json(await recordUsageBatch({ orgId: req.orgContext.orgId, role: roleOf(req), input: parsed.data }));
    } catch (error) {
      if (error instanceof UsageError) {
        res.setHeader("Retry-After", "900");
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      console.error("[Usage] record:", error);
      res.status(500).json({ message: "Could not record usage" });
    }
  });

  app.get("/api/friction-truths", ...scoped, owner, async (req: any, res) => {
    const weeks = Number.parseInt(String(req.query?.weeks ?? "4"), 10);
    try {
      res.json(await frictionTruths(req.orgContext.orgId, { weeks: Number.isFinite(weeks) ? weeks : 4 }));
    } catch (error) {
      console.error("[Usage] friction truths:", error);
      res.status(500).json({ message: "Failed to load Friction Truths" });
    }
  });

  app.get("/api/usage/study-window", ...scoped, staff, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const w = await getStudyWindow(orgId);
      const today = await todayFor(orgId);
      res.json({ ...w, active: w.enabled && !!w.endsOn && w.endsOn >= today, recorderConnected: false });
    } catch (error) {
      console.error("[Usage] study window:", error);
      res.status(500).json({ message: "Failed to load the study setting" });
    }
  });

  app.put("/api/usage/study-window", ...scoped, owner, async (req: any, res) => {
    const parsed = studyWindowSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Choose up to five screens and an end date." });
    try {
      const orgId = req.orgContext.orgId as string;
      const problem = studyWindowProblem(parsed.data, await todayFor(orgId));
      if (problem) return res.status(400).json({ message: problem });
      const saved = await saveStudyWindow(orgId, parsed.data);
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: roleOf(req) || "SUPER_ADMIN",
        action: "usage.study_window.saved",
        targetType: "usage_study_window",
        targetId: orgId,
        orgId,
        metadata: saved,
      });
      res.json({ ...saved, recorderConnected: false });
    } catch (error) {
      console.error("[Usage] save study window:", error);
      res.status(500).json({ message: "Failed to save" });
    }
  });
}
