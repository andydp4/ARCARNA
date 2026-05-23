import type { Express } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { scheduledReports } from "@shared/schema";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";
import { listReportRuns } from "../services/scheduledReportsRunner";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];

const REPORT_TYPES = z.enum([
  "revenue_summary",
  "order_summary",
  "inventory_health",
  "smart_stock_summary",
  "business_health_snapshot",
]);
const FREQUENCIES = z.enum(["daily", "weekly", "monthly"]);

const createSchema = z.object({
  name: z.string().min(1).max(255),
  reportType: REPORT_TYPES,
  frequency: FREQUENCIES,
  deliveryMethods: z.array(z.string()).optional(),
  isEnabled: z.number().int().min(0).max(1).optional(),
});

export function registerScheduledReportRoutes(app: Express) {
  app.get("/api/scheduled-reports", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const rows = await db
        .select()
        .from(scheduledReports)
        .where(eq(scheduledReports.orgId, ctx.orgId))
        .orderBy(desc(scheduledReports.updatedAt));
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Failed to list scheduled reports" });
    }
  });

  app.post(
    "/api/scheduled-reports",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid body", errors: parsed.error.errors });
        }
        const enabled = parsed.data.isEnabled ?? 0;
        const nextRunAt = enabled ? new Date() : null;
        const [row] = await db
          .insert(scheduledReports)
          .values({
            orgId: ctx.orgId,
            name: parsed.data.name,
            reportType: parsed.data.reportType,
            frequency: parsed.data.frequency,
            deliveryMethods: parsed.data.deliveryMethods ?? ["notification_center"],
            isEnabled: enabled,
            nextRunAt,
          })
          .returning();
        res.status(201).json(row);
      } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to create scheduled report" });
      }
    },
  );

  app.put(
    "/api/scheduled-reports/:id",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const parsed = createSchema.partial().safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid body", errors: parsed.error.errors });
        }
        const [existing] = await db
          .select()
          .from(scheduledReports)
          .where(and(eq(scheduledReports.id, req.params.id), eq(scheduledReports.orgId, ctx.orgId)))
          .limit(1);
        if (!existing) return res.status(404).json({ message: "Not found" });

        const p = parsed.data;
        const nextEnabled = p.isEnabled ?? existing.isEnabled;
        let nextRunAt = existing.nextRunAt;
        if (p.isEnabled === 1 && existing.isEnabled === 0) {
          nextRunAt = new Date();
        }
        if (nextEnabled === 0) {
          nextRunAt = null;
        }

        const [updated] = await db
          .update(scheduledReports)
          .set({
            name: p.name ?? existing.name,
            reportType: p.reportType ?? existing.reportType,
            frequency: p.frequency ?? existing.frequency,
            deliveryMethods: p.deliveryMethods ?? existing.deliveryMethods,
            isEnabled: nextEnabled,
            nextRunAt,
            updatedAt: new Date(),
          })
          .where(and(eq(scheduledReports.id, req.params.id), eq(scheduledReports.orgId, ctx.orgId)))
          .returning();
        res.json(updated);
      } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to update scheduled report" });
      }
    },
  );

  app.delete(
    "/api/scheduled-reports/:id",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const [deleted] = await db
          .delete(scheduledReports)
          .where(and(eq(scheduledReports.id, req.params.id), eq(scheduledReports.orgId, ctx.orgId)))
          .returning({ id: scheduledReports.id });
        if (!deleted) return res.status(404).json({ message: "Not found" });
        res.json({ ok: true });
      } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to delete" });
      }
    },
  );

  app.get("/api/scheduled-reports/:id/runs", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const [existing] = await db
        .select()
        .from(scheduledReports)
        .where(and(eq(scheduledReports.id, req.params.id), eq(scheduledReports.orgId, ctx.orgId)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Not found" });
      const runs = await listReportRuns(req.params.id, ctx.orgId, 50);
      res.json({ items: runs });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Failed to list runs" });
    }
  });
}
