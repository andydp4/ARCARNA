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
      // What is owed comes from the credit records, not from order status. An
      // order's status says whether the goods have gone; only the credit record
      // knows whether the money has arrived, and a part-paid account owes the
      // remainder rather than the whole invoice.
      const { db: appDb } = await import('../db');
      const { orderCredit } = await import('@shared/schema');
      const { inArray } = await import('drizzle-orm');
      const tickOrders = await appDb
        .select({
          customerId: orderCredit.customerId,
          totalDebt: sql<number>`COALESCE(SUM(CAST(${orderCredit.amountOutstanding} AS DECIMAL)), 0)`,
          lastOrderDate: sql<string>`MAX(${orderCredit.givenOn})`,
          orderCount: sql<number>`COUNT(*)`,
        })
        .from(orderCredit)
        .where(and(
          eq(orderCredit.orgId, ctx.orgId),
          inArray(orderCredit.status, ['outstanding', 'partial']),
        ))
        .groupBy(orderCredit.customerId);
      
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

  // Clearing a customer's whole account, kept because the button exists and
  // people use it. It no longer works by flipping every order to "completed" —
  // that used order status to mean "the money arrived", which is what made
  // every credit sale read as paid the moment the goods left. It now posts a
  // real payment against each outstanding order, which is what releases the
  // commission those sales earned.
  app.post("/api/tick-customers/:id/mark-paid", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) return res.status(403).json({ message: 'Organization scope required' });
      const customer = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!customer) return res.status(404).json({ message: 'Customer not found' });

      const { db } = await import('../db');
      const { orderCredit } = await import('@shared/schema');
      const { and, eq, inArray } = await import('drizzle-orm');
      const { recordCreditPayment } = await import('../services/creditLedger');

      const owing = await db
        .select({ orderId: orderCredit.orderId, outstanding: orderCredit.amountOutstanding })
        .from(orderCredit)
        .where(and(
          eq(orderCredit.orgId, ctx.orgId),
          eq(orderCredit.customerId, req.params.id),
          inArray(orderCredit.status, ['outstanding', 'partial']),
        ));

      let settled = 0;
      for (const row of owing) {
        const amount = parseFloat(String(row.outstanding));
        if (!(amount > 0)) continue;
        await recordCreditPayment({
          orgId: ctx.orgId,
          orderId: row.orderId,
          amount,
          method: String(req.body?.method ?? 'cash'),
          recordedByUserId: req.user?.id ?? null,
          note: 'Account cleared in full',
        });
        settled += amount;
      }

      res.json({
        message: "Customer debt marked as paid",
        ordersSettled: owing.length,
        amountSettled: Math.round(settled * 100) / 100,
      });
    } catch (error) {
      console.error("Error marking customer as paid:", error);
      res.status(500).json({ message: "Failed to mark customer as paid" });
    }
  });

}
