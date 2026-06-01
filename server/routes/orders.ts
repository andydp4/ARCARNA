import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import { requireOpenShift } from "../middleware/requireOpenShift";
import {
  insertLoyaltyTierSchema,
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema,
} from "@shared/schema";

export function registerOrderRoutes(app: Express, scoped: RequestHandler[]): void {
  app.post("/api/orders", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'), requireOpenShift, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null; locationId: string | null; role: string };
      if (!ctx?.orgId) {
        return res.status(400).json({ message: 'Order creation requires org context. Pass X-Org-Id or ?orgId= for SUPER_ADMIN.' });
      }
      const { withTransaction } = await import('../../apps/server/src/db');
      const { orders, order_items } = await import('../../apps/server/src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { publishEventTx } = await import('../eventBus');
      const { engine } = await import('../../apps/server/src/engine.wiring');
      const body = { ...req.body, orgId: ctx.orgId ?? undefined, locationId: ctx.locationId ?? undefined };

      const { result, eventId, createdOrder, items } = await withTransaction(async (tx) => {
        const result = await engine.placeOrder(body);

        const shiftId = req.shift?.id;
        if (shiftId) {
          await tx
            .update(orders)
            .set({ shift_id: shiftId })
            .where(eq(orders.id, result.orderId));
        }

        const [createdOrder] = await tx.select().from(orders).where(eq(orders.id, result.orderId));
        const items = await tx.select().from(order_items).where(eq(order_items.order_id, result.orderId));

        const sendEmailReceipt = body.sendEmailReceipt === true;
        const eventId = await publishEventTx(tx, 'OrderCreated', result.orderId, {
          order: {
            orderId: result.orderId,
            status: createdOrder?.status || 'pending',
            customerId: createdOrder?.customer_id,
            total: parseFloat(createdOrder?.total || '0'),
            paymentMethod: createdOrder?.payment_method,
            sendEmailReceipt,
            items: items.map((item: { id: string; product_id: string; quantity: number; unit_price: string | null; total_price: string | null }) => ({
              lineId: item.id,
              productId: item.product_id,
              qty: item.quantity,
              unitPrice: parseFloat(item.unit_price || '0'),
              lineTotal: parseFloat(item.total_price || '0'),
            })),
          },
          sendEmailReceipt,
        }, { source: 'api-orders' });

        return { result, eventId, createdOrder, items };
      });
      
      console.log(`[Orders] Created order ${result.orderId} with event ${eventId}`);
      
      res.status(201).json({ 
        ...result, 
        eventId, // Include eventId in response for tracing
        order: createdOrder ? {
          id: createdOrder.id,
          status: createdOrder.status,
          total: createdOrder.total,
          paymentMethod: createdOrder.payment_method,
          createdAt: createdOrder.created_at
        } : null
      });
    } catch (error: any) {
      console.error("Error creating order:", error);
      const message = error.message || "Failed to create order";
      const status = error.name === 'ZodError' ? 400 : 500;
      res.status(status).json({ message, errors: error.errors });
    }
  });

  app.get("/api/orders", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { db } = await import('../../apps/server/src/db');
      const { orders } = await import('../../apps/server/src/db/schema');
      const { eq } = await import('drizzle-orm');
      const baseQuery = db.select({
        id: orders.id,
        customerId: orders.customer_id,
        total: orders.total,
        paymentMethod: orders.payment_method,
        status: orders.status,
        createdAt: orders.created_at,
      }).from(orders);
      const allOrders = ctx?.orgId
        ? await baseQuery.where(eq(orders.org_id, ctx.orgId)).orderBy(orders.created_at)
        : await baseQuery.orderBy(orders.created_at);
      res.json(allOrders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { db } = await import('../../apps/server/src/db');
      const { orders, order_items, products, customers } = await import('../../apps/server/src/db/schema');
      const { refunds: refundsTable, refundLines, users } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const mainDb = (await import('../db')).db;
      const orderCond = ctx?.orgId ? and(eq(orders.id, req.params.id), eq(orders.org_id, ctx.orgId)) : eq(orders.id, req.params.id);
      const [order] = await db.select().from(orders).where(orderCond);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }
      
      const items = await db.select({
        id: order_items.id,
        productId: order_items.product_id,
        productName: products.name,
        quantity: order_items.quantity,
        unitPrice: order_items.unit_price,
        totalPrice: order_items.total_price,
      }).from(order_items)
        .leftJoin(products, eq(order_items.product_id, products.id))
        .where(eq(order_items.order_id, req.params.id));
      
      let customer = null;
      if (order.customer_id) {
        const [c] = await db.select().from(customers).where(eq(customers.id, order.customer_id));
        customer = c;
      }
      
      const refundRows = await mainDb
        .select()
        .from(refundsTable)
        .where(eq(refundsTable.orderId, req.params.id));

      const refundsWithMeta = await Promise.all(
        refundRows.map(async (refund) => {
          const lines = await mainDb
            .select()
            .from(refundLines)
            .where(eq(refundLines.refundId, refund.id));
          let cashierName = refund.cashierId;
          const [cashier] = await mainDb
            .select({ firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(eq(users.id, refund.cashierId))
            .limit(1);
          if (cashier) {
            cashierName =
              [cashier.firstName, cashier.lastName].filter(Boolean).join(" ").trim() ||
              refund.cashierId;
          }
          return {
            id: refund.id,
            total: refund.total,
            reason: refund.reason,
            refundMethod: refund.refundMethod,
            notes: refund.notes,
            createdAt: refund.createdAt,
            cashierName,
            lines,
          };
        }),
      );

      const refundedTotal = refundsWithMeta.reduce(
        (sum, r) => sum + parseFloat(String(r.total)),
        0,
      );

      res.json({
        id: order.id,
        customerId: order.customer_id,
        customerName: customer?.name || 'Walk-in',
        total: order.total,
        paymentMethod: order.payment_method,
        status: order.status,
        createdAt: order.created_at,
        refundedTotal,
        refunds: refundsWithMeta,
        items: items.map(item => ({
          id: item.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.totalPrice,
        }))
      });
    } catch (error) {
      console.error("Error fetching order details:", error);
      res.status(500).json({ message: "Failed to fetch order details" });
    }
  });

  app.patch("/api/orders/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { db } = await import('../../apps/server/src/db');
      const { orders } = await import('../../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const { updateOrderStatusSchema } = await import('@shared/schema');
      const { publishEvent } = await import('../eventBus');
      const orderCond = ctx?.orgId ? and(eq(orders.id, req.params.id), eq(orders.org_id, ctx.orgId)) : eq(orders.id, req.params.id);
      
      const validation = updateOrderStatusSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: 'Invalid status value',
          errors: validation.error.errors
        });
      }
      
      const [currentOrder] = await db.select().from(orders).where(orderCond);
      const previousStatus = currentOrder?.status;
      
      const [updated] = await db.update(orders)
        .set({ status: validation.data.status, updated_at: new Date() })
        .where(orderCond)
        .returning();
        
      if (!updated) {
        return res.status(404).json({ message: 'Order not found' });
      }
      
      // Publish OrderStatusChanged event - critical, visible failure
      const eventId = await publishEvent('OrderStatusChanged', req.params.id, {
        orderId: req.params.id,
        from: previousStatus,
        to: validation.data.status,
        changedAt: new Date().toISOString(),
      }, { source: 'api-orders' });
      
      console.log(`[Orders] Status changed ${req.params.id}: ${previousStatus} → ${validation.data.status} (event: ${eventId})`);
      
      res.json({ ...updated, eventId });
    } catch (error) {
      console.error("Error updating order:", error);
      res.status(500).json({ message: "Failed to update order" });
    }
  });

  app.put("/api/orders/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null; locationId?: string | null };
      const { db } = await import('../../apps/server/src/db');
      const { orders, order_items } = await import('../../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const orderCond = ctx?.orgId ? and(eq(orders.id, req.params.id), eq(orders.org_id, ctx.orgId)) : eq(orders.id, req.params.id);
      const [existing] = await db.select().from(orders).where(orderCond);
      if (!existing) return res.status(404).json({ message: 'Order not found' });
      
      const { engine } = await import('../../apps/server/src/engine.wiring');
      const { publishEvent } = await import('../eventBus');
      const result = await engine.updateOrder(req.params.id, {
        ...req.body,
        orgId: ctx.orgId,
        locationId: ctx?.locationId ?? req.body.locationId,
      });
      
      // Fetch updated order details
      const [updatedOrder] = await db.select().from(orders).where(eq(orders.id, req.params.id));
      const items = await db.select().from(order_items).where(eq(order_items.order_id, req.params.id));
      
      // Publish OrderUpdated event - critical, visible failure
      const eventId = await publishEvent('OrderUpdated', req.params.id, {
        order: {
          orderId: req.params.id,
          status: updatedOrder?.status,
          customerId: updatedOrder?.customer_id,
          total: parseFloat(updatedOrder?.total || '0'),
          items: items.map(item => ({
            lineId: item.id,
            productId: item.product_id,
            qty: item.quantity,
            unitPrice: parseFloat(item.unit_price || '0'),
            lineTotal: parseFloat(item.total_price || '0'),
          })),
        }
      }, { source: 'api-orders' });
      
      console.log(`[Orders] Updated order ${req.params.id} (event: ${eventId})`);
      
      res.json({ ...result, eventId });
    } catch (error: any) {
      console.error("Error updating order:", error);
      const message = error.message || "Failed to update order";
      const status = error.name === 'ZodError' ? 400 : 500;
      res.status(status).json({ message, errors: error.errors });
    }
  });

  app.delete("/api/orders/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null; locationId?: string | null };
      const { db } = await import('../../apps/server/src/db');
      const { orders, order_items, products } = await import('../../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const orderCond = ctx?.orgId ? and(eq(orders.id, req.params.id), eq(orders.org_id, ctx.orgId)) : eq(orders.id, req.params.id);
      
      const [order] = await db.select().from(orders).where(orderCond);
      if (!order) throw new Error('Order not found');
      const items = await db.select().from(order_items).where(eq(order_items.order_id, req.params.id));

      await db.transaction(async (tx) => {
        await tx.delete(order_items).where(eq(order_items.order_id, req.params.id));
        const [deleted] = await tx.delete(orders).where(orderCond).returning();
        if (!deleted) throw new Error('Order not found');
      });

      if (order.org_id && items.length > 0) {
        const { adjustProductLocationStock, resolveStockLocationId } = await import(
          "../services/productLocationStock",
        );
        const locationId = await resolveStockLocationId({
          orgId: order.org_id,
          locationId: order.location_id,
          orderId: req.params.id,
        });
        for (const item of items) {
          if (!item.product_id) continue;
          const [p] = await db
            .select({ productId: products.product_id })
            .from(products)
            .where(eq(products.id, item.product_id))
            .limit(1);
          await adjustProductLocationStock({
            orgId: order.org_id,
            productId: item.product_id,
            locationId,
            delta: item.quantity,
            movement: {
              reason: "cancellation",
              correlationId: req.params.id,
              eventId: `delete-order-${req.params.id}`,
              sku: p?.productId || item.product_id,
            },
          });
        }
      }
      
      res.json({ message: "Order deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting order:", error);
      const message = error.message === 'Order not found' ? 'Order not found' : 'Failed to delete order';
      const status = error.message === 'Order not found' ? 404 : 500;
      res.status(status).json({ message });
    }
  });

}
