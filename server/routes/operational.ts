import type { Express, RequestHandler } from "express";
import { isAuthenticated, requireOrgContext, requireOrgScope } from "../auth";
import {
  getSmartStock,
  getActivityFeed,
  getNotifications,
  getBusinessHealth,
} from "../services/operationalIntelligence";
import { controlCentreForRole, getControlCentreSnapshot } from "../services/controlCentre";
import { markSignals } from "../services/signals";

const defaultScoped: RequestHandler[] = [isAuthenticated, requireOrgContext, requireOrgScope];

/** Who is asking, for per-person Signals. Role comes from the org context, as every role gate does. */
function viewerOf(req: any): { userId: string; role: string } | null {
  const userId = req.user?.id ?? req.user?.claims?.sub;
  const role = req.orgContext?.role ?? req.user?.role;
  if (!userId || !role) return null;
  return { userId: String(userId), role: String(role) };
}

export function registerOperationalRoutes(app: Express, scoped: RequestHandler[] = defaultScoped) {
  app.get("/api/inventory/smart-stock", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const windowDays = parseInt(req.query.windowDays as string, 10) || 30;
      const data = await getSmartStock(ctx.orgId, windowDays);
      res.json(data);
    } catch (error) {
      console.error("Error fetching smart stock:", error);
      res.status(500).json({ message: "Failed to fetch smart stock intelligence" });
    }
  });

  app.get("/api/activity", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const data = await getActivityFeed(ctx.orgId, {
        entityType: req.query.entityType as string | undefined,
        entityId: req.query.entityId as string | undefined,
        limit,
        offset,
      });
      res.json(data);
    } catch (error) {
      console.error("Error fetching activity:", error);
      res.status(500).json({ message: "Failed to fetch activity feed" });
    }
  });

  app.get("/api/notifications", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const viewer = viewerOf(req);
      if (!viewer) return res.status(401).json({ message: "Unauthorized" });
      const items = await getNotifications(ctx.orgId, viewer);
      res.json({ items });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/business-health", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const data = await getBusinessHealth(ctx.orgId);
      res.json(data);
    } catch (error) {
      console.error("Error fetching business health:", error);
      res.status(500).json({ message: "Failed to fetch business health" });
    }
  });

  // The Control Centre's one data source — see controlCentre.ts for why this
  // is deliberately separate from /api/business-health rather than a change
  // to it: that route's shape is depended on by scheduled report emails and
  // the assistant's alert summaries, and this page's redesign should not risk
  // either.
  app.get("/api/control-centre", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const data = await getControlCentreSnapshot(ctx.orgId);
      res.json(controlCentreForRole(data, (ctx as { role?: string }).role ?? req.user?.role));
    } catch (error) {
      console.error("Error fetching Control Centre snapshot:", error);
      res.status(500).json({ message: "Failed to fetch Control Centre snapshot" });
    }
  });

  // Read and cleared are per person (v1.2 Phase 0B): each of these touches
  // only the caller's own recipient row, and only for a Signal they may see —
  // anything else is a 404, so the route never confirms a Signal exists.
  const markRoute = (dismiss: boolean) => async (req: any, res: any) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const viewer = viewerOf(req);
      if (!viewer) return res.status(401).json({ message: "Unauthorized" });
      const touched = await markSignals(ctx.orgId, viewer, [String(req.params.id)], { dismiss });
      if (touched.length === 0) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (error) {
      console.error("Error updating Signal:", error);
      res.status(500).json({ message: "Failed to update Signal" });
    }
  };
  app.patch("/api/org-notifications/:id/read", ...scoped, markRoute(false));
  app.post("/api/org-notifications/:id/dismiss", ...scoped, markRoute(true));

  app.post("/api/org-notifications/read-all", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const viewer = viewerOf(req);
      if (!viewer) return res.status(401).json({ message: "Unauthorized" });
      const touched = await markSignals(ctx.orgId, viewer, "all");
      res.json({ ok: true, count: touched.length });
    } catch (error) {
      console.error("Error marking Signals read:", error);
      res.status(500).json({ message: "Failed to update Signals" });
    }
  });
}
