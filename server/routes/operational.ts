import type { Express } from "express";
import { isAuthenticated, requireOrgContext, requireOrgScope } from "../auth";
import {
  getSmartStock,
  getActivityFeed,
  getNotifications,
  getBusinessHealth,
} from "../services/operationalIntelligence";
import { db } from "../db";
import { orgNotifications } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];

export function registerOperationalRoutes(app: Express) {
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
      const items = await getNotifications(ctx.orgId);
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

  app.patch("/api/org-notifications/:id/read", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const [updated] = await db
        .update(orgNotifications)
        .set({ readAt: new Date() })
        .where(and(eq(orgNotifications.id, req.params.id), eq(orgNotifications.orgId, ctx.orgId)))
        .returning({ id: orgNotifications.id });
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json({ ok: true });
    } catch (error) {
      console.error("Error marking notification read:", error);
      res.status(500).json({ message: "Failed to update notification" });
    }
  });
}
