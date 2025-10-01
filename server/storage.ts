import {
  users,
  customers,
  customerMetrics,
  analyticsDaily,
  analyticsMonthly,
  products,
  orders,
  orderItems,
  locations,
  loyaltyTiers,
  promotions,
  overheadExpenses,
  orderExpenses,
  type User,
  type UpsertUser,
  type Customer,
  type CustomerMetric,
  type Product,
  type Order,
  type OrderItem,
  type Location,
  type LoyaltyTier,
  type InsertLoyaltyTier,
  type Promotion,
  type InsertPromotion,
  type OverheadExpense,
  type InsertOverheadExpense,
  type OrderExpense,
  type InsertOrderExpense,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, or, lte, gte, isNull, between } from "drizzle-orm";

export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Analytics operations
  getTopCustomers(limit: number): Promise<
    Array<{
      customer: Customer;
      metrics: CustomerMetric | null;
    }>
  >;
  getDailyRevenue(days: number): Promise<
    Array<{
      date: string;
      totalOrders: number;
      totalRevenue: string;
    }>
  >;
  getMonthlySummary(months: number): Promise<
    Array<{
      year: number;
      month: number;
      totalOrders: number;
      totalRevenue: string;
    }>
  >;
  
  // POS operations
  getProducts(): Promise<Product[]>;
  getCustomers(): Promise<Customer[]>;
  createOrder(orderData: any): Promise<Order>;
  
  // Inventory operations
  getProductsWithStock(): Promise<Product[]>;
  updateProductStock(productId: string, adjustment: number, type: 'add' | 'set', userId: string): Promise<Product>;
  
  // Reports operations
  getReportData(fromDate: Date, toDate: Date): Promise<any>;
  generateCSVReport(data: any, type: string): Promise<string>;
  generatePDFReport(data: any, type: string): Promise<Buffer>;
  
  // Locations operations
  getLocations(): Promise<Location[]>;
  createLocation(data: any): Promise<Location>;
  updateLocation(id: string, data: any): Promise<Location>;
  deleteLocation(id: string): Promise<void>;
  setDefaultLocation(id: string): Promise<Location>;
  
  // Loyalty operations
  getLoyaltyTiers(): Promise<LoyaltyTier[]>;
  createLoyaltyTier(data: InsertLoyaltyTier): Promise<LoyaltyTier>;
  updateLoyaltyTier(id: string, data: Partial<InsertLoyaltyTier>): Promise<LoyaltyTier>;
  deleteLoyaltyTier(id: string): Promise<void>;
  updateCustomerTier(customerId: string): Promise<Customer>;
  
  // Promotions operations
  getPromotions(active?: boolean): Promise<Promotion[]>;
  createPromotion(data: InsertPromotion): Promise<Promotion>;
  updatePromotion(id: string, data: Partial<InsertPromotion>): Promise<Promotion>;
  deletePromotion(id: string): Promise<void>;
  validatePromoCode(code: string): Promise<Promotion | null>;
  applyPromotion(orderId: string, promoCode: string): Promise<number>;
  
  // Expense operations
  getOverheadExpenses(): Promise<OverheadExpense[]>;
  createOverheadExpense(data: InsertOverheadExpense): Promise<OverheadExpense>;
  updateOverheadExpense(id: string, data: Partial<InsertOverheadExpense>): Promise<OverheadExpense>;
  deleteOverheadExpense(id: string): Promise<void>;
  getOrderExpenses(orderId: string): Promise<OrderExpense[]>;
  createOrderExpenses(orderId: string, expenses: InsertOrderExpense[]): Promise<void>;
  getExpenseAnalytics(startDate: Date, endDate: Date): Promise<{
    overheadTotal: number;
    orderExpenseTotal: number;
    totalExpenses: number;
    dailyOverhead: number;
    overheadBreakdown: any[];
  }>;
  getExpenseReport(startDate: Date, endDate: Date): Promise<any>;
  getProfitAnalysis(startDate: Date, endDate: Date): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getTopCustomers(limit: number = 10): Promise<
    Array<{
      customer: Customer;
      metrics: CustomerMetric | null;
    }>
  > {
    const results = await db
      .select({
        customer: customers,
        metrics: customerMetrics,
      })
      .from(customers)
      .leftJoin(
        customerMetrics,
        eq(customers.id, customerMetrics.customerId)
      )
      .orderBy(desc(customerMetrics.clv))
      .limit(limit);

    return results;
  }

  async getDailyRevenue(days: number = 30): Promise<
    Array<{
      date: string;
      totalOrders: number;
      totalRevenue: string;
    }>
  > {
    const results = await db
      .select({
        date: analyticsDaily.date,
        totalOrders: analyticsDaily.totalOrders,
        totalRevenue: analyticsDaily.totalRevenue,
      })
      .from(analyticsDaily)
      .orderBy(desc(analyticsDaily.date))
      .limit(days);

    return results.reverse().map((r) => ({
      date: r.date || "",
      totalOrders: r.totalOrders || 0,
      totalRevenue: r.totalRevenue || "0",
    }));
  }

  async getMonthlySummary(months: number = 12): Promise<
    Array<{
      year: number;
      month: number;
      totalOrders: number;
      totalRevenue: string;
    }>
  > {
    const results = await db
      .select({
        year: analyticsMonthly.year,
        month: analyticsMonthly.month,
        totalOrders: analyticsMonthly.totalOrders,
        totalRevenue: analyticsMonthly.totalRevenue,
      })
      .from(analyticsMonthly)
      .orderBy(
        desc(analyticsMonthly.year),
        desc(analyticsMonthly.month)
      )
      .limit(months);

    return results.reverse().map((r) => ({
      year: r.year || 0,
      month: r.month || 0,
      totalOrders: r.totalOrders || 0,
      totalRevenue: r.totalRevenue || "0",
    }));
  }

  async getProducts(): Promise<Product[]> {
    return await db.select().from(products).orderBy(products.name);
  }

  async getCustomers(): Promise<Customer[]> {
    return await db.select().from(customers).orderBy(customers.name);
  }

  async createOrder(orderData: any): Promise<Order> {
    return await db.transaction(async (tx) => {
      // Create order
      const [order] = await tx
        .insert(orders)
        .values({
          customerId: orderData.customer_id,
          total: orderData.total,
          paymentMethod: orderData.payment_method,
          status: 'completed',
        })
        .returning();

      // Create order items
      if (orderData.items && orderData.items.length > 0) {
        await tx.insert(orderItems).values(
          orderData.items.map((item: any) => ({
            orderId: order.id,
            productId: item.product_id,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            totalPrice: item.total_price,
          }))
        );
        
        // Create order expenses if provided
        if (orderData.expenses && orderData.expenses.length > 0) {
          await tx.insert(orderExpenses).values(
            orderData.expenses.map((expense: any) => ({
              orderId: order.id,
              category: expense.category,
              description: expense.description,
              amount: expense.amount,
            }))
          );
        }

        // Update product stock
        for (const item of orderData.items) {
          await tx
            .update(products)
            .set({
              stock: sql`stock - ${item.quantity}`,
            })
            .where(eq(products.id, item.product_id));
        }
      }

      // Update customer loyalty points if applicable
      if (orderData.customer_id) {
        const points = Math.floor(orderData.total / 10); // 1 point per $10
        await tx
          .update(customers)
          .set({
            loyaltyPoints: sql`loyalty_points + ${points}`,
          })
          .where(eq(customers.id, orderData.customer_id));
      }

      return order;
    });
  }

  async getProductsWithStock(): Promise<Product[]> {
    return await db.select().from(products).orderBy(products.name);
  }

  async updateProductStock(
    productId: string, 
    adjustment: number, 
    type: 'add' | 'set',
    userId: string
  ): Promise<Product> {
    return await db.transaction(async (tx) => {
      // Get current product
      const [currentProduct] = await tx
        .select()
        .from(products)
        .where(eq(products.id, productId));
      
      if (!currentProduct) {
        throw new Error('Product not found');
      }

      // Calculate new stock
      const newStock = type === 'set' 
        ? adjustment 
        : (currentProduct.stock ?? 0) + adjustment;

      // Validate stock
      if (newStock < 0) {
        throw new Error('Stock cannot be negative');
      }

      // Update stock
      const [updatedProduct] = await tx
        .update(products)
        .set({
          stock: newStock,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
        .returning();

      // Log audit entry (optional - you can add audit logging here)
      // await tx.insert(auditLogs).values({
      //   userId,
      //   action: 'UPDATE_STOCK',
      //   entityType: 'product',
      //   entityId: productId,
      //   oldValues: { stock: currentProduct.stock },
      //   newValues: { stock: newStock },
      // });

      return updatedProduct;
    });
  }

  async getReportData(fromDate: Date, toDate: Date): Promise<any> {
    const [
      revenueData,
      orderData, 
      customerData,
      inventoryData
    ] = await Promise.all([
      this.getRevenueReports(fromDate, toDate),
      this.getOrderReports(fromDate, toDate),
      this.getCustomerReports(fromDate, toDate),
      this.getInventoryReports(fromDate, toDate)
    ]);

    return {
      revenue: revenueData,
      orders: orderData,
      customers: customerData,
      inventory: inventoryData
    };
  }

  private async getRevenueReports(fromDate: Date, toDate: Date) {
    // Get total revenue
    const totalRevenue = await db
      .select({
        total: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`
      })
      .from(orders)
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      );

    // Get daily revenue
    const dailyRevenue = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`.as('date'),
        revenue: sql<number>`SUM(CAST(${orders.total} AS DECIMAL))`.as('revenue'),
        orders: sql<number>`COUNT(*)`.as('orders')
      })
      .from(orders)
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      )
      .groupBy(sql`DATE(${orders.createdAt})`)
      .orderBy(sql`DATE(${orders.createdAt})`);

    // Get revenue by payment method
    const byPaymentMethod = await db
      .select({
        method: orders.paymentMethod,
        count: sql<number>`COUNT(*)`.as('count'),
        revenue: sql<number>`SUM(CAST(${orders.total} AS DECIMAL))`.as('revenue')
      })
      .from(orders)
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      )
      .groupBy(orders.paymentMethod);

    return {
      total: totalRevenue[0]?.total || 0,
      byDay: dailyRevenue,
      byCategory: [], // Would need to join with products and categories
      byPaymentMethod
    };
  }

  private async getOrderReports(fromDate: Date, toDate: Date) {
    // Get total orders
    const totalOrders = await db
      .select({
        total: sql<number>`COUNT(*)`
      })
      .from(orders)
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      );

    // Get average order value
    const avgOrder = await db
      .select({
        average: sql<number>`AVG(CAST(${orders.total} AS DECIMAL))`
      })
      .from(orders)
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      );

    // Get top products
    const topProducts = await db
      .select({
        name: products.name,
        quantity: sql<number>`SUM(${orderItems.quantity})`.as('quantity'),
        revenue: sql<number>`SUM(CAST(${orderItems.totalPrice} AS DECIMAL))`.as('revenue')
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      )
      .groupBy(products.name)
      .orderBy(sql`SUM(${orderItems.quantity}) DESC`)
      .limit(10);

    // Get hourly distribution
    const hourlyDistribution = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${orders.createdAt})`.as('hour'),
        count: sql<number>`COUNT(*)`.as('count')
      })
      .from(orders)
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      )
      .groupBy(sql`EXTRACT(HOUR FROM ${orders.createdAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${orders.createdAt})`);

    return {
      total: totalOrders[0]?.total || 0,
      average: avgOrder[0]?.average || 0,
      topProducts,
      hourlyDistribution
    };
  }

  private async getCustomerReports(fromDate: Date, toDate: Date) {
    // Get total active customers
    const totalCustomers = await db
      .select({
        total: sql<number>`COUNT(DISTINCT ${orders.customerId})`
      })
      .from(orders)
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      );

    // Get new vs returning customers
    const newCustomers = await db
      .select({
        count: sql<number>`COUNT(DISTINCT ${customers.id})`
      })
      .from(customers)
      .where(
        sql`${customers.createdAt} >= ${fromDate} AND ${customers.createdAt} <= ${toDate}`
      );

    // Get top customers
    const topCustomers = await db
      .select({
        name: customers.name,
        orders: sql<number>`COUNT(${orders.id})`.as('orders'),
        revenue: sql<number>`SUM(CAST(${orders.total} AS DECIMAL))`.as('revenue'),
        loyalty: customers.loyaltyPoints
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      )
      .groupBy(customers.id, customers.name, customers.loyaltyPoints)
      .orderBy(sql`SUM(CAST(${orders.total} AS DECIMAL)) DESC`)
      .limit(10);

    const total = totalCustomers[0]?.total || 0;
    const newCount = newCustomers[0]?.count || 0;

    return {
      total,
      new: newCount,
      returning: total - newCount,
      topCustomers,
      rfmSegments: [] // Would need more complex RFM calculation
    };
  }

  private async getInventoryReports(fromDate: Date, toDate: Date) {
    // Get total stock value
    const stockValue = await db
      .select({
        total: sql<number>`SUM(${products.stock} * CAST(${products.costPrice} AS DECIMAL))`
      })
      .from(products);

    // Get low stock count
    const lowStock = await db
      .select({
        count: sql<number>`COUNT(*)`
      })
      .from(products)
      .where(
        sql`${products.stock} <= ${products.stockLimit} * 0.2 AND ${products.stock} > 0`
      );

    // Get out of stock count
    const outOfStock = await db
      .select({
        count: sql<number>`COUNT(*)`
      })
      .from(products)
      .where(eq(products.stock, 0));

    // Get top moving products
    const topMoving = await db
      .select({
        product: products.name,
        sold: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`.as('sold'),
        remaining: products.stock
      })
      .from(products)
      .leftJoin(orderItems, eq(products.id, orderItems.productId))
      .leftJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate} OR ${orders.createdAt} IS NULL`
      )
      .groupBy(products.id, products.name, products.stock)
      .orderBy(sql`COALESCE(SUM(${orderItems.quantity}), 0) DESC`)
      .limit(10);

    return {
      totalValue: stockValue[0]?.total || 0,
      lowStock: lowStock[0]?.count || 0,
      outOfStock: outOfStock[0]?.count || 0,
      turnoverRate: 0, // Would need more calculation
      topMoving
    };
  }

  async generateCSVReport(data: any, type: string): Promise<string> {
    let csv = '';
    
    switch (type) {
      case 'revenue':
        csv = 'Date,Revenue,Orders\n';
        data.revenue.byDay.forEach((day: any) => {
          csv += `${day.date},${day.revenue},${day.orders}\n`;
        });
        break;
        
      case 'orders':
        csv = 'Product,Quantity,Revenue\n';
        data.orders.topProducts.forEach((product: any) => {
          csv += `${product.name},${product.quantity},${product.revenue}\n`;
        });
        break;
        
      case 'customers':
        csv = 'Customer,Orders,Revenue,Loyalty Points\n';
        data.customers.topCustomers.forEach((customer: any) => {
          csv += `${customer.name},${customer.orders},${customer.revenue},${customer.loyalty}\n`;
        });
        break;
        
      case 'inventory':
        csv = 'Product,Sold,Remaining\n';
        data.inventory.topMoving.forEach((item: any) => {
          csv += `${item.product},${item.sold},${item.remaining}\n`;
        });
        break;
        
      case 'full':
        // Generate comprehensive report
        csv = 'FULL REPORT\n\n';
        csv += 'REVENUE SUMMARY\n';
        csv += `Total Revenue,${data.revenue.total}\n\n`;
        csv += 'Daily Revenue\n';
        csv += 'Date,Revenue,Orders\n';
        data.revenue.byDay.forEach((day: any) => {
          csv += `${day.date},${day.revenue},${day.orders}\n`;
        });
        csv += '\n';
        break;
    }
    
    return csv;
  }

  async generatePDFReport(data: any, type: string): Promise<Buffer> {
    // For now, return a simple buffer with CSV content
    // In production, you would use Puppeteer to generate actual PDF
    const csvContent = await this.generateCSVReport(data, type);
    return Buffer.from(csvContent);
  }

  async getLocations(): Promise<Location[]> {
    // Fetch locations with stats
    const locs = await db
      .select()
      .from(locations)
      .orderBy(desc(locations.isDefault), locations.name);

    // For each location, calculate stats
    const locationsWithStats = await Promise.all(
      locs.map(async (location) => {
        // Get revenue and order stats
        const stats = await db
          .select({
            totalRevenue: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`,
            totalOrders: sql<number>`COUNT(*)`,
          })
          .from(orders)
          .where(eq(orders.locationId, location.id));

        // Get product count
        const productCount = await db
          .select({
            count: sql<number>`COUNT(*)`,
          })
          .from(products)
          .where(eq(products.locationId, location.id));

        return {
          ...location,
          isActive: location.isActive === 1,
          isDefault: location.isDefault === 1,
          stats: {
            totalRevenue: stats[0]?.totalRevenue || 0,
            totalOrders: stats[0]?.totalOrders || 0,
            totalProducts: productCount[0]?.count || 0,
            activeStaff: 0, // Would need staff table
          },
        };
      })
    );

    return locationsWithStats;
  }

  async createLocation(data: any): Promise<Location> {
    // If this is the first location, make it default
    const existingCount = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(locations);

    const isFirst = existingCount[0].count === 0;

    const [location] = await db
      .insert(locations)
      .values({
        ...data,
        isActive: data.isActive ? 1 : 0,
        isDefault: isFirst ? 1 : 0,
      })
      .returning();

    return location;
  }

  async updateLocation(id: string, data: any): Promise<Location> {
    const [location] = await db
      .update(locations)
      .set({
        ...data,
        isActive: data.isActive ? 1 : 0,
        updatedAt: new Date(),
      })
      .where(eq(locations.id, id))
      .returning();

    return location;
  }

  async deleteLocation(id: string): Promise<void> {
    // Check if it's the default location
    const [location] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, id));

    if (location?.isDefault === 1) {
      throw new Error("Cannot delete default location");
    }

    await db.delete(locations).where(eq(locations.id, id));
  }

  async setDefaultLocation(id: string): Promise<Location> {
    await db.transaction(async (tx) => {
      // Remove default from all locations
      await tx
        .update(locations)
        .set({ isDefault: 0 })
        .where(eq(locations.isDefault, 1));

      // Set new default
      await tx
        .update(locations)
        .set({ isDefault: 1 })
        .where(eq(locations.id, id));
    });

    const [location] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, id));

    return location;
  }

  // Loyalty tier methods
  async getLoyaltyTiers(): Promise<LoyaltyTier[]> {
    return await db
      .select()
      .from(loyaltyTiers)
      .orderBy(loyaltyTiers.pointsRequired);
  }

  async createLoyaltyTier(data: InsertLoyaltyTier): Promise<LoyaltyTier> {
    const [tier] = await db
      .insert(loyaltyTiers)
      .values(data)
      .returning();
    return tier;
  }

  async updateLoyaltyTier(id: string, data: Partial<InsertLoyaltyTier>): Promise<LoyaltyTier> {
    const [tier] = await db
      .update(loyaltyTiers)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(loyaltyTiers.id, id))
      .returning();
    return tier;
  }

  async deleteLoyaltyTier(id: string): Promise<void> {
    await db.delete(loyaltyTiers).where(eq(loyaltyTiers.id, id));
  }

  async updateCustomerTier(customerId: string): Promise<Customer> {
    // Get customer's current points
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, customerId));

    if (!customer) {
      throw new Error("Customer not found");
    }

    // Find appropriate tier based on points
    const tiers = await db
      .select()
      .from(loyaltyTiers)
      .orderBy(desc(loyaltyTiers.pointsRequired));

    const appropriateTier = tiers.find(
      tier => (customer.loyaltyPoints ?? 0) >= tier.pointsRequired
    );

    if (appropriateTier && appropriateTier.id !== customer.tierId) {
      // Update customer's tier
      const [updated] = await db
        .update(customers)
        .set({
          tierId: appropriateTier.id,
          category: appropriateTier.name,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId))
        .returning();
      return updated;
    }

    return customer;
  }

  // Expense methods
  async getOverheadExpenses(): Promise<any[]> {
    const result = await db.select().from(overheadExpenses).orderBy(overheadExpenses.createdAt);
    return result;
  }

  async createOverheadExpense(data: any): Promise<any> {
    const [expense] = await db.insert(overheadExpenses).values(data).returning();
    return expense;
  }

  async updateOverheadExpense(id: string, data: any): Promise<any> {
    const [expense] = await db
      .update(overheadExpenses)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(overheadExpenses.id, id))
      .returning();
    return expense;
  }

  async deleteOverheadExpense(id: string): Promise<void> {
    await db.delete(overheadExpenses).where(eq(overheadExpenses.id, id));
  }

  async getOrderExpenses(orderId: string): Promise<any[]> {
    const result = await db
      .select()
      .from(orderExpenses)
      .where(eq(orderExpenses.orderId, orderId));
    return result;
  }

  async createOrderExpenses(orderId: string, expenses: any[]): Promise<void> {
    if (expenses && expenses.length > 0) {
      const expensesWithOrderId = expenses.map(exp => ({
        ...exp,
        orderId
      }));
      await db.insert(orderExpenses).values(expensesWithOrderId);
    }
  }

  async getExpenseReport(startDate: Date, endDate: Date): Promise<any> {
    // Get expense analytics first
    const analytics = await this.getExpenseAnalytics(startDate, endDate);
    
    // Get detailed overhead expenses by category
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const overheadByCategory = await db
      .select({
        category: overheadExpenses.category,
        total: sql<number>`SUM(CASE 
          WHEN ${overheadExpenses.frequency} = 'daily' THEN CAST(${overheadExpenses.amount} AS DECIMAL) * ${daysDiff.toString()}
          WHEN ${overheadExpenses.frequency} = 'weekly' THEN CAST(${overheadExpenses.amount} AS DECIMAL) / 7 * ${daysDiff.toString()}
          WHEN ${overheadExpenses.frequency} = 'monthly' THEN CAST(${overheadExpenses.amount} AS DECIMAL) / 30 * ${daysDiff.toString()}
          WHEN ${overheadExpenses.frequency} = 'yearly' THEN CAST(${overheadExpenses.amount} AS DECIMAL) / 365 * ${daysDiff.toString()}
          ELSE 0
        END)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(overheadExpenses)
      .where(
        and(
          lte(overheadExpenses.startDate, endDate),
          eq(overheadExpenses.isActive, 1),
          or(
            isNull(overheadExpenses.endDate),
            gte(overheadExpenses.endDate, startDate)
          )
        )
      )
      .groupBy(overheadExpenses.category);
    
    // Get order expenses by category
    const orderExpensesByCategory = await db
      .select({
        category: orderExpenses.category,
        total: sql<number>`SUM(CAST(${orderExpenses.amount} AS DECIMAL))`,
        count: sql<number>`COUNT(*)`,
      })
      .from(orderExpenses)
      .innerJoin(orders, eq(orderExpenses.orderId, orders.id))
      .where(between(orders.createdAt, startDate, endDate))
      .groupBy(orderExpenses.category);
    
    // Get daily expense trends
    const dailyTrends = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`,
        orderExpenses: sql<number>`COALESCE(SUM(CAST(${orderExpenses.amount} AS DECIMAL)), 0)`,
      })
      .from(orders)
      .leftJoin(orderExpenses, eq(orderExpenses.orderId, orders.id))
      .where(between(orders.createdAt, startDate, endDate))
      .groupBy(sql`DATE(${orders.createdAt})`);
    
    // Add daily overhead to trends  
    const enhancedTrends = dailyTrends.map(day => ({
      ...day,
      overhead: analytics.dailyOverhead,
      total: parseFloat(day.orderExpenses.toString()) + analytics.dailyOverhead,
    }));
    
    return {
      summary: analytics,
      overheadByCategory: overheadByCategory.map(cat => ({
        ...cat,
        percentage: (cat.total / analytics.overheadTotal) * 100,
      })),
      orderExpensesByCategory: orderExpensesByCategory.map(cat => ({
        ...cat,
        percentage: (cat.total / analytics.orderExpenseTotal) * 100,
      })),
      dailyTrends: enhancedTrends,
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days: daysDiff,
      },
    };
  }

  async getProfitAnalysis(startDate: Date, endDate: Date): Promise<any> {
    // Get revenue data
    const revenueData = await db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(
        and(
          between(orders.createdAt, startDate, endDate),
          eq(orders.status, 'completed')
        )
      );
    
    const totalRevenue = revenueData[0]?.totalRevenue || 0;
    const orderCount = revenueData[0]?.orderCount || 0;
    
    // Get COGS (Cost of Goods Sold)
    const cogsData = await db
      .select({
        totalCOGS: sql<number>`COALESCE(SUM(CAST(${orderItems.quantity} AS INTEGER) * CAST(${products.costPrice} AS DECIMAL)), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(
        and(
          between(orders.createdAt, startDate, endDate),
          eq(orders.status, 'completed')
        )
      );
    
    const totalCOGS = cogsData[0]?.totalCOGS || 0;
    
    // Get expenses
    const expenses = await this.getExpenseAnalytics(startDate, endDate);
    
    // Calculate profit margins
    const grossProfit = totalRevenue - totalCOGS;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    
    const operatingProfit = grossProfit - expenses.totalExpenses;
    const operatingMargin = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;
    
    const netProfit = operatingProfit; // Could subtract taxes here if tracked
    const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    
    // Get daily profit trends
    const dailyProfits = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`,
        revenue: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(
        and(
          between(orders.createdAt, startDate, endDate),
          eq(orders.status, 'completed')
        )
      )
      .groupBy(sql`DATE(${orders.createdAt})`);
    
    // Get daily COGS for the profit trends
    const dailyCOGS = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`,
        cogs: sql<number>`COALESCE(SUM(CAST(${orderItems.quantity} AS INTEGER) * CAST(${products.costPrice} AS DECIMAL)), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(
        and(
          between(orders.createdAt, startDate, endDate),
          eq(orders.status, 'completed')
        )
      )
      .groupBy(sql`DATE(${orders.createdAt})`);
    
    // Combine daily data
    const profitTrends = dailyProfits.map(day => {
      const dailyCog = dailyCOGS.find(c => c.date === day.date)?.cogs || 0;
      const revenue = typeof day.revenue === 'number' ? day.revenue : parseFloat(day.revenue.toString());
      const dailyGrossProfit = revenue - (typeof dailyCog === 'number' ? dailyCog : parseFloat(dailyCog.toString()));
      const dailyNetProfit = dailyGrossProfit - expenses.dailyOverhead;
      
      return {
        date: day.date,
        revenue: revenue,
        cogs: typeof dailyCog === 'number' ? dailyCog : parseFloat(dailyCog.toString()),
        grossProfit: dailyGrossProfit,
        expenses: expenses.dailyOverhead,
        netProfit: dailyNetProfit,
        grossMargin: revenue > 0 ? (dailyGrossProfit / revenue) * 100 : 0,
        netMargin: revenue > 0 ? (dailyNetProfit / revenue) * 100 : 0,
      };
    });
    
    // Calculate average order value
    const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;
    
    return {
      summary: {
        revenue: totalRevenue,
        cogs: totalCOGS,
        grossProfit,
        grossMargin,
        operatingExpenses: expenses.totalExpenses,
        operatingProfit,
        operatingMargin,
        netProfit,
        netMargin,
        orderCount,
        averageOrderValue,
      },
      expenses: {
        overhead: expenses.overheadTotal,
        orderExpenses: expenses.orderExpenseTotal,
        total: expenses.totalExpenses,
        dailyOverhead: expenses.dailyOverhead,
      },
      dailyTrends: profitTrends,
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
      },
    };
  }

  async getExpenseAnalytics(startDate: Date, endDate: Date): Promise<any> {
    // Get overhead expenses for the period
    const overheads = await db
      .select({
        name: overheadExpenses.name,
        category: overheadExpenses.category,
        amount: sql<number>`CAST(${overheadExpenses.amount} AS DECIMAL)`,
        frequency: overheadExpenses.frequency,
      })
      .from(overheadExpenses)
      .where(
        and(
          lte(overheadExpenses.startDate, endDate),
          eq(overheadExpenses.isActive, 1),
          or(
            isNull(overheadExpenses.endDate),
            gte(overheadExpenses.endDate, startDate)
          )
        )
      );
    
    // Calculate total daily overhead
    let totalDailyOverhead = 0;
    overheads.forEach(expense => {
      let dailyCost = 0;
      switch (expense.frequency) {
        case 'daily': dailyCost = expense.amount; break;
        case 'weekly': dailyCost = expense.amount / 7; break;
        case 'monthly': dailyCost = expense.amount / 30; break;
        case 'yearly': dailyCost = expense.amount / 365; break;
      }
      totalDailyOverhead += dailyCost;
    });
    
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const totalOverhead = totalDailyOverhead * daysDiff;
    
    // Get order expenses
    const orderExpenseResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(CAST(${orderExpenses.amount} AS DECIMAL)), 0)`,
      })
      .from(orderExpenses)
      .innerJoin(orders, eq(orderExpenses.orderId, orders.id))
      .where(between(orders.createdAt, startDate, endDate));
    
    const orderExpenseTotal = orderExpenseResult[0]?.total || 0;
    
    return {
      overheadTotal: totalOverhead,
      orderExpenseTotal,
      totalExpenses: totalOverhead + orderExpenseTotal,
      dailyOverhead: totalDailyOverhead,
      overheadBreakdown: overheads,
    };
  }

  // Promotions methods
  async getPromotions(active?: boolean): Promise<Promotion[]> {
    let query = db.select().from(promotions);
    
    if (active !== undefined) {
      query = query.where(eq(promotions.isActive, active ? 1 : 0));
    }
    
    return await query.orderBy(desc(promotions.createdAt));
  }

  async createPromotion(data: InsertPromotion): Promise<Promotion> {
    const [promo] = await db
      .insert(promotions)
      .values({
        ...data,
        isActive: data.isActive ?? 1,
      })
      .returning();
    return promo;
  }

  async updatePromotion(id: string, data: Partial<InsertPromotion>): Promise<Promotion> {
    const [promo] = await db
      .update(promotions)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(promotions.id, id))
      .returning();
    return promo;
  }

  async deletePromotion(id: string): Promise<void> {
    await db.delete(promotions).where(eq(promotions.id, id));
  }

  async validatePromoCode(code: string): Promise<Promotion | null> {
    const now = new Date();
    
    const [promo] = await db
      .select()
      .from(promotions)
      .where(
        sql`${promotions.code} = ${code} 
        AND ${promotions.isActive} = 1
        AND ${promotions.startDate} <= ${now}
        AND ${promotions.endDate} >= ${now}
        AND (${promotions.usageLimit} IS NULL OR ${promotions.usageCount} < ${promotions.usageLimit})`
      );
    
    return promo || null;
  }

  async applyPromotion(orderId: string, promoCode: string): Promise<number> {
    const promo = await this.validatePromoCode(promoCode);
    if (!promo) {
      throw new Error("Invalid or expired promo code");
    }

    // Get order details
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));

    if (!order) {
      throw new Error("Order not found");
    }

    let discount = 0;
    const orderTotal = parseFloat(order.total);

    // Check minimum purchase requirement
    if (promo.minPurchase && orderTotal < parseFloat(promo.minPurchase)) {
      throw new Error(`Minimum purchase of ${promo.minPurchase} required`);
    }

    // Calculate discount based on promo type
    if (promo.type === 'percentage') {
      discount = orderTotal * (parseFloat(promo.value) / 100);
      if (promo.maxDiscount) {
        discount = Math.min(discount, parseFloat(promo.maxDiscount));
      }
    } else if (promo.type === 'fixed') {
      discount = parseFloat(promo.value);
    } else if (promo.type === 'points') {
      // Award bonus points (handled elsewhere)
      discount = 0;
    }

    // Update promo usage count
    await db
      .update(promotions)
      .set({
        usageCount: sql`${promotions.usageCount} + 1`,
      })
      .where(eq(promotions.id, promo.id));

    return discount;
  }
}

export const storage = new DatabaseStorage();
