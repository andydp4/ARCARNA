/**
 * API Routes - HTTP Endpoint Layer
 * 
 * This module registers all HTTP endpoints for the Midnight EPOS system.
 * Routes are organized by functional domain (auth, analytics, products, customers, etc.)
 * 
 * IMPORTANT: 
 * - All routes (except auth check) require isAuthenticated middleware
 * - Request validation uses Zod schemas from shared/schema.ts
 * - Storage layer returns camelCase objects - no transformation needed
 * - Error handling wraps all operations with try/catch
 * 
 * ROUTE ORGANIZATION:
 * - Auth: /api/auth/* - User authentication and session management
 * - Analytics: /api/analytics/* - Business intelligence and metrics
 * - Products: /api/products/* - Product management and inventory
 * - Customers: /api/customers/* - Customer records and loyalty
 * - Orders: /api/orders/* - Order processing and history
 * - POS: /api/pos/* - Point of sale checkout
 * - Inventory: /api/inventory/* - Stock adjustments
 * - Locations: /api/locations/* - Multi-location management
 * - Loyalty: /api/loyalty-tiers/* - Loyalty tier configuration
 * - Promotions: /api/promotions/* - Promotional campaigns
 * - Expenses: /api/expenses/* - Overhead and order expenses
 * - Reports: /api/reports/* - Financial and sales reports
 * - Invoices: /api/invoices/* - Invoice generation and export
 * - Settings: /api/settings/* - System configuration
 */
import type { Express } from "express";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "./auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "./authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { registerSetupAndImportRoutes } from "./routes/setupImports";
import { registerOperationalRoutes } from "./routes/operational";
import { registerAutomationRoutes } from "./routes/automation";
import { registerScheduledReportRoutes } from "./routes/scheduledReports";
import { registerInventoryTransferRoutes } from "./routes/inventoryTransfers";
import { registerSupplierRoutes } from "./routes/suppliers";
import { registerReplenishmentRoutes } from "./routes/replenishment";
import { registerPurchaseDraftRoutes } from "./routes/purchaseDrafts";
import { registerGoodsReceiptRoutes } from "./routes/goodsReceipts";
import { recordAdminAudit } from "./adminAudit";
import { 
  insertLoyaltyTierSchema, 
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema
} from "../shared/schema";

export async function registerRoutes(app: Express): Promise<void> {
  // Public probes — registered before auth middleware
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      nodeEnv: process.env.NODE_ENV ?? "development",
      authProvider: process.env.AUTH_PROVIDER ?? "clerk",
    });
  });

  app.get("/api/health/metrics", async (_req, res) => {
    if (!process.env.DATABASE_URL?.trim()) {
      return res.json({
        ok: true,
        db: false,
        outboxPending: null,
        jobQueued: null,
        nodeEnv: process.env.NODE_ENV ?? "development",
      });
    }
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const out = await db.execute(
        sql`SELECT count(*)::int AS c FROM event_outbox WHERE status = 'pending'`,
      );
      const jobs = await db.execute(
        sql`SELECT count(*)::int AS c FROM job_queue WHERE status = 'queued'`,
      );
      const pick = (r: unknown) => {
        const raw = r as { rows?: { c: number }[] };
        const rows = raw?.rows ?? [];
        return rows[0]?.c ?? 0;
      };
      res.json({
        ok: true,
        db: true,
        outboxPending: pick(out),
        jobQueued: pick(jobs),
        nodeEnv: process.env.NODE_ENV ?? "development",
      });
    } catch (e) {
      res.status(503).json({
        ok: false,
        message: e instanceof Error ? e.message : "metrics_unavailable",
      });
    }
  });

  app.get("/api/auth/runtime", (_req, res) => {
    res.json(getAuthRuntimeSnapshot());
  });

  await setupAuth(app);

  // Auth routes
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const user = await storage.getUser(replitUserId);
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      const orgId = req.user.orgId ?? roleAndOrg?.orgId ?? null;
      let orgName: string | null = null;
      const headerOrg = req.headers["x-org-id"] as string | undefined;
      const setupOrgId =
        role === "SUPER_ADMIN" ? headerOrg || orgId || null : orgId;
      let setupComplete = true;
      if (setupOrgId) {
        const org = await storage.getOrganization(setupOrgId);
        orgName = org?.name ?? orgName;
        setupComplete = org?.setupComplete === 1;
      }
      const orgCount = await storage.countOrganizations();
      let accessState: "ok" | "pending" | "no_org" | "no_access" = "ok";
      if (req.user.isPending || req.user.isAllowed === false) {
        accessState = "pending";
      } else if (role !== "SUPER_ADMIN" && !orgId) {
        accessState = "no_org";
      } else if (role === "SUPER_ADMIN" && orgCount === 0) {
        accessState = "no_org";
      }

      let clerkTwoFactorEnabled: boolean | null = null;
      if (role === "SUPER_ADMIN" && getAuthProvider() === "clerk") {
        try {
          const { getAuth, clerkClient } = await import("@clerk/express");
          const { userId } = getAuth(req);
          if (userId) {
            const cu = await clerkClient.users.getUser(userId);
            clerkTwoFactorEnabled = !!cu.twoFactorEnabled;
          }
        } catch {
          clerkTwoFactorEnabled = null;
        }
      }

      res.json({
        ...user,
        role,
        orgId,
        orgName,
        isAllowed: req.user.isAllowed !== false,
        isPending: !!req.user.isPending,
        accessState,
        needsOnboarding: role === "SUPER_ADMIN" && orgCount === 0,
        setupComplete,
        needsSetupWizard: !!setupOrgId && !setupComplete,
        runtime: getAuthRuntimeSnapshot(),
        clerkTwoFactorEnabled,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/auth/bootstrap", isAuthenticated, async (req: any, res) => {
    try {
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      const orgCount = await storage.countOrganizations();
      const orgs = role === "SUPER_ADMIN" ? await storage.listOrganizations() : [];
      res.json({
        role,
        orgId: roleAndOrg?.orgId ?? null,
        orgCount,
        needsOnboarding: role === "SUPER_ADMIN" && orgCount === 0,
        organizations: orgs,
      });
    } catch (error) {
      console.error("Error fetching bootstrap:", error);
      res.status(500).json({ message: "Failed to fetch bootstrap state" });
    }
  });

  // Organization management
  app.get("/api/orgs", isAuthenticated, async (req: any, res) => {
    try {
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      if (role === "SUPER_ADMIN") {
        return res.json(await storage.listOrganizations());
      }
      const orgId = roleAndOrg?.orgId;
      if (!orgId) return res.json([]);
      const org = await storage.getOrganization(orgId);
      res.json(org ? [org] : []);
    } catch (error) {
      console.error("Error listing organizations:", error);
      res.status(500).json({ message: "Failed to list organizations" });
    }
  });

  app.post("/api/orgs", isAuthenticated, requireRole("SUPER_ADMIN"), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      if (!name) return res.status(400).json({ message: "Organization name is required" });
      const org = await storage.createOrganization(name);
      const actorId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(actorId);
      const actorRole =
        req.user.role ?? roleAndOrg?.role ?? (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      await recordAdminAudit(req, {
        actorUserId: actorId,
        actorRole,
        action: "org.create",
        targetType: "organization",
        targetId: org.id,
        orgId: org.id,
        metadata: { name },
      });
      res.status(201).json(org);
    } catch (error: any) {
      console.error("Error creating organization:", error);
      res.status(500).json({ message: error.message || "Failed to create organization" });
    }
  });

  app.patch("/api/orgs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const name = String(req.body?.name ?? "").trim();
      if (!name) return res.status(400).json({ message: "Organization name is required" });
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      if (role === "SUPER_ADMIN") {
        const org = await storage.updateOrganizationName(id, name);
        return res.json(org);
      }
      if (role === "ADMIN" && roleAndOrg?.orgId === id) {
        const org = await storage.updateOrganizationName(id, name);
        return res.json(org);
      }
      return res.status(403).json({ message: "Access denied" });
    } catch (error: any) {
      console.error("Error updating organization:", error);
      res.status(error.message === "Organization not found" ? 404 : 500).json({
        message: error.message || "Failed to update organization",
      });
    }
  });

  const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];

  // Analytics routes
  app.get("/api/analytics/top-customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const limit = parseInt(req.query.limit as string) || 10;
      const topCustomers = await storage.getTopCustomers(limit, ctx.orgId);
      
      const formattedCustomers = topCustomers.map(({ customer, metrics }) => ({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        orderCount: metrics?.orderCount || 0,
        totalSpent: metrics?.totalSpent || "0",
        rfmScore: metrics?.rfmScore || 0,
        clv: metrics?.clv || "0",
        lastOrderDate: metrics?.lastOrderDate || null,
        category: customer.category || "Bronze",
      }));

      res.json(formattedCustomers);
    } catch (error) {
      console.error("Error fetching top customers:", error);
      res.status(500).json({ message: "Failed to fetch top customers" });
    }
  });

  app.get("/api/analytics/daily-revenue", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const days = parseInt(req.query.days as string) || 30;
      const dailyRevenue = await storage.getDailyRevenue(days, ctx.orgId);
      res.json(dailyRevenue);
    } catch (error) {
      console.error("Error fetching daily revenue:", error);
      res.status(500).json({ message: "Failed to fetch daily revenue" });
    }
  });

  app.get("/api/analytics/monthly-summary", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const months = parseInt(req.query.months as string) || 12;
      const monthlySummary = await storage.getMonthlySummary(months, ctx.orgId);
      res.json(monthlySummary);
    } catch (error) {
      console.error("Error fetching monthly summary:", error);
      res.status(500).json({ message: "Failed to fetch monthly summary" });
    }
  });

  // Products routes
  app.get("/api/products", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const list = await storage.getProducts(ctx.orgId);
      res.json(list);
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const product = await storage.getProduct(req.params.id, ctx.orgId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.post("/api/products", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { engine } = await import('../apps/server/src/engine.wiring');
      const product = await engine.createProduct({ ...req.body, orgId: ctx.orgId });
      res.json(product);
    } catch (error: any) {
      console.error("Error creating product:", error);
      
      // Check for duplicate product code error
      if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint') || error.code === '23505') {
        return res.status(400).json({ 
          message: `Product code "${req.body.productCode}" already exists. Please use a different code.` 
        });
      }
      
      // Check for validation errors
      if (error.message?.includes('required') || error.message?.includes('invalid')) {
        return res.status(400).json({ message: error.message });
      }
      
      // Generic error
      res.status(500).json({ message: error.message || "Failed to create product" });
    }
  });

  app.put("/api/products/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await storage.getProduct(req.params.id, ctx.orgId);
      if (!existing) return res.status(404).json({ message: "Product not found" });
      const { engine } = await import('../apps/server/src/engine.wiring');
      const product = await engine.updateProduct(req.params.id, req.body, ctx.orgId);
      res.json(product);
    } catch (error: any) {
      console.error("Error updating product:", error);
      if (error?.message === 'Product not found') return res.status(404).json({ message: "Product not found" });
      if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint') || error.code === '23505') {
        return res.status(400).json({ 
          message: `Product code "${req.body.productCode}" already exists. Please use a different code.` 
        });
      }
      
      // Check for validation errors
      if (error.message?.includes('required') || error.message?.includes('invalid')) {
        return res.status(400).json({ message: error.message });
      }
      
      // Generic error
      res.status(500).json({ message: error.message || "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await storage.getProduct(req.params.id, ctx.orgId);
      if (!existing) return res.status(404).json({ message: "Product not found" });
      const { engine } = await import('../apps/server/src/engine.wiring');
      await engine.deleteProduct(req.params.id, ctx.orgId);
      res.json({ message: "Product deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting product:", error);
      if (error?.message === 'Product not found') return res.status(404).json({ message: "Product not found" });
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  app.post("/api/products/import", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { rows, products: legacyProducts, duplicateMode = "skip", confirmed } = req.body;
      const list = rows ?? legacyProducts;
      if (!Array.isArray(list)) {
        return res.status(400).json({ message: "Invalid data format. Expected array of products" });
      }
      if (!confirmed) {
        return res.status(400).json({
          message: "Preview required. Use POST /api/products/import/preview then commit with confirmed: true",
        });
      }
      const result = await storage.importProducts(list, ctx.orgId, {
        duplicateMode,
        confirmed: true,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error importing products:", error);
      res.status(400).json({ message: error.message || "Failed to import products" });
    }
  });

  registerSetupAndImportRoutes(app);
  registerOperationalRoutes(app);
  registerAutomationRoutes(app);
  registerScheduledReportRoutes(app);
  registerInventoryTransferRoutes(app);
  registerSupplierRoutes(app);
  registerReplenishmentRoutes(app);
  registerPurchaseDraftRoutes(app);
  registerGoodsReceiptRoutes(app);

  // Customers routes
  app.get("/api/customers/intelligence", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Org context required for customer intelligence" });
      }
      const { listCustomerIntelligence } = await import("./services/customerIntelligence");
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 200);
      const items = await listCustomerIntelligence(ctx.orgId, limit);
      res.json({ items });
    } catch (error) {
      console.error("Error listing customer intelligence:", error);
      res.status(500).json({ message: "Failed to list customer intelligence" });
    }
  });

  app.get("/api/customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const list = await storage.getCustomers(ctx.orgId);
      res.json(list);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  app.get("/api/customers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const customer = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.get("/api/customers/:id/intelligence", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Org context required for customer intelligence" });
      }
      const { computeCustomerIntelligence } = await import("./services/customerIntelligence");
      const intel = await computeCustomerIntelligence(ctx.orgId, req.params.id);
      if (!intel) return res.status(404).json({ message: "Customer not found" });
      res.json(intel);
    } catch (error) {
      console.error("Error fetching customer intelligence:", error);
      res.status(500).json({ message: "Failed to fetch customer intelligence" });
    }
  });

  app.post("/api/customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { engine } = await import('../apps/server/src/engine.wiring');
      const customer = await engine.createCustomer({ ...req.body, orgId: ctx.orgId });
      res.json(customer);
    } catch (error) {
      console.error("Error creating customer:", error);
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.put("/api/customers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      const { engine } = await import('../apps/server/src/engine.wiring');
      const customer = await engine.updateCustomer(req.params.id, req.body, ctx.orgId);
      res.json(customer);
    } catch (error: any) {
      console.error("Error updating customer:", error);
      if (error?.message === 'Customer not found') return res.status(404).json({ message: "Customer not found" });
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const existing = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      const { engine } = await import('../apps/server/src/engine.wiring');
      await engine.deleteCustomer(req.params.id, ctx.orgId);
      res.json({ message: "Customer deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting customer:", error);
      if (error?.message === 'Customer not found') return res.status(404).json({ message: "Customer not found" });
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });

  // Orders routes using domain engine with transactional outbox
  app.post("/api/orders", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null; locationId: string | null; role: string };
      if (!ctx?.orgId) {
        return res.status(400).json({ message: 'Order creation requires org context. Pass X-Org-Id or ?orgId= for SUPER_ADMIN.' });
      }
      const { withTransaction } = await import('../apps/server/src/db');
      const { orders, order_items } = await import('../apps/server/src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { publishEventTx } = await import('./eventBus');
      const { engine } = await import('../apps/server/src/engine.wiring');
      const body = { ...req.body, orgId: ctx.orgId ?? undefined, locationId: ctx.locationId ?? undefined };

      const { result, eventId, createdOrder, items } = await withTransaction(async (tx) => {
        const result = await engine.placeOrder(body);

        const [createdOrder] = await tx.select().from(orders).where(eq(orders.id, result.orderId));
        const items = await tx.select().from(order_items).where(eq(order_items.order_id, result.orderId));

        const eventId = await publishEventTx(tx, 'OrderCreated', result.orderId, {
          order: {
            orderId: result.orderId,
            status: createdOrder?.status || 'pending',
            customerId: createdOrder?.customer_id,
            total: parseFloat(createdOrder?.total || '0'),
            items: items.map((item: { id: string; product_id: string; quantity: number; unit_price: string | null; total_price: string | null }) => ({
              lineId: item.id,
              productId: item.product_id,
              qty: item.quantity,
              unitPrice: parseFloat(item.unit_price || '0'),
              lineTotal: parseFloat(item.total_price || '0'),
            })),
          },
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
      const { db } = await import('../apps/server/src/db');
      const { orders } = await import('../apps/server/src/db/schema');
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
      const { db } = await import('../apps/server/src/db');
      const { orders, order_items, products, customers } = await import('../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
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
      
      res.json({
        id: order.id,
        customerId: order.customer_id,
        customerName: customer?.name || 'Walk-in',
        total: order.total,
        paymentMethod: order.payment_method,
        status: order.status,
        createdAt: order.created_at,
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
      const { db } = await import('../apps/server/src/db');
      const { orders } = await import('../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const { updateOrderStatusSchema } = await import('../shared/schema');
      const { publishEvent } = await import('./eventBus');
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
      const { db } = await import('../apps/server/src/db');
      const { orders, order_items } = await import('../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const orderCond = ctx?.orgId ? and(eq(orders.id, req.params.id), eq(orders.org_id, ctx.orgId)) : eq(orders.id, req.params.id);
      const [existing] = await db.select().from(orders).where(orderCond);
      if (!existing) return res.status(404).json({ message: 'Order not found' });
      
      const { engine } = await import('../apps/server/src/engine.wiring');
      const { publishEvent } = await import('./eventBus');
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
      const { db } = await import('../apps/server/src/db');
      const { orders, order_items, products } = await import('../apps/server/src/db/schema');
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
          "./services/productLocationStock",
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

  // Inventory routes
  app.get("/api/inventory", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const list = await storage.getProductsWithStock(ctx.orgId);
      res.json(list);
    } catch (error) {
      console.error("Error fetching inventory:", error);
      res.status(500).json({ message: "Failed to fetch inventory" });
    }
  });

  app.patch("/api/inventory/:productId", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId?: string | null };
      const { productId } = req.params;
      const { adjustment, type, locationId } = req.body;
      const userId = req.user.claims.sub;
      const product = await storage.updateProductStock(
        productId,
        adjustment,
        type,
        userId,
        ctx.orgId,
        locationId ?? ctx.locationId ?? undefined,
      );
      res.json(product);
    } catch (error) {
      console.error("Error updating inventory:", error);
      res.status(500).json({ message: "Failed to update inventory" });
    }
  });

  // Low stock alerts endpoint
  app.get("/api/inventory/alerts", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const products = await storage.getProductsWithStock(ctx.orgId);
      const alerts = products
        .filter(product => {
          if (product.stock == null || product.stockLimit == null) return false;
          const stockPercentage = (product.stock / product.stockLimit) * 100;
          return product.stock <= product.stockLimit && stockPercentage <= 30;
        })
        .map(product => ({
          ...product,
          alertLevel: product.stock === 0 ? 'critical' : 
                      ((product.stock || 0) / (product.stockLimit || 1)) * 100 <= 10 ? 'high' : 
                      'medium',
          stockPercentage: ((product.stock || 0) / (product.stockLimit || 1)) * 100
        }))
        .sort((a, b) => a.stockPercentage - b.stockPercentage);
      
      res.json({
        alerts,
        summary: {
          critical: alerts.filter(a => a.alertLevel === 'critical').length,
          high: alerts.filter(a => a.alertLevel === 'high').length,
          medium: alerts.filter(a => a.alertLevel === 'medium').length,
          total: alerts.length
        }
      });
    } catch (error) {
      console.error("Error fetching inventory alerts:", error);
      res.status(500).json({ message: "Failed to fetch inventory alerts" });
    }
  });

  // Reports routes
  app.get("/api/reports", ...scoped, async (req: any, res) => {
    try {
      const { from, to } = req.query;
      
      // Validate date inputs
      if (!from || !to) {
        return res.status(400).json({ message: "Missing date range parameters" });
      }
      
      const fromDate = new Date(from);
      const toDate = new Date(to);
      
      // Check for valid dates
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }
      
      if (fromDate > toDate) {
        return res.status(400).json({ message: "From date must be before to date" });
      }
      
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const reportData = await storage.getReportData(fromDate, toDate, ctx.orgId);
      res.json(reportData);
    } catch (error) {
      console.error("Error fetching report data:", error);
      res.status(500).json({ message: "Failed to fetch report data" });
    }
  });

  app.get("/api/reports/export", ...scoped, async (req: any, res) => {
    try {
      const { from, to, format, type } = req.query;
      
      // Validate parameters
      if (!from || !to || !format || !type) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      const fromDate = new Date(from);
      const toDate = new Date(to);
      
      // Check for valid dates
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return res.status(400).json({ message: "Invalid date format" });
      }
      
      // Validate format
      if (!['csv', 'pdf'].includes(format)) {
        return res.status(400).json({ message: "Invalid format. Must be csv or pdf" });
      }
      
      // Validate type
      if (!['revenue', 'orders', 'customers', 'inventory', 'full'].includes(type)) {
        return res.status(400).json({ message: "Invalid report type" });
      }
      
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const reportData = await storage.getReportData(fromDate, toDate, ctx.orgId);
      
      if (format === 'csv') {
        // Generate CSV
        const csv = await storage.generateCSVReport(reportData, type);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${type}_report.csv"`);
        res.send(csv);
      } else {
        // Generate PDF
        const pdf = await storage.generatePDFReport(reportData, type);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${type}_report.pdf"`);
        res.send(pdf);
      }
    } catch (error) {
      console.error("Error exporting report:", error);
      res.status(500).json({ message: "Failed to export report" });
    }
  });

  // Locations routes - ADMIN+ only
  app.get("/api/locations", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const locations = await storage.getLocations(ctx.orgId);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.post("/api/locations", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const locationData = { ...req.body, orgId: ctx.orgId };
      const location = await storage.createLocation(locationData);
      res.json(location);
    } catch (error) {
      console.error("Error creating location:", error);
      res.status(500).json({ message: "Failed to create location" });
    }
  });

  app.patch("/api/locations/:id", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      const location = await storage.updateLocation(id, req.body, ctx.orgId);
      res.json(location);
    } catch (error) {
      console.error("Error updating location:", error);
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  app.delete("/api/locations/:id", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      await storage.deleteLocation(id, ctx.orgId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting location:", error);
      res.status(500).json({ message: "Failed to delete location" });
    }
  });

  app.post("/api/locations/:id/set-default", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      const location = await storage.setDefaultLocation(id, ctx.orgId);
      res.json(location);
    } catch (error) {
      console.error("Error setting default location:", error);
      res.status(500).json({ message: "Failed to set default location" });
    }
  });

  app.get("/api/locations/:id/stock", ...scoped, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { db } = await import('./db');
      const { products, locations } = await import('@shared/schema');
      const { eq, and, desc } = await import('drizzle-orm');
      if (ctx?.orgId) {
        const [loc] = await db.select().from(locations).where(and(eq(locations.id, req.params.id), eq(locations.orgId, ctx.orgId)));
        if (!loc) return res.status(404).json({ message: 'Location not found' });
      }
      const prodCond = ctx?.orgId ? eq(products.orgId, ctx.orgId) : undefined;
      const allProducts = prodCond
        ? await db.select({ id: products.id, name: products.name, productCode: products.productId, stock: products.stock, salePrice: products.defaultSalePrice, costPrice: products.costPrice }).from(products).where(prodCond).orderBy(desc(products.stock))
        : await db.select({ id: products.id, name: products.name, productCode: products.productId, stock: products.stock, salePrice: products.defaultSalePrice, costPrice: products.costPrice }).from(products).orderBy(desc(products.stock));
      
      const stockSummary = {
        totalProducts: allProducts.length,
        totalStock: allProducts.reduce((sum, p) => sum + (p.stock || 0), 0),
        lowStock: allProducts.filter(p => (p.stock || 0) <= 20 && (p.stock || 0) > 5).length,
        criticalStock: allProducts.filter(p => (p.stock || 0) <= 5).length,
        outOfStock: allProducts.filter(p => (p.stock || 0) === 0).length,
      };
      
      res.json({
        locationId: req.params.id,
        products: allProducts,
        summary: stockSummary,
      });
    } catch (error) {
      console.error("Error fetching location stock:", error);
      res.status(500).json({ message: "Failed to fetch stock levels" });
    }
  });

  // Loyalty tier routes
  app.get("/api/loyalty-tiers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const tiers = await storage.getLoyaltyTiers(ctx.orgId);
      res.json(tiers);
    } catch (error) {
      console.error("Error fetching loyalty tiers:", error);
      res.status(500).json({ message: "Failed to fetch loyalty tiers" });
    }
  });

  app.post("/api/loyalty-tiers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const validatedData = insertLoyaltyTierSchema.parse({ ...req.body, orgId: ctx.orgId });
      const tier = await storage.createLoyaltyTier(validatedData);
      res.json(tier);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error("Error creating loyalty tier:", error);
        res.status(500).json({ message: "Failed to create loyalty tier" });
      }
    }
  });

  app.patch("/api/loyalty-tiers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      const validatedData = insertLoyaltyTierSchema.partial().parse(req.body);
      const tier = await storage.updateLoyaltyTier(id, validatedData, ctx.orgId);
      res.json(tier);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error("Error updating loyalty tier:", error);
        res.status(500).json({ message: "Failed to update loyalty tier" });
      }
    }
  });

  app.delete("/api/loyalty-tiers/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      await storage.deleteLoyaltyTier(id, ctx.orgId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting loyalty tier:", error);
      res.status(500).json({ message: "Failed to delete loyalty tier" });
    }
  });

  // Promotions routes
  app.get("/api/promotions", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const activeOnly = req.query.active === 'true';
      const promotions = await storage.getPromotions(ctx.orgId, activeOnly);
      res.json(promotions);
    } catch (error) {
      console.error("Error fetching promotions:", error);
      res.status(500).json({ message: "Failed to fetch promotions" });
    }
  });

  app.post("/api/promotions", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const validatedData = insertPromotionSchema.parse({ ...req.body, orgId: ctx.orgId });
      const promo = await storage.createPromotion(validatedData);
      res.json(promo);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error("Error creating promotion:", error);
        res.status(500).json({ message: "Failed to create promotion" });
      }
    }
  });

  app.patch("/api/promotions/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      const validatedData = insertPromotionSchema.partial().parse(req.body);
      const promo = await storage.updatePromotion(id, validatedData, ctx.orgId);
      res.json(promo);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: "Invalid data", errors: error.errors });
      } else {
        console.error("Error updating promotion:", error);
        res.status(500).json({ message: "Failed to update promotion" });
      }
    }
  });

  app.delete("/api/promotions/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { id } = req.params;
      await storage.deletePromotion(id, ctx.orgId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting promotion:", error);
      res.status(500).json({ message: "Failed to delete promotion" });
    }
  });

  app.post("/api/promotions/validate", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { code } = req.body;
      const promo = await storage.validatePromoCode(code, ctx.orgId);
      if (promo) {
        res.json(promo);
      } else {
        res.status(404).json({ message: "Invalid or expired promo code" });
      }
    } catch (error) {
      console.error("Error validating promo code:", error);
      res.status(500).json({ message: "Failed to validate promo code" });
    }
  });

  // Expense routes
  app.get("/api/overhead-expenses", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const expenses = await storage.getOverheadExpenses(ctx.orgId);
      res.json(expenses);
    } catch (error) {
      console.error("Error fetching overhead expenses:", error);
      res.status(500).json({ message: "Failed to fetch overhead expenses" });
    }
  });

  app.post("/api/overhead-expenses", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const parsedBody = insertOverheadExpenseSchema.parse({ ...req.body, orgId: ctx.orgId });
      const expense = await storage.createOverheadExpense(parsedBody);
      res.json(expense);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: 'Validation error', details: error.errors });
      } else {
        console.error("Error creating overhead expense:", error);
        res.status(500).json({ message: "Failed to create overhead expense" });
      }
    }
  });

  app.put("/api/overhead-expenses/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const parsedBody = insertOverheadExpenseSchema.partial().parse(req.body);
      const expense = await storage.updateOverheadExpense(req.params.id, parsedBody, ctx.orgId);
      res.json(expense);
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ message: 'Validation error', details: error.errors });
      } else {
        console.error("Error updating overhead expense:", error);
        res.status(500).json({ message: "Failed to update overhead expense" });
      }
    }
  });

  app.delete("/api/overhead-expenses/:id", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      await storage.deleteOverheadExpense(req.params.id, ctx.orgId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting overhead expense:", error);
      res.status(500).json({ message: "Failed to delete overhead expense" });
    }
  });

  app.get("/api/orders/:orderId/expenses", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const expenses = await storage.getOrderExpenses(req.params.orderId, ctx.orgId);
      res.json(expenses);
    } catch (error) {
      console.error("Error fetching order expenses:", error);
      res.status(500).json({ message: "Failed to fetch order expenses" });
    }
  });

  app.get("/api/expense-analytics", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
      }
      
      const analytics = await storage.getExpenseAnalytics(startDate, endDate, ctx.orgId);
      res.json(analytics);
    } catch (error) {
      console.error("Error fetching expense analytics:", error);
      res.status(500).json({ message: "Failed to fetch expense analytics" });
    }
  });

  app.get("/api/expense-report", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
      }
      
      const report = await storage.getExpenseReport(startDate, endDate, ctx.orgId);
      res.json(report);
    } catch (error) {
      console.error("Error fetching expense report:", error);
      res.status(500).json({ message: "Failed to fetch expense report" });
    }
  });

  app.get("/api/profit-analysis", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
      }
      
      const analysis = await storage.getProfitAnalysis(startDate, endDate, ctx.orgId);
      res.json(analysis);
    } catch (error) {
      console.error("Error fetching profit analysis:", error);
      res.status(500).json({ message: "Failed to fetch profit analysis" });
    }
  });

  // Invoices endpoints - for Invoice Management page
  app.get("/api/invoices", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const invoices = await storage.getInvoicesWithDetails(ctx.orgId);
      res.json(invoices);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id/pdf", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const invoiceId = req.params.id;
      const { invoices, orders } = await import('../shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const { db } = await import('./db');
      let invoiceResult = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (ctx?.orgId && invoiceResult[0]) {
        const [order] = await db.select().from(orders).where(eq(orders.id, invoiceResult[0].orderId!)).limit(1);
        if (!order || order.orgId !== ctx.orgId) {
          invoiceResult = [];
        }
      }
      
      if (invoiceResult.length === 0) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }
      
      const invoice = invoiceResult[0];
      
      // If invoice has a Google Drive link, redirect to it
      if (invoice.googleDriveLink) {
        res.json({ 
          pdfUrl: invoice.googleDriveLink,
          invoiceNumber: invoice.invoiceNumber,
          googleDriveFileId: invoice.googleDriveFileId,
        });
        return;
      }
      
      // If no PDF exists yet, return info to regenerate
      res.status(202).json({ 
        message: "PDF not yet generated. It will be created when the order is processed.",
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      });
    } catch (error) {
      console.error("Error fetching invoice PDF:", error);
      res.status(500).json({ message: "Failed to fetch invoice PDF" });
    }
  });
  
  // Endpoint to regenerate invoice PDF
  app.post("/api/invoices/:id/regenerate-pdf", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const invoiceId = req.params.id;
      const { invoices, orders, orderItems, customers } = await import('../shared/schema');
      const { eq } = await import('drizzle-orm');
      const { db } = await import('./db');
      const { generateInvoicePdf } = await import('./services/pdfGenerator');
      const { uploadPdfToDrive, createFolderIfNotExists } = await import('./services/googleDrive');
      let invoiceResult = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      if (ctx?.orgId && invoiceResult[0]) {
        const [order] = await db.select().from(orders).where(eq(orders.id, invoiceResult[0].orderId!)).limit(1);
        if (!order || order.orgId !== ctx.orgId) invoiceResult = [];
      }
      
      if (invoiceResult.length === 0) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }
      
      const invoice = invoiceResult[0];
      
      // Get order and customer details
      let orderData = null;
      let customerData = null;
      let itemsData: any[] = [];
      
      if (invoice.orderId) {
        const orderResult = await db.select().from(orders).where(eq(orders.id, invoice.orderId)).limit(1);
        if (orderResult.length > 0) {
          orderData = orderResult[0];
          
          // Get order items
          itemsData = await db.select().from(orderItems).where(eq(orderItems.orderId, invoice.orderId));
        }
      }
      
      if (invoice.customerId) {
        const customerResult = await db.select().from(customers).where(eq(customers.id, invoice.customerId)).limit(1);
        if (customerResult.length > 0) {
          customerData = customerResult[0];
        }
      }
      
      // Generate PDF with full customer details
      const pdfBuffer = await generateInvoicePdf({
        invoiceNumber: invoice.invoiceNumber,
        createdAt: invoice.createdAt?.toISOString() || new Date().toISOString(),
        dueDate: invoice.dueDate || '',
        customerName: customerData?.name || undefined,
        customerEmail: customerData?.email || undefined,
        customerPhone: customerData?.phone || undefined,
        customerAddress: customerData?.address || undefined,
        items: itemsData.length > 0 ? itemsData.map((item: any) => ({
          name: item.productName || 'Services rendered',
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice || '0'),
          total: parseFloat(item.lineTotal || '0'),
        })) : [{
          name: 'Services rendered',
          quantity: 1,
          unitPrice: parseFloat(invoice.total || '0'),
          total: parseFloat(invoice.total || '0'),
        }],
        subtotal: parseFloat(invoice.subtotal || '0'),
        tax: parseFloat(invoice.tax || '0'),
        total: parseFloat(invoice.total || '0'),
        status: invoice.status || 'sent',
        paymentMethod: orderData?.paymentMethod || undefined,
      });
      
      // Upload to Google Drive
      const folderId = await createFolderIfNotExists('Midnight EPOS Invoices');
      const uploadResult = await uploadPdfToDrive(pdfBuffer, `${invoice.invoiceNumber}.pdf`, folderId);
      
      // Update invoice with Google Drive info
      await db
        .update(invoices)
        .set({
          googleDriveFileId: uploadResult.fileId,
          googleDriveLink: uploadResult.webViewLink,
        })
        .where(eq(invoices.id, invoiceId));
      
      res.json({
        message: "PDF regenerated successfully",
        invoiceNumber: invoice.invoiceNumber,
        pdfUrl: uploadResult.webViewLink,
        googleDriveFileId: uploadResult.fileId,
      });
    } catch (error) {
      console.error("Error regenerating invoice PDF:", error);
      res.status(500).json({ message: "Failed to regenerate invoice PDF" });
    }
  });

  // Batch regenerate all invoices missing PDFs
  app.post("/api/invoices/regenerate-all-missing", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      const { invoices, orders, orderItems, customers } = await import('../shared/schema');
      const { eq, and, isNull } = await import('drizzle-orm');
      const { db } = await import('./db');
      const { generateInvoicePdf } = await import('./services/pdfGenerator');
      const { uploadPdfToDrive, createFolderIfNotExists } = await import('./services/googleDrive');
      let missingPdfInvoices = await db.select().from(invoices).where(isNull(invoices.googleDriveFileId));
      if (ctx?.orgId) {
        const orgOrderIds = (await db.select({ id: orders.id }).from(orders).where(eq(orders.orgId, ctx.orgId))).map(r => r.id);
        missingPdfInvoices = missingPdfInvoices.filter(inv => inv.orderId && orgOrderIds.includes(inv.orderId));
      }
      
      if (missingPdfInvoices.length === 0) {
        res.json({ 
          message: "All invoices already have PDFs",
          processed: 0,
          total: 0
        });
        return;
      }
      
      const folderId = await createFolderIfNotExists('Midnight EPOS Invoices');
      
      const results: Array<{ invoiceNumber: string; status: string; error?: string }> = [];
      
      for (const invoice of missingPdfInvoices) {
        try {
          // Get order and customer details
          let orderData = null;
          let customerData = null;
          let itemsData: any[] = [];
          
          if (invoice.orderId) {
            const orderResult = await db.select().from(orders).where(eq(orders.id, invoice.orderId)).limit(1);
            if (orderResult.length > 0) {
              orderData = orderResult[0];
              itemsData = await db.select().from(orderItems).where(eq(orderItems.orderId, invoice.orderId));
            }
          }
          
          if (invoice.customerId) {
            const customerResult = await db.select().from(customers).where(eq(customers.id, invoice.customerId)).limit(1);
            if (customerResult.length > 0) {
              customerData = customerResult[0];
            }
          }
          
          // Generate PDF with full customer details
          const pdfBuffer = await generateInvoicePdf({
            invoiceNumber: invoice.invoiceNumber,
            createdAt: invoice.createdAt?.toISOString() || new Date().toISOString(),
            dueDate: invoice.dueDate || '',
            customerName: customerData?.name || undefined,
            customerEmail: customerData?.email || undefined,
            customerPhone: customerData?.phone || undefined,
            customerAddress: customerData?.address || undefined,
            items: itemsData.length > 0 ? itemsData.map((item: any) => ({
              name: item.productName || 'Services rendered',
              quantity: item.quantity,
              unitPrice: parseFloat(item.unitPrice || '0'),
              total: parseFloat(item.totalPrice || '0'),
            })) : [{
              name: 'Services rendered',
              quantity: 1,
              unitPrice: parseFloat(invoice.total || '0'),
              total: parseFloat(invoice.total || '0'),
            }],
            subtotal: parseFloat(invoice.subtotal || '0'),
            tax: parseFloat(invoice.tax || '0'),
            total: parseFloat(invoice.total || '0'),
            status: invoice.status || 'sent',
            paymentMethod: orderData?.paymentMethod || undefined,
          });
          
          // Upload to Google Drive
          const uploadResult = await uploadPdfToDrive(pdfBuffer, `${invoice.invoiceNumber}.pdf`, folderId);
          
          // Update invoice with Google Drive info
          await db
            .update(invoices)
            .set({
              googleDriveFileId: uploadResult.fileId,
              googleDriveLink: uploadResult.webViewLink,
            })
            .where(eq(invoices.id, invoice.id));
          
          results.push({ invoiceNumber: invoice.invoiceNumber, status: 'success' });
        } catch (invoiceError: any) {
          results.push({ 
            invoiceNumber: invoice.invoiceNumber, 
            status: 'failed', 
            error: invoiceError.message 
          });
        }
      }
      
      const successful = results.filter(r => r.status === 'success').length;
      const failed = results.filter(r => r.status === 'failed').length;
      
      res.json({
        message: `Processed ${successful} invoices successfully, ${failed} failed`,
        processed: successful,
        failed,
        total: missingPdfInvoices.length,
        results,
      });
    } catch (error) {
      console.error("Error regenerating missing invoice PDFs:", error);
      res.status(500).json({ message: "Failed to regenerate missing invoice PDFs" });
    }
  });

  // Tick Customers endpoints - for Credit/Tick List page
  app.get("/api/tick-customers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) return res.status(403).json({ message: 'Organization scope required' });
      const { db } = await import('../apps/server/src/db');
      const { orders } = await import('../apps/server/src/db/schema');
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
      const { db } = await import('../apps/server/src/db');
      const { orders } = await import('../apps/server/src/db/schema');
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
      const { db } = await import('../apps/server/src/db');
      const { orders } = await import('../apps/server/src/db/schema');
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

  // Settings endpoints - per-org profile from organizations table
  app.get("/api/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrgProfile(ctx.orgId);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      const taxRate = org.defaultTaxRate != null ? parseFloat(String(org.defaultTaxRate)) : 20;
      res.json({
        businessName: org.tradingName || org.name,
        businessAddress: org.address || "",
        businessPhone: org.phone || "",
        businessEmail: org.email || "",
        businessWebsite: "",
        vatEnabled: true,
        vatRate: Number.isFinite(taxRate) ? taxRate : 20,
        vatNumber: org.vatNumber || "",
        cardPaymentEnabled: true,
        cashPaymentEnabled: true,
        tickPaymentEnabled: true,
        transferPaymentEnabled: true,
        lowStockThreshold: 20,
        criticalStockThreshold: 5,
        multiLocationEnabled: false,
        currency: org.currency || "GBP",
        timezone: org.timezone || "Europe/London",
        receiptFooter: org.receiptFooter || "",
      });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const body = req.body ?? {};
      const org = await storage.updateOrgProfile(ctx.orgId, {
        tradingName: body.businessName,
        address: body.businessAddress,
        phone: body.businessPhone,
        email: body.businessEmail,
        vatNumber: body.vatNumber,
        defaultTaxRate: body.vatRate,
        receiptFooter: body.receiptFooter,
        currency: body.currency,
        timezone: body.timezone,
      });
      res.json({ message: "Settings updated successfully", orgId: org.id });
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // ===== ADMIN ROUTES - User Access Management =====

  app.get(
    "/api/admin/audit-logs",
    isAuthenticated,
    requireRole("SUPER_ADMIN"),
    requireSuperAdminMfa,
    async (req: any, res) => {
      try {
        const limit = Math.min(parseInt(String(req.query.limit || "100"), 10) || 100, 500);
        const offset = parseInt(String(req.query.offset || "0"), 10) || 0;
        const rows = await storage.listAdminAuditLogs({ limit, offset });
        res.json(rows);
      } catch (error) {
        console.error("Error fetching audit logs:", error);
        res.status(500).json({ message: "Failed to fetch audit logs" });
      }
    },
  );

  // Get allowed users list (owner only)
  app.get("/api/admin/allowed-users", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const replitUserId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(replitUserId);
      const role =
        req.user.role ??
        roleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      const headerOrg = req.headers["x-org-id"] as string | undefined;
      const queryOrg = req.query?.orgId as string | undefined;
      const users =
        role === "SUPER_ADMIN" && !headerOrg && !queryOrg
          ? await storage.adminGetAllAllowedUsers()
          : await storage.getAllowedUsers(
              headerOrg || queryOrg || roleAndOrg?.orgId || "",
            );
      res.json(users);
    } catch (error) {
      console.error("Error fetching allowed users:", error);
      res.status(500).json({ message: "Failed to fetch allowed users" });
    }
  });

  // Remove allowed user (owner only)
  app.delete("/api/admin/allowed-users/:replitUserId", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      
      // Prevent owner from removing themselves
      const owner = await storage.getOwner();
      if (owner && owner.replitUserId === replitUserId) {
        return res.status(400).json({ message: "Cannot remove owner from allowed users" });
      }
      
      await storage.removeAllowedUser(replitUserId);
      const actorId = req.user.claims?.sub ?? req.user.id;
      const rob = await storage.getUserRoleAndOrg(actorId);
      const actorRole =
        req.user.role ?? rob?.role ?? (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");
      await recordAdminAudit(req, {
        actorUserId: actorId,
        actorRole,
        action: "access.remove_allowed_user",
        targetType: "allowed_user",
        targetId: replitUserId,
        orgId: rob?.orgId ?? null,
      });
      res.json({ message: "User removed from allowed list" });
    } catch (error) {
      console.error("Error removing allowed user:", error);
      res.status(500).json({ message: "Failed to remove user" });
    }
  });

  // Get pending approval requests (owner only)
  app.get("/api/admin/pending-approvals", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: any, res) => {
    try {
      const requests = await storage.getPendingApprovals();
      res.json(requests);
    } catch (error) {
      console.error("Error fetching pending approvals:", error);
      res.status(500).json({ message: "Failed to fetch pending approvals" });
    }
  });

  app.patch("/api/admin/allowed-users/:replitUserId", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      const actorId = req.user.claims?.sub ?? req.user.id;
      const roleAndOrg = await storage.getUserRoleAndOrg(actorId);
      const actorRole =
        (req.user.role ??
          roleAndOrg?.role ??
          (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER")) as Role;
      const { role, orgId } = req.body ?? {};
      if (role && !isRole(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      if (role && !canAssignRole(actorRole, role)) {
        return res.status(403).json({ message: "You cannot assign this role" });
      }
      const headerOrg = req.headers["x-org-id"] as string | undefined;
      const queryOrg = req.query?.orgId as string | undefined;
      const allInScope =
        actorRole === "SUPER_ADMIN" && !headerOrg && !queryOrg
          ? await storage.adminGetAllAllowedUsers()
          : await storage.getAllowedUsers(
              headerOrg || queryOrg || roleAndOrg?.orgId || "",
            );
      const targetUser = allInScope.find((u) => u.replitUserId === replitUserId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      if (!canManageUser(actorRole, roleAndOrg?.orgId ?? null, targetUser.orgId ?? null)) {
        return res.status(403).json({ message: "Access denied" });
      }
      const updated = await storage.updateAllowedUserAccess(
        replitUserId,
        { role, orgId },
        { role: actorRole, orgId: roleAndOrg?.orgId ?? null, replitUserId: actorId },
      );
      await recordAdminAudit(req, {
        actorUserId: actorId,
        actorRole,
        action: "access.update_allowed_user",
        targetType: "allowed_user",
        targetId: replitUserId,
        orgId: roleAndOrg?.orgId ?? null,
        metadata: { role, orgId },
      });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating allowed user:", error);
      res.status(400).json({ message: error.message || "Failed to update user" });
    }
  });

  // Approve user (owner only)
  app.post("/api/admin/approve/:replitUserId", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      const approvedBy = req.user.claims?.sub ?? req.user.id;
      const { role, orgId } = req.body ?? {};
      if (role && !isRole(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const actorRoleAndOrg = await storage.getUserRoleAndOrg(approvedBy);
      const actorRole = (req.user.role ??
        actorRoleAndOrg?.role ??
        (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER")) as Role;
      if (role && !canAssignRole(actorRole, role)) {
        return res.status(403).json({ message: "You cannot assign this role" });
      }
      const effectiveOrgId =
        orgId !== undefined ? orgId : actorRole === "SUPER_ADMIN" ? orgId : actorRoleAndOrg?.orgId ?? null;
      if (actorRole === "ADMIN" && effectiveOrgId !== actorRoleAndOrg?.orgId) {
        return res.status(403).json({ message: "Cannot assign users outside your organization" });
      }
      await storage.approveUser(replitUserId, approvedBy, { role: role ?? "CASHIER", orgId: effectiveOrgId });
      await recordAdminAudit(req, {
        actorUserId: approvedBy,
        actorRole,
        action: "access.approve",
        targetType: "allowed_user",
        targetId: replitUserId,
        orgId: effectiveOrgId ?? null,
        metadata: { role: role ?? "CASHIER" },
      });
      res.json({ message: "User approved successfully" });
    } catch (error: any) {
      console.error("Error approving user:", error);
      res.status(400).json({ message: error.message || "Failed to approve user" });
    }
  });

  // Reject user (owner only)
  app.post("/api/admin/reject/:replitUserId", isAuthenticated, requireRole('SUPER_ADMIN', 'ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      const rejectedBy = req.user.claims?.sub || req.user.id || "owner";
      const rob = await storage.getUserRoleAndOrg(rejectedBy);
      const actorRole =
        req.user.role ?? rob?.role ?? (req.user.isOwner ? "SUPER_ADMIN" : "CASHIER");

      await storage.rejectUser(replitUserId, rejectedBy);
      await recordAdminAudit(req, {
        actorUserId: rejectedBy,
        actorRole,
        action: "access.reject",
        targetType: "allowed_user",
        targetId: replitUserId,
        orgId: rob?.orgId ?? null,
      });
      res.json({ message: "User rejected" });
    } catch (error) {
      console.error("Error rejecting user:", error);
      res.status(500).json({ message: "Failed to reject user" });
    }
  });

  // Pending approval page — identity only (no allow-list gate; Clerk has no passport session)
  app.get("/api/auth/approval-status", async (req: any, res) => {
    try {
      const { resolveRequestIdentity } = await import("./auth/identity");
      const identity = await resolveRequestIdentity(req);
      if (!identity) {
        return res.status(401).json({ authenticated: false });
      }

      const { subjectId } = identity;
      const isAllowed = await storage.isUserAllowed(subjectId);
      const approvalRequest = await storage.getApprovalRequest(subjectId);

      res.json({
        authenticated: true,
        isAllowed,
        isPending: approvalRequest?.status === "pending",
        isRejected: approvalRequest?.status === "rejected",
        name: identity.name || "User",
        email: identity.email ?? null,
      });
    } catch (error) {
      console.error("Error checking approval status:", error);
      res.status(500).json({ message: "Failed to check approval status" });
    }
  });

  // ===== WORKER RUN LOGS ROUTES (Owner only) =====
  
  // Get worker run logs with filters
  app.get("/api/admin/worker-logs", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { getWorkerRunLogs } = await import('./eventBus');
      const logs = await getWorkerRunLogs({
        eventId: req.query.eventId as string,
        correlationId: req.query.correlationId as string,
        workerName: req.query.workerName as string,
        status: req.query.status as string,
        limit: parseInt(req.query.limit as string) || 100,
        offset: parseInt(req.query.offset as string) || 0,
      });
      res.json(logs);
    } catch (error) {
      console.error("Error fetching worker logs:", error);
      res.status(500).json({ message: "Failed to fetch worker logs" });
    }
  });

  // Get dead letters
  app.get("/api/admin/dead-letters", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { getDeadLetters } = await import('./eventBus');
      const deadLetters = await getDeadLetters({
        eventId: req.query.eventId as string,
        workerName: req.query.workerName as string,
        limit: parseInt(req.query.limit as string) || 100,
        offset: parseInt(req.query.offset as string) || 0,
      });
      res.json(deadLetters);
    } catch (error) {
      console.error("Error fetching dead letters:", error);
      res.status(500).json({ message: "Failed to fetch dead letters" });
    }
  });

  // Get job queue stats
  app.get("/api/admin/worker-stats", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { getJobQueueStats } = await import('./eventBus');
      const stats = await getJobQueueStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching worker stats:", error);
      res.status(500).json({ message: "Failed to fetch worker stats" });
    }
  });

  // Retry a dead letter
  app.post("/api/admin/dead-letters/:id/retry", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { retryDeadLetter } = await import('./eventBus');
      const success = await retryDeadLetter(req.params.id);
      if (success) {
        res.json({ message: "Dead letter requeued for retry" });
      } else {
        res.status(404).json({ message: "Dead letter not found" });
      }
    } catch (error) {
      console.error("Error retrying dead letter:", error);
      res.status(500).json({ message: "Failed to retry dead letter" });
    }
  });

  // Get event details
  app.get("/api/admin/events/:eventId", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { getEvent, getWorkerRunLogs } = await import('./eventBus');
      const event = await getEvent(req.params.eventId);
      if (!event) {
        return res.status(404).json({ message: "Event not found" });
      }
      
      const workerLogs = await getWorkerRunLogs({ eventId: req.params.eventId });
      
      res.json({
        event,
        workerLogs,
      });
    } catch (error) {
      console.error("Error fetching event details:", error);
      res.status(500).json({ message: "Failed to fetch event details" });
    }
  });

  // Get job queue with detailed info (run_at, locked_at, last_error)
  app.get("/api/admin/job-queue", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { jobQueue } = await import('../shared/schema');
      const { desc, eq, and } = await import('drizzle-orm');
      
      // Build filters
      const conditions: any[] = [];
      if (req.query.status) {
        conditions.push(eq(jobQueue.status, req.query.status));
      }
      if (req.query.workerName) {
        conditions.push(eq(jobQueue.workerName, req.query.workerName));
      }
      if (req.query.eventId) {
        conditions.push(eq(jobQueue.eventId, req.query.eventId));
      }
      
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      
      let query = db.select().from(jobQueue);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      
      const jobs = await query.orderBy(desc(jobQueue.createdAt)).limit(limit).offset(offset);
      
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching job queue:", error);
      res.status(500).json({ message: "Failed to fetch job queue" });
    }
  });

  // Test endpoint to verify event-driven system end-to-end
  app.post("/api/admin/test-event", isAuthenticated, requireRole('SUPER_ADMIN'), requireSuperAdminMfa, async (req: any, res) => {
    try {
      const { publishEvent, dispatchPendingEvents } = await import('./eventBus');
      const { randomUUID } = await import('crypto');
      
      // Use valid UUIDs for all IDs to prevent database errors
      const testOrderId = randomUUID();
      const testLineId = randomUUID();
      const testProductId = randomUUID(); // Valid UUID prevents InventoryWorker failures
      
      // Publish a test OrderCreated event with valid UUIDs
      const eventId = await publishEvent('OrderCreated', testOrderId, {
        order: {
          orderId: testOrderId,
          status: 'pending',
          customerId: null, // No customer to avoid lookup failures
          total: 50.00,
          items: [
            {
              lineId: testLineId,
              productId: testProductId, // Valid UUID - InventoryWorker will gracefully handle non-existent product
              qty: 2,
              unitPrice: 25.00,
              lineTotal: 50.00,
            }
          ],
        }
      }, { source: 'test-endpoint' });
      
      // Immediately dispatch to create jobs
      const jobsCreated = await dispatchPendingEvents();
      
      console.log(`[TestEvent] Published event ${eventId}, dispatched ${jobsCreated} jobs`);
      
      res.json({
        success: true,
        eventId,
        correlationId: testOrderId,
        jobsCreated,
        message: `Test event published. Check /api/admin/worker-logs to see results.`,
      });
    } catch (error) {
      console.error("Error creating test event:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to create test event",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

}
