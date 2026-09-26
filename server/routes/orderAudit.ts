import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { getOrderAuditList, getOrderAuditDetail } from "../services/orderAudit";

const auditRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

export function registerOrderAuditRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/reports/order-audit", ...scoped, auditRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: "Invalid date format" });
        return;
      }
      const rows = await getOrderAuditList(ctx.orgId, startDate, endDate);
      res.json(rows);
    } catch (error) {
      console.error("Error fetching order audit list:", error);
      res.status(500).json({ message: "Failed to fetch order audit list" });
    }
  });

  app.get("/api/reports/order-audit/:orderId", ...scoped, auditRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const detail = await getOrderAuditDetail(ctx.orgId, req.params.orderId);
      if (!detail) {
        res.status(404).json({ message: "Order not found" });
        return;
      }
      res.json(detail);
    } catch (error) {
      console.error("Error fetching order audit detail:", error);
      res.status(500).json({ message: "Failed to fetch order audit detail" });
    }
  });
}
