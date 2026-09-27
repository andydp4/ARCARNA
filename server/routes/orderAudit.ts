import type { Express, RequestHandler, Response } from "express";
import { requireRole } from "../auth";
import { getOrderAuditList, getOrderAuditDetail, parseOrderAuditQuery, OrderAuditError } from "../services/orderAudit";

const auditRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

/** Customer names, money and who did what: never kept by a browser, a proxy or the service worker. */
function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store, private");
}

export function registerOrderAuditRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/reports/order-audit", ...scoped, auditRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const range = parseOrderAuditQuery(req.query ?? {});
      const list = await getOrderAuditList(ctx.orgId, range, { userId: req.user?.id ?? null, role: ctx.role });
      noStore(res);
      res.json(list);
    } catch (error) {
      if (error instanceof OrderAuditError) return res.status(error.status).json({ message: error.message });
      console.error("Error fetching order audit list:", error);
      res.status(500).json({ message: "Failed to fetch order audit list" });
    }
  });

  app.get("/api/reports/order-audit/:orderId", ...scoped, auditRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      if (!/^[0-9a-f-]{36}$/i.test(req.params.orderId)) return res.status(404).json({ message: "Order not found" });
      const detail = await getOrderAuditDetail(ctx.orgId, req.params.orderId, { userId: req.user?.id ?? null, role: ctx.role });
      if (!detail) return res.status(404).json({ message: "Order not found" });
      noStore(res);
      res.json(detail);
    } catch (error) {
      console.error("Error fetching order audit detail:", error);
      res.status(500).json({ message: "Failed to fetch order audit detail" });
    }
  });
}
