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
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isOwner } from "./replitAuth";
import { 
  insertLoyaltyTierSchema, 
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema
} from "../shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Analytics routes
  app.get("/api/analytics/top-customers", isAuthenticated, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const topCustomers = await storage.getTopCustomers(limit);
      
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

  app.get("/api/analytics/daily-revenue", isAuthenticated, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const dailyRevenue = await storage.getDailyRevenue(days);
      res.json(dailyRevenue);
    } catch (error) {
      console.error("Error fetching daily revenue:", error);
      res.status(500).json({ message: "Failed to fetch daily revenue" });
    }
  });

  app.get("/api/analytics/monthly-summary", isAuthenticated, async (req, res) => {
    try {
      const months = parseInt(req.query.months as string) || 12;
      const monthlySummary = await storage.getMonthlySummary(months);
      res.json(monthlySummary);
    } catch (error) {
      console.error("Error fetching monthly summary:", error);
      res.status(500).json({ message: "Failed to fetch monthly summary" });
    }
  });

  // Products routes
  app.get("/api/products", isAuthenticated, async (req, res) => {
    try {
      const products = await storage.getProducts();
      res.json(products);
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/:id", isAuthenticated, async (req, res) => {
    try {
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  app.post("/api/products", isAuthenticated, async (req, res) => {
    try {
      // Import domain engine (will be wired properly in apps/server)
      const { engine } = await import('../apps/server/src/engine.wiring');
      const product = await engine.createProduct(req.body);
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

  app.put("/api/products/:id", isAuthenticated, async (req, res) => {
    try {
      const { engine } = await import('../apps/server/src/engine.wiring');
      const product = await engine.updateProduct(req.params.id, req.body);
      res.json(product);
    } catch (error: any) {
      console.error("Error updating product:", error);
      
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
      res.status(500).json({ message: error.message || "Failed to update product" });
    }
  });

  app.delete("/api/products/:id", isAuthenticated, async (req, res) => {
    try {
      const { engine } = await import('../apps/server/src/engine.wiring');
      await engine.deleteProduct(req.params.id);
      res.json({ message: "Product deleted successfully" });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ message: "Failed to delete product" });
    }
  });

  app.post("/api/products/import", isAuthenticated, async (req, res) => {
    try {
      const { products } = req.body;
      if (!Array.isArray(products)) {
        return res.status(400).json({ message: "Invalid data format. Expected array of products" });
      }
      const result = await storage.importProducts(products);
      res.json(result);
    } catch (error) {
      console.error("Error importing products:", error);
      res.status(500).json({ message: "Failed to import products" });
    }
  });

  // Customers routes
  app.get("/api/customers", isAuthenticated, async (req, res) => {
    try {
      const customers = await storage.getCustomers();
      res.json(customers);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  app.get("/api/customers/:id", isAuthenticated, async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }
      res.json(customer);
    } catch (error) {
      console.error("Error fetching customer:", error);
      res.status(500).json({ message: "Failed to fetch customer" });
    }
  });

  app.post("/api/customers", isAuthenticated, async (req, res) => {
    try {
      const { engine } = await import('../apps/server/src/engine.wiring');
      const customer = await engine.createCustomer(req.body);
      res.json(customer);
    } catch (error) {
      console.error("Error creating customer:", error);
      res.status(500).json({ message: "Failed to create customer" });
    }
  });

  app.put("/api/customers/:id", isAuthenticated, async (req, res) => {
    try {
      const { engine } = await import('../apps/server/src/engine.wiring');
      const customer = await engine.updateCustomer(req.params.id, req.body);
      res.json(customer);
    } catch (error) {
      console.error("Error updating customer:", error);
      res.status(500).json({ message: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", isAuthenticated, async (req, res) => {
    try {
      const { engine } = await import('../apps/server/src/engine.wiring');
      await engine.deleteCustomer(req.params.id);
      res.json({ message: "Customer deleted successfully" });
    } catch (error) {
      console.error("Error deleting customer:", error);
      res.status(500).json({ message: "Failed to delete customer" });
    }
  });

  // Orders routes using domain engine with transactional outbox
  app.post("/api/orders", isAuthenticated, async (req, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { orders, order_items } = await import('../apps/server/src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { publishEvent } = await import('./eventBus');
      const { engine } = await import('../apps/server/src/engine.wiring');
      
      // Create order via engine (handles its own validation/logic)
      const result = await engine.placeOrder(req.body);
      
      // Fetch the complete order and items
      const [createdOrder] = await db.select().from(orders).where(eq(orders.id, result.orderId));
      const items = await db.select().from(order_items).where(eq(order_items.order_id, result.orderId));
      
      // Publish event - this is critical, failure should be visible
      // Note: True transactional outbox requires engine refactor to accept tx client
      const eventId = await publishEvent('OrderCreated', result.orderId, {
        order: {
          orderId: result.orderId,
          status: createdOrder?.status || 'pending',
          customerId: createdOrder?.customer_id,
          total: parseFloat(createdOrder?.total || '0'),
          items: items.map(item => ({
            lineId: item.id,
            productId: item.product_id,
            qty: item.quantity,
            unitPrice: parseFloat(item.unit_price || '0'),
            lineTotal: parseFloat(item.total_price || '0'),
          })),
        }
      }, { source: 'api-orders' });
      
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

  app.get("/api/orders", isAuthenticated, async (req, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { orders } = await import('../apps/server/src/db/schema');
      const allOrders = await db.select({
        id: orders.id,
        customerId: orders.customer_id,
        total: orders.total,
        paymentMethod: orders.payment_method,
        status: orders.status,
        createdAt: orders.created_at,
      }).from(orders).orderBy(orders.created_at);
      res.json(allOrders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/:id", isAuthenticated, async (req, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { orders, order_items, products, customers } = await import('../apps/server/src/db/schema');
      const { eq } = await import('drizzle-orm');
      
      const [order] = await db.select().from(orders).where(eq(orders.id, req.params.id));
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

  app.patch("/api/orders/:id", isAuthenticated, async (req, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { orders } = await import('../apps/server/src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { updateOrderStatusSchema } = await import('../shared/schema');
      const { publishEvent } = await import('./eventBus');
      
      // Validate status
      const validation = updateOrderStatusSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: 'Invalid status value',
          errors: validation.error.errors
        });
      }
      
      // Get current status before update
      const [currentOrder] = await db.select().from(orders).where(eq(orders.id, req.params.id));
      const previousStatus = currentOrder?.status;
      
      const [updated] = await db.update(orders)
        .set({ status: validation.data.status, updated_at: new Date() })
        .where(eq(orders.id, req.params.id))
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

  app.put("/api/orders/:id", isAuthenticated, async (req, res) => {
    try {
      const { engine } = await import('../apps/server/src/engine.wiring');
      const { publishEvent } = await import('./eventBus');
      const { db } = await import('../apps/server/src/db');
      const { orders, order_items } = await import('../apps/server/src/db/schema');
      const { eq } = await import('drizzle-orm');
      
      const result = await engine.updateOrder(req.params.id, req.body);
      
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

  app.delete("/api/orders/:id", isAuthenticated, async (req, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { orders, order_items, products } = await import('../apps/server/src/db/schema');
      const { eq, sql } = await import('drizzle-orm');
      
      // Begin transaction to delete order and its items, and release stock
      await db.transaction(async (tx) => {
        // Get order items to release stock
        const items = await tx.select().from(order_items).where(eq(order_items.order_id, req.params.id));
        
        // Release stock for each item
        for (const item of items) {
          if (item.product_id) {
            await tx.update(products)
              .set({ stock: sql`stock + ${item.quantity}` })
              .where(eq(products.id, item.product_id));
          }
        }
        
        // Delete order items
        await tx.delete(order_items).where(eq(order_items.order_id, req.params.id));
        
        // Delete order
        const [deleted] = await tx.delete(orders).where(eq(orders.id, req.params.id)).returning();
        
        if (!deleted) {
          throw new Error('Order not found');
        }
      });
      
      res.json({ message: "Order deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting order:", error);
      const message = error.message === 'Order not found' ? 'Order not found' : 'Failed to delete order';
      const status = error.message === 'Order not found' ? 404 : 500;
      res.status(status).json({ message });
    }
  });

  // Inventory routes
  app.get("/api/inventory", isAuthenticated, async (req, res) => {
    try {
      const products = await storage.getProductsWithStock();
      res.json(products);
    } catch (error) {
      console.error("Error fetching inventory:", error);
      res.status(500).json({ message: "Failed to fetch inventory" });
    }
  });

  app.patch("/api/inventory/:productId", isAuthenticated, async (req: any, res) => {
    try {
      const { productId } = req.params;
      const { adjustment, type } = req.body;
      const userId = req.user.claims.sub;
      
      const product = await storage.updateProductStock(productId, adjustment, type, userId);
      res.json(product);
    } catch (error) {
      console.error("Error updating inventory:", error);
      res.status(500).json({ message: "Failed to update inventory" });
    }
  });

  // Low stock alerts endpoint
  app.get("/api/inventory/alerts", isAuthenticated, async (req, res) => {
    try {
      const products = await storage.getProductsWithStock();
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
  app.get("/api/reports", isAuthenticated, async (req: any, res) => {
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
      
      const reportData = await storage.getReportData(fromDate, toDate);
      res.json(reportData);
    } catch (error) {
      console.error("Error fetching report data:", error);
      res.status(500).json({ message: "Failed to fetch report data" });
    }
  });

  app.get("/api/reports/export", isAuthenticated, async (req: any, res) => {
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
      
      const reportData = await storage.getReportData(fromDate, toDate);
      
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

  // Locations routes
  app.get("/api/locations", isAuthenticated, async (req, res) => {
    try {
      const locations = await storage.getLocations();
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.post("/api/locations", isAuthenticated, async (req: any, res) => {
    try {
      const locationData = req.body;
      const location = await storage.createLocation(locationData);
      res.json(location);
    } catch (error) {
      console.error("Error creating location:", error);
      res.status(500).json({ message: "Failed to create location" });
    }
  });

  app.patch("/api/locations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const locationData = req.body;
      const location = await storage.updateLocation(id, locationData);
      res.json(location);
    } catch (error) {
      console.error("Error updating location:", error);
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  app.delete("/api/locations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      await storage.deleteLocation(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting location:", error);
      res.status(500).json({ message: "Failed to delete location" });
    }
  });

  app.post("/api/locations/:id/set-default", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const location = await storage.setDefaultLocation(id);
      res.json(location);
    } catch (error) {
      console.error("Error setting default location:", error);
      res.status(500).json({ message: "Failed to set default location" });
    }
  });

  app.get("/api/locations/:id/stock", isAuthenticated, async (req: any, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { products } = await import('../apps/server/src/db/schema');
      const { eq, desc } = await import('drizzle-orm');
      
      // For now, return all products with their stock levels
      // In a multi-location system, this would filter by location_id
      const allProducts = await db.select({
        id: products.id,
        name: products.name,
        productCode: products.product_id,
        stock: products.stock,
        salePrice: products.default_sale_price,
        costPrice: products.cost_price,
      }).from(products).orderBy(desc(products.stock));
      
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
  app.get("/api/loyalty-tiers", isAuthenticated, async (req: any, res) => {
    try {
      const tiers = await storage.getLoyaltyTiers();
      res.json(tiers);
    } catch (error) {
      console.error("Error fetching loyalty tiers:", error);
      res.status(500).json({ message: "Failed to fetch loyalty tiers" });
    }
  });

  app.post("/api/loyalty-tiers", isAuthenticated, async (req: any, res) => {
    try {
      const validatedData = insertLoyaltyTierSchema.parse(req.body);
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

  app.patch("/api/loyalty-tiers/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      // Partial validation - only validate provided fields
      const validatedData = insertLoyaltyTierSchema.partial().parse(req.body);
      const tier = await storage.updateLoyaltyTier(id, validatedData);
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

  app.delete("/api/loyalty-tiers/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      await storage.deleteLoyaltyTier(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting loyalty tier:", error);
      res.status(500).json({ message: "Failed to delete loyalty tier" });
    }
  });

  // Promotions routes
  app.get("/api/promotions", isAuthenticated, async (req: any, res) => {
    try {
      const activeOnly = req.query.active === 'true';
      const promotions = await storage.getPromotions(activeOnly);
      res.json(promotions);
    } catch (error) {
      console.error("Error fetching promotions:", error);
      res.status(500).json({ message: "Failed to fetch promotions" });
    }
  });

  app.post("/api/promotions", isAuthenticated, async (req: any, res) => {
    try {
      const validatedData = insertPromotionSchema.parse(req.body);
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

  app.patch("/api/promotions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      // Partial validation - only validate provided fields
      const validatedData = insertPromotionSchema.partial().parse(req.body);
      const promo = await storage.updatePromotion(id, validatedData);
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

  app.delete("/api/promotions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      await storage.deletePromotion(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting promotion:", error);
      res.status(500).json({ message: "Failed to delete promotion" });
    }
  });

  app.post("/api/promotions/validate", isAuthenticated, async (req: any, res) => {
    try {
      const { code } = req.body;
      const promo = await storage.validatePromoCode(code);
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
  app.get("/api/overhead-expenses", isAuthenticated, async (req, res) => {
    try {
      const expenses = await storage.getOverheadExpenses();
      res.json(expenses);
    } catch (error) {
      console.error("Error fetching overhead expenses:", error);
      res.status(500).json({ message: "Failed to fetch overhead expenses" });
    }
  });

  app.post("/api/overhead-expenses", isAuthenticated, async (req: any, res) => {
    try {
      const parsedBody = insertOverheadExpenseSchema.parse(req.body);
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

  app.put("/api/overhead-expenses/:id", isAuthenticated, async (req: any, res) => {
    try {
      const parsedBody = insertOverheadExpenseSchema.partial().parse(req.body);
      const expense = await storage.updateOverheadExpense(req.params.id, parsedBody);
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

  app.delete("/api/overhead-expenses/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteOverheadExpense(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting overhead expense:", error);
      res.status(500).json({ message: "Failed to delete overhead expense" });
    }
  });

  app.get("/api/orders/:orderId/expenses", isAuthenticated, async (req, res) => {
    try {
      const expenses = await storage.getOrderExpenses(req.params.orderId);
      res.json(expenses);
    } catch (error) {
      console.error("Error fetching order expenses:", error);
      res.status(500).json({ message: "Failed to fetch order expenses" });
    }
  });

  app.get("/api/expense-analytics", isAuthenticated, async (req, res) => {
    try {
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
      }
      
      const analytics = await storage.getExpenseAnalytics(startDate, endDate);
      res.json(analytics);
    } catch (error) {
      console.error("Error fetching expense analytics:", error);
      res.status(500).json({ message: "Failed to fetch expense analytics" });
    }
  });

  app.get("/api/expense-report", isAuthenticated, async (req, res) => {
    try {
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
      }
      
      const report = await storage.getExpenseReport(startDate, endDate);
      res.json(report);
    } catch (error) {
      console.error("Error fetching expense report:", error);
      res.status(500).json({ message: "Failed to fetch expense report" });
    }
  });

  app.get("/api/profit-analysis", isAuthenticated, async (req, res) => {
    try {
      const startDate = new Date(req.query.startDate as string);
      const endDate = new Date(req.query.endDate as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format' });
        return;
      }
      
      const analysis = await storage.getProfitAnalysis(startDate, endDate);
      res.json(analysis);
    } catch (error) {
      console.error("Error fetching profit analysis:", error);
      res.status(500).json({ message: "Failed to fetch profit analysis" });
    }
  });

  // Invoices endpoints - for Invoice Management page
  app.get("/api/invoices", isAuthenticated, async (req, res) => {
    try {
      const invoices = await storage.getInvoicesWithDetails();
      res.json(invoices);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id/pdf", isAuthenticated, async (req, res) => {
    try {
      const invoiceId = req.params.id;
      
      // Get invoice from database
      const { invoices } = await import('../shared/schema');
      const { eq } = await import('drizzle-orm');
      const { db } = await import('./db');
      
      const invoiceResult = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      
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
  app.post("/api/invoices/:id/regenerate-pdf", isAuthenticated, async (req, res) => {
    try {
      const invoiceId = req.params.id;
      
      const { invoices, orders, orderItems, customers } = await import('../shared/schema');
      const { eq } = await import('drizzle-orm');
      const { db } = await import('./db');
      const { generateInvoicePdf } = await import('./services/pdfGenerator');
      const { uploadPdfToDrive, createFolderIfNotExists } = await import('./services/googleDrive');
      
      const invoiceResult = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      
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
      
      // Generate PDF
      const pdfBuffer = await generateInvoicePdf({
        invoiceNumber: invoice.invoiceNumber,
        createdAt: invoice.createdAt?.toISOString() || new Date().toISOString(),
        dueDate: invoice.dueDate || '',
        customerName: customerData?.name,
        customerEmail: customerData?.email || undefined,
        customerPhone: customerData?.phone || undefined,
        items: itemsData.length > 0 ? itemsData.map((item: any) => ({
          name: item.productName || 'Unknown Product',
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice || '0'),
          total: parseFloat(item.lineTotal || '0'),
        })) : [{
          name: 'Order Total',
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

  // Tick Customers endpoints - for Credit/Tick List page
  app.get("/api/tick-customers", isAuthenticated, async (req, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { customers, orders } = await import('../apps/server/src/db/schema');
      const { eq, and, sql } = await import('drizzle-orm');
      
      // Get customers with tick orders
      const allCustomers = await storage.getCustomers();
      
      // Get tick payment orders grouped by customer
      const tickOrders = await db
        .select({
          customerId: orders.customer_id,
          totalDebt: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`,
          lastOrderDate: sql<string>`MAX(${orders.created_at})`,
          orderCount: sql<number>`COUNT(*)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.payment_method, 'tick'),
            sql`${orders.status} != 'completed'`
          )
        )
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

  app.delete("/api/tick-customers/:id", isAuthenticated, async (req, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { orders } = await import('../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      
      // Mark all tick orders for this customer as completed (paid)
      await db.update(orders)
        .set({ status: 'completed', updated_at: new Date() })
        .where(
          and(
            eq(orders.customer_id, req.params.id),
            eq(orders.payment_method, 'tick')
          )
        );
      
      res.json({ message: "Customer removed from tick list" });
    } catch (error) {
      console.error("Error removing tick customer:", error);
      res.status(500).json({ message: "Failed to remove customer from tick list" });
    }
  });

  app.post("/api/tick-customers/:id/mark-paid", isAuthenticated, async (req, res) => {
    try {
      const { db } = await import('../apps/server/src/db');
      const { orders } = await import('../apps/server/src/db/schema');
      const { eq, and } = await import('drizzle-orm');
      
      // Mark all tick orders for this customer as completed
      await db.update(orders)
        .set({ status: 'completed', updated_at: new Date() })
        .where(
          and(
            eq(orders.customer_id, req.params.id),
            eq(orders.payment_method, 'tick')
          )
        );
      
      res.json({ message: "Customer debt marked as paid" });
    } catch (error) {
      console.error("Error marking customer as paid:", error);
      res.status(500).json({ message: "Failed to mark customer as paid" });
    }
  });

  // Settings endpoints - for Settings page
  app.get("/api/settings", isAuthenticated, async (req, res) => {
    try {
      // Return default settings - in production, these would be stored in DB
      const settings = {
        businessName: 'Midnight EPOS',
        businessAddress: '',
        businessPhone: '',
        businessEmail: '',
        businessWebsite: '',
        vatEnabled: true,
        vatRate: 20,
        vatNumber: '',
        cardPaymentEnabled: true,
        cashPaymentEnabled: true,
        tickPaymentEnabled: true,
        transferPaymentEnabled: true,
        lowStockThreshold: 20,
        criticalStockThreshold: 5,
        multiLocationEnabled: false,
      };
      res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/settings", isAuthenticated, async (req, res) => {
    try {
      // In production, this would save to database
      res.json({ message: "Settings updated successfully", settings: req.body });
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // ===== ADMIN ROUTES - User Access Management =====
  
  // Get allowed users list (owner only)
  app.get("/api/admin/allowed-users", isAuthenticated, isOwner, async (req: any, res) => {
    try {
      const users = await storage.getAllowedUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching allowed users:", error);
      res.status(500).json({ message: "Failed to fetch allowed users" });
    }
  });

  // Remove allowed user (owner only)
  app.delete("/api/admin/allowed-users/:replitUserId", isAuthenticated, isOwner, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      
      // Prevent owner from removing themselves
      const owner = await storage.getOwner();
      if (owner && owner.replitUserId === replitUserId) {
        return res.status(400).json({ message: "Cannot remove owner from allowed users" });
      }
      
      await storage.removeAllowedUser(replitUserId);
      res.json({ message: "User removed from allowed list" });
    } catch (error) {
      console.error("Error removing allowed user:", error);
      res.status(500).json({ message: "Failed to remove user" });
    }
  });

  // Get pending approval requests (owner only)
  app.get("/api/admin/pending-approvals", isAuthenticated, isOwner, async (req: any, res) => {
    try {
      const requests = await storage.getPendingApprovals();
      res.json(requests);
    } catch (error) {
      console.error("Error fetching pending approvals:", error);
      res.status(500).json({ message: "Failed to fetch pending approvals" });
    }
  });

  // Approve user (owner only)
  app.post("/api/admin/approve/:replitUserId", isAuthenticated, isOwner, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      const approvedBy = req.user.claims?.sub || 'owner';
      
      await storage.approveUser(replitUserId, approvedBy);
      res.json({ message: "User approved successfully" });
    } catch (error) {
      console.error("Error approving user:", error);
      res.status(500).json({ message: "Failed to approve user" });
    }
  });

  // Reject user (owner only)
  app.post("/api/admin/reject/:replitUserId", isAuthenticated, isOwner, async (req: any, res) => {
    try {
      const { replitUserId } = req.params;
      const rejectedBy = req.user.claims?.sub || 'owner';
      
      await storage.rejectUser(replitUserId, rejectedBy);
      res.json({ message: "User rejected" });
    } catch (error) {
      console.error("Error rejecting user:", error);
      res.status(500).json({ message: "Failed to reject user" });
    }
  });

  // Check current user's approval status (for pending approval page)
  app.get("/api/auth/approval-status", async (req: any, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ authenticated: false });
      }
      
      const replitUserId = user.claims?.sub;
      if (!replitUserId) {
        return res.status(401).json({ authenticated: false });
      }
      
      const isAllowed = await storage.isUserAllowed(replitUserId);
      const approvalRequest = await storage.getApprovalRequest(replitUserId);
      
      res.json({
        authenticated: true,
        isAllowed,
        isPending: approvalRequest?.status === 'pending',
        isRejected: approvalRequest?.status === 'rejected',
        name: user.claims?.name || user.claims?.first_name || 'User',
        email: user.claims?.email,
      });
    } catch (error) {
      console.error("Error checking approval status:", error);
      res.status(500).json({ message: "Failed to check approval status" });
    }
  });

  // ===== WORKER RUN LOGS ROUTES (Owner only) =====
  
  // Get worker run logs with filters
  app.get("/api/admin/worker-logs", isAuthenticated, isOwner, async (req: any, res) => {
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
  app.get("/api/admin/dead-letters", isAuthenticated, isOwner, async (req: any, res) => {
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
  app.get("/api/admin/worker-stats", isAuthenticated, isOwner, async (req: any, res) => {
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
  app.post("/api/admin/dead-letters/:id/retry", isAuthenticated, isOwner, async (req: any, res) => {
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
  app.get("/api/admin/events/:eventId", isAuthenticated, isOwner, async (req: any, res) => {
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
  app.get("/api/admin/job-queue", isAuthenticated, isOwner, async (req: any, res) => {
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
  app.post("/api/admin/test-event", isAuthenticated, isOwner, async (req: any, res) => {
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

  const httpServer = createServer(app);
  return httpServer;
}
