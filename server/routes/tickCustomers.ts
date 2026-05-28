import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import {
  insertLoyaltyTierSchema,
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema,
} from "@shared/schema";

export function registerTickCustomerRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/tick-customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) return res.status(403).json({ message: 'Organization scope required' });
      const { db } = await import('../../apps/server/src/db');
      const { orders } = await import('../../apps/server/src/db/schema');
      const { eq, and, sql } = await import('drizzle-orm');
      
      const allCustomers = await storage.getCustomers(ctx.orgId);
      const fullCond = and(
        eq(orders.payment_method, 'tick'),
        sql`${orders.status} != 'completed'`,
        eq(orders.org_id, ctx.orgId)
      );
      const tickOrders = await db
        .select({
          customerId: orders.customer_id,
          totalDebt: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`,
          lastOrderDate: sql<string>`MAX(${orders.created_at})`,
          orderCount: sql<number>`COUNT(*)`,
        })
        .from(orders)
        .where(fullCond)
        .groupBy(orders.customer_id);
      
      // Merge customer data with tick orders
      const tickCustomers = tickOrders
        .filter(t => t.customerId)
        .map(tickData => {
          const customer = allCustomers.find(c => c.id === tickData.customerId);
          return {
            id: tickData.customerId,
            name: customer?.name || 'Unknown Customer',
            email: customer?.email || '',
            phone: customer?.phone || '',
            totalDebt: Number(tickData.totalDebt) || 0,
            lastOrderDate: tickData.lastOrderDate,
            orders: []
          };
        });
      
      res.json(tickCustomers);
    } catch (error) {
      console.error("Error fetching tick customers:", error);
      res.status(500).json({ message: "Failed to fetch tick customers" });
    }
  });

  app.delete("/api/tick-customers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) return res.status(403).json({ message: 'Organization scope required' });
      const customer = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!customer) return res.status(404).json({ message: 'Customer not found' });
      const { db } = await import('../../apps/server/src/db');
      const { orders } = await import('../../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const whereCond = and(eq(orders.customer_id, req.params.id), eq(orders.payment_method, 'tick'), eq(orders.org_id, ctx.orgId));
      await db.update(orders)
        .set({ status: 'completed', updated_at: new Date() })
        .where(whereCond);
      
      res.json({ message: "Customer removed from tick list" });
    } catch (error) {
      console.error("Error removing tick customer:", error);
      res.status(500).json({ message: "Failed to remove customer from tick list" });
    }
  });

  app.post("/api/tick-customers/:id/mark-paid", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) return res.status(403).json({ message: 'Organization scope required' });
      const customer = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!customer) return res.status(404).json({ message: 'Customer not found' });
      const { db } = await import('../../apps/server/src/db');
      const { orders } = await import('../../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const whereCond = and(eq(orders.customer_id, req.params.id), eq(orders.payment_method, 'tick'), eq(orders.org_id, ctx.orgId));
      await db.update(orders)
        .set({ status: 'completed', updated_at: new Date() })
        .where(whereCond);
      
      res.json({ message: "Customer debt marked as paid" });
    } catch (error) {
      console.error("Error marking customer as paid:", error);
      res.status(500).json({ message: "Failed to mark customer as paid" });
    }
  });

}
