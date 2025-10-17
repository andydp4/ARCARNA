import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
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
    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({ message: "Failed to create product" });
    }
  });

  app.put("/api/products/:id", isAuthenticated, async (req, res) => {
    try {
      const { engine } = await import('../apps/server/src/engine.wiring');
      const product = await engine.updateProduct(req.params.id, req.body);
      res.json(product);
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({ message: "Failed to update product" });
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

  // Orders routes
  app.get("/api/orders", isAuthenticated, async (req, res) => {
    try {
      // TODO: Implement getOrders method in storage
      res.json([]);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.post("/api/orders", isAuthenticated, async (req: any, res) => {
    try {
      const { engine } = await import('./engine.wiring');
      
      // Validate required fields
      if (!req.body.items || !Array.isArray(req.body.items) || req.body.items.length === 0) {
        return res.status(400).json({ message: "Order must contain at least one item" });
      }
      
      // Validate payment method against domain enum
      const validPaymentMethods = ['cash', 'card', 'transfer', 'tick'];
      if (!req.body.payment_method || !validPaymentMethods.includes(req.body.payment_method)) {
        return res.status(400).json({ 
          message: `Payment method must be one of: ${validPaymentMethods.join(', ')}` 
        });
      }
      
      // Validate all items have required fields before mapping
      for (let i = 0; i < req.body.items.length; i++) {
        const item = req.body.items[i];
        if (!item.product_id || !item.quantity || item.price == null) {
          return res.status(400).json({ 
            message: `Item ${i + 1}: product_id, quantity, and price are required` 
          });
        }
        if (isNaN(Number(item.quantity)) || Number(item.quantity) <= 0) {
          return res.status(400).json({ 
            message: `Item ${i + 1}: quantity must be a positive number` 
          });
        }
        if (isNaN(Number(item.price)) || Number(item.price) < 0) {
          return res.status(400).json({ 
            message: `Item ${i + 1}: price must be a non-negative number` 
          });
        }
      }
      
      // Map frontend format to domain engine format
      // Domain expects: { customerId?, lines: [{productId, quantity, unitPrice}], paymentMethod }
      const orderInput = {
        customerId: req.body.customer_id || undefined,
        lines: req.body.items.map((item: any) => ({
          productId: item.product_id,
          quantity: Number(item.quantity),
          unitPrice: Number(item.price),
        })),
        paymentMethod: req.body.payment_method as 'cash' | 'card' | 'transfer' | 'tick',
      };
      
      // Use domain engine to place order - this will:
      // 1. Validate input with PlaceOrderInput schema
      // 2. Save order and line items
      // 3. Reserve stock for each product
      // 4. Update customer debt (if tick payment)
      // 5. Create invoice via InvoicesPort
      // 6. Trigger analytics events via AnalyticsSink
      // 7. Update customer metrics (CLV, RFM scores)
      // 8. Write audit logs
      const result = await engine.placeOrder(orderInput);
      
      res.json({ id: result.orderId, message: "Order placed successfully" });
    } catch (error: any) {
      console.error("Error creating order:", error);
      const message = error.message || "Failed to create order";
      const status = error.name === 'ZodError' ? 400 : 500;
      res.status(status).json({ message, errors: error.errors });
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
      // TODO: Implement getOrders method in storage
      const orders: any[] = [];
      // Transform orders into invoice format
      const invoices = orders.map((order: any) => ({
        id: order.id,
        invoiceNumber: `INV-${new Date(order.createdAt).getFullYear()}-${String(order.id).padStart(3, '0')}`,
        orderId: order.id,
        customerId: order.customerId,
        customerName: order.customer?.name || 'Walk-in Customer',
        customerEmail: order.customer?.email || '',
        date: order.createdAt,
        dueDate: new Date(new Date(order.createdAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from order
        total: parseFloat(order.total),
        subtotal: parseFloat(order.total) / 1.2, // Assuming 20% VAT
        vat: parseFloat(order.total) - (parseFloat(order.total) / 1.2),
        status: order.status === 'completed' ? 'paid' : 'pending',
        paymentMethod: order.paymentMethod,
        items: order.orderItems?.map((item: any) => ({
          name: item.product?.name || 'Unknown Product',
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice),
          total: parseFloat(item.totalPrice)
        })) || []
      }));
      res.json(invoices);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id/pdf", isAuthenticated, async (req, res) => {
    try {
      // For now, return a placeholder response
      // In production, this would generate a real PDF
      res.json({ 
        message: "PDF generation not yet implemented",
        invoiceId: req.params.id 
      });
    } catch (error) {
      console.error("Error generating invoice PDF:", error);
      res.status(500).json({ message: "Failed to generate invoice PDF" });
    }
  });

  // Tick Customers endpoints - for Credit/Tick List page
  app.get("/api/tick-customers", isAuthenticated, async (req, res) => {
    try {
      const customers = await storage.getCustomers();
      // Filter customers with outstanding credit
      const tickCustomers = customers
        .filter(customer => customer.category === 'tick' || (customer.loyaltyPoints && customer.loyaltyPoints > 0))
        .map(customer => ({
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          totalDebt: 0, // Would calculate from unpaid orders
          lastOrderDate: customer.createdAt,
          orders: []
        }));
      res.json(tickCustomers);
    } catch (error) {
      console.error("Error fetching tick customers:", error);
      res.status(500).json({ message: "Failed to fetch tick customers" });
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

  const httpServer = createServer(app);
  return httpServer;
}
