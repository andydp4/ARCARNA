/**
 * Public REST API — /v1
 *
 * Auth:  Authorization: Bearer <api_key>
 * Scope: checked per-route with requireScope()
 *
 * All routes are org-scoped: the orgId in the path is validated against the
 * API key's owning org, so keys cannot cross org boundaries.
 */
import type { Express } from "express";
import { requireApiKey, requireScope } from "../middleware/apiKeyAuth";
import { storage } from "../storage";
import { z } from "zod";

const auth = [requireApiKey];
const v1OrderCreateSchema = z.object({
  locationId: z.string().uuid(),
}).passthrough();

function orgGuard(req: any, res: any): string | null {
  const { orgId } = req.params as { orgId: string };
  if (req.apiKeyContext?.orgId !== orgId) {
    res.status(403).json({ error: "forbidden", message: "API key does not belong to this org" });
    return null;
  }
  return orgId;
}

export function registerV1Routes(app: Express): void {
  /* ------------------------------------------------------------------ */
  /*  Products                                                            */
  /* ------------------------------------------------------------------ */

  app.get(
    "/v1/orgs/:orgId/products",
    ...auth,
    requireScope("products:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const rows = await storage.getProductsForOrgPublic(orgId);
        res.json(
          rows.map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.productId,
            price: p.defaultSalePrice,
            stock: p.stock,
          })),
        );
      } catch (e) {
        console.error("[v1] products list:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  app.get(
    "/v1/orgs/:orgId/products/:productId",
    ...auth,
    requireScope("products:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const product = await storage.getProduct(req.params.productId, orgId);
        if (!product) return res.status(404).json({ error: "not_found" });
        res.json(product);
      } catch (e) {
        if ((e as any)?.code === '22P02' || (e as any)?.cause?.code === '22P02') return res.status(404).json({ error: "not_found" }); // uuid-guard-product
        console.error("[v1] product get:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Orders                                                              */
  /* ------------------------------------------------------------------ */

  app.get(
    "/v1/orgs/:orgId/orders",
    ...auth,
    requireScope("orders:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const { db } = await import("../db");
        const { orders, order_items, products, customers } = await import(
          "../../apps/server/src/db/schema"
        );
        const { eq, desc } = await import("drizzle-orm");
        const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 200);
        const rows = await db
          .select({
            id: orders.id,
            customerId: orders.customer_id,
            total: orders.total,
            paymentMethod: orders.payment_method,
            status: orders.status,
            createdAt: orders.created_at,
          })
          .from(orders)
          .where(eq(orders.org_id, orgId))
          .orderBy(desc(orders.created_at))
          .limit(limit);
        res.json(rows);
      } catch (e) {
        console.error("[v1] orders list:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  app.get(
    "/v1/orgs/:orgId/orders/:orderId",
    ...auth,
    requireScope("orders:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const { db } = await import("../db");
        const { orders, order_items, products, customers } = await import(
          "../../apps/server/src/db/schema"
        );
        const { eq, and } = await import("drizzle-orm");
        const [order] = await db
          .select()
          .from(orders)
          .where(and(eq(orders.id, req.params.orderId), eq(orders.org_id, orgId)));
        if (!order) return res.status(404).json({ error: "not_found" });

        const items = await db
          .select({
            id: order_items.id,
            productId: order_items.product_id,
            productName: products.name,
            quantity: order_items.quantity,
            unitPrice: order_items.unit_price,
            total: order_items.total_price,
          })
          .from(order_items)
          .leftJoin(products, eq(order_items.product_id, products.id))
          .where(eq(order_items.order_id, req.params.orderId));

        let customer = null;
        if (order.customer_id) {
          const [c] = await db
            .select({ id: customers.id, name: customers.name, email: customers.email })
            .from(customers)
            .where(eq(customers.id, order.customer_id));
          customer = c ?? null;
        }

        res.json({
          id: order.id,
          status: order.status,
          total: order.total,
          paymentMethod: order.payment_method,
          createdAt: order.created_at,
          customer,
          items,
        });
      } catch (e) {
        if ((e as any)?.code === '22P02' || (e as any)?.cause?.code === '22P02') return res.status(404).json({ error: "not_found" }); // uuid-guard-order
        console.error("[v1] order get:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  app.post(
    "/v1/orgs/:orgId/orders",
    ...auth,
    requireScope("orders:write"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const validation = v1OrderCreateSchema.safeParse(req.body);
        if (!validation.success) {
          return res.status(400).json({
            error: "validation_error",
            message: "locationId is required for public API order creation",
            errors: validation.error.errors,
          });
        }
        const { db } = await import("../db");
        const { locations } = await import("@shared/schema");
        const { eq, and } = await import("drizzle-orm");
        const [location] = await db
          .select({ id: locations.id })
          .from(locations)
          .where(and(eq(locations.id, validation.data.locationId), eq(locations.orgId, orgId), eq(locations.isActive, 1)))
          .limit(1);
        if (!location) {
          return res.status(400).json({
            error: "validation_error",
            message: "locationId must belong to an active location in this org",
          });
        }
        const { engine } = await import("../../apps/server/src/engine.wiring");
        const result = await engine.placeOrder({ ...validation.data, orgId });
        res.status(201).json(result);
      } catch (e: any) {
        console.error("[v1] order create:", e);
        res.status(e?.name === "ZodError" ? 400 : 500).json({
          error: e?.name === "ZodError" ? "validation_error" : "internal_error",
          message: e?.message,
        });
      }
    },
  );

  app.patch(
    "/v1/orgs/:orgId/orders/:orderId",
    ...auth,
    requireScope("orders:write"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const { orders, updateOrderStatusSchema } = await import("@shared/schema");
        const validation = updateOrderStatusSchema.safeParse(req.body);
        if (!validation.success) {
          return res.status(400).json({
            error: "validation_error",
            message: "Invalid status value",
            errors: validation.error.errors,
          });
        }
        const { db } = await import("../db");
        const { eq, and } = await import("drizzle-orm");
        const { publishEventTx } = await import("../eventBus");
        const result = await db.transaction(async (tx) => {
          const orderCond = and(eq(orders.id, req.params.orderId), eq(orders.orgId, orgId));
          const [currentOrder] = await tx
            .select({ status: orders.status })
            .from(orders)
            .where(orderCond);
          if (!currentOrder) return null;
          const [updated] = await tx
            .update(orders)
            .set({ status: validation.data.status, updatedAt: new Date() })
            .where(orderCond)
            .returning();
          const eventId = await publishEventTx(tx, "OrderStatusChanged", req.params.orderId, {
            orderId: req.params.orderId,
            from: currentOrder.status,
            to: validation.data.status,
            changedAt: new Date().toISOString(),
          }, { source: "v1-orders" });
          return { updated, eventId };
        });
        if (!result?.updated) return res.status(404).json({ error: "not_found" });
        res.json({ ...result.updated, eventId: result.eventId });
      } catch (e) {
        console.error("[v1] order patch:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Customers                                                           */
  /* ------------------------------------------------------------------ */

  app.get(
    "/v1/orgs/:orgId/customers",
    ...auth,
    requireScope("customers:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 500);
        const list = await storage.getCustomers(orgId);
        res.json(list.slice(0, limit));
      } catch (e) {
        console.error("[v1] customers list:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  app.get(
    "/v1/orgs/:orgId/customers/:customerId",
    ...auth,
    requireScope("customers:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const customer = await storage.getCustomer(req.params.customerId, orgId);
        if (!customer) return res.status(404).json({ error: "not_found" });
        res.json(customer);
      } catch (e) {
        if ((e as any)?.code === '22P02' || (e as any)?.cause?.code === '22P02') return res.status(404).json({ error: "not_found" }); // uuid-guard-customer
        console.error("[v1] customer get:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  app.post(
    "/v1/orgs/:orgId/customers",
    ...auth,
    requireScope("customers:write"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const { engine } = await import("../../apps/server/src/engine.wiring");
        const customer = await engine.createCustomer({ ...req.body, orgId });
        res.status(201).json(customer);
      } catch (e: any) {
        console.error("[v1] customer create:", e);
        res.status(500).json({ error: "internal_error", message: e?.message });
      }
    },
  );

  app.put(
    "/v1/orgs/:orgId/customers/:customerId",
    ...auth,
    requireScope("customers:write"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const { engine } = await import("../../apps/server/src/engine.wiring");
        const customer = await engine.updateCustomer(req.params.customerId, req.body, orgId);
        res.json(customer);
      } catch (e: any) {
        if (e?.message === "Customer not found") return res.status(404).json({ error: "not_found" });
        console.error("[v1] customer update:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Inventory                                                           */
  /* ------------------------------------------------------------------ */

  app.get(
    "/v1/orgs/:orgId/inventory",
    ...auth,
    requireScope("inventory:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const locationId = req.query.locationId as string | undefined;
        const { db } = await import("../db");
        const { productLocationStock } = await import("@shared/schema");
        const { products } = await import("../../apps/server/src/db/schema");
        const { eq, and } = await import("drizzle-orm");

        const conditions: any[] = [eq(productLocationStock.orgId, orgId)];
        if (locationId) conditions.push(eq(productLocationStock.locationId, locationId));

        const rows = await db
          .select({
            productId: productLocationStock.productId,
            locationId: productLocationStock.locationId,
            quantity: productLocationStock.stock,
            productName: products.name,
            sku: products.product_id,
          })
          .from(productLocationStock)
          .leftJoin(products, eq(productLocationStock.productId, products.id))
          .where(and(...conditions))
          .limit(500);

        res.json(rows);
      } catch (e) {
        console.error("[v1] inventory list:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  app.post(
    "/v1/orgs/:orgId/inventory/adjust",
    ...auth,
    requireScope("inventory:write"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const { productId, locationId, delta, reason } = req.body as {
          productId: string;
          locationId: string;
          delta: number;
          reason?: string;
        };
        if (!productId || !locationId || typeof delta !== "number") {
          return res.status(400).json({ error: "validation_error", message: "productId, locationId, delta required" });
        }
        const { adjustProductLocationStock } = await import("../services/productLocationStock");
        await adjustProductLocationStock({
          orgId,
          productId,
          locationId,
          delta,
          movement: { reason: reason ?? "manual_api_adjustment", correlationId: productId, eventId: `v1-adjust-${Date.now()}`, sku: productId },
        });
        res.json({ ok: true });
      } catch (e: any) {
        console.error("[v1] inventory adjust:", e);
        res.status(500).json({ error: "internal_error", message: e?.message });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Shifts                                                              */
  /* ------------------------------------------------------------------ */

  app.get(
    "/v1/orgs/:orgId/shifts",
    ...auth,
    requireScope("shifts:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const { db } = await import("../db");
        const { shifts } = await import("@shared/schema");
        const { eq, desc, and } = await import("drizzle-orm");
        const status = req.query.status as string | undefined;
        const conditions: any[] = [eq(shifts.orgId, orgId)];
        if (status) conditions.push(eq(shifts.status, status as any));

        const rows = await db
          .select()
          .from(shifts)
          .where(and(...conditions))
          .orderBy(desc(shifts.openedAt))
          .limit(100);

        res.json(rows);
      } catch (e) {
        console.error("[v1] shifts list:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Expenses                                                            */
  /* ------------------------------------------------------------------ */

  app.get(
    "/v1/orgs/:orgId/expenses",
    ...auth,
    requireScope("expenses:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const { db } = await import("../db");
        const { overheadExpenses } = await import("@shared/schema");
        const { eq, desc } = await import("drizzle-orm");
        const rows = await db
          .select()
          .from(overheadExpenses)
          .where(eq(overheadExpenses.orgId, orgId))
          .orderBy(desc(overheadExpenses.createdAt))
          .limit(200);
        res.json(rows);
      } catch (e) {
        console.error("[v1] expenses list:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Locations                                                           */
  /* ------------------------------------------------------------------ */

  app.get(
    "/v1/orgs/:orgId/locations",
    ...auth,
    requireScope("locations:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const list = await storage.getLocations(orgId);
        res.json(list);
      } catch (e) {
        console.error("[v1] locations list:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /*  Reports / Sales summary                                             */
  /* ------------------------------------------------------------------ */

  app.get(
    "/v1/orgs/:orgId/reports/sales",
    ...auth,
    requireScope("reports:read"),
    async (req: any, res) => {
      const orgId = orgGuard(req, res);
      if (!orgId) return;
      try {
        const { db } = await import("../db");
        const { orders } = await import("../../apps/server/src/db/schema");
        const { eq, and, gte, lte, sql } = await import("drizzle-orm");

        const from = req.query.from ? new Date(req.query.from as string) : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
        const to = req.query.to ? new Date(req.query.to as string) : new Date();

        const conditions: any[] = [
          eq(orders.org_id, orgId),
          gte(orders.created_at, from),
          lte(orders.created_at, to),
        ];

        const [summary] = await db
          .select({
            orderCount: sql<number>`count(*)::int`,
            totalRevenue: sql<string>`coalesce(sum(${orders.total}::numeric), 0)`,
            avgOrderValue: sql<string>`coalesce(avg(${orders.total}::numeric), 0)`,
          })
          .from(orders)
          .where(and(...conditions));

        const byMethod = await db
          .select({
            paymentMethod: orders.payment_method,
            count: sql<number>`count(*)::int`,
            total: sql<string>`coalesce(sum(${orders.total}::numeric), 0)`,
          })
          .from(orders)
          .where(and(...conditions))
          .groupBy(orders.payment_method);

        res.json({
          from: from.toISOString(),
          to: to.toISOString(),
          orderCount: summary?.orderCount ?? 0,
          totalRevenue: summary?.totalRevenue ?? "0",
          avgOrderValue: summary?.avgOrderValue ?? "0",
          byPaymentMethod: byMethod,
        });
      } catch (e) {
        console.error("[v1] reports/sales:", e);
        res.status(500).json({ error: "internal_error" });
      }
    },
  );
}
