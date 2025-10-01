import {
  users,
  customers,
  customerMetrics,
  analyticsDaily,
  analyticsMonthly,
  products,
  orders,
  orderItems,
  type User,
  type UpsertUser,
  type Customer,
  type CustomerMetric,
  type Product,
  type Order,
  type OrderItem,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";

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
        : currentProduct.stock + adjustment;

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
        total: sql<number>`COALESCE(SUM(CAST(${orders.totalAmount} AS DECIMAL)), 0)`
      })
      .from(orders)
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      );

    // Get daily revenue
    const dailyRevenue = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`.as('date'),
        revenue: sql<number>`SUM(CAST(${orders.totalAmount} AS DECIMAL))`.as('revenue'),
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
        revenue: sql<number>`SUM(CAST(${orders.totalAmount} AS DECIMAL))`.as('revenue')
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
        average: sql<number>`AVG(CAST(${orders.totalAmount} AS DECIMAL))`
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
        count: sql<number>`COUNT(DISTINCT c.id)`
      })
      .from(customers.as('c'))
      .where(
        sql`c.created_at >= ${fromDate} AND c.created_at <= ${toDate}`
      );

    // Get top customers
    const topCustomers = await db
      .select({
        name: customers.name,
        orders: sql<number>`COUNT(${orders.id})`.as('orders'),
        revenue: sql<number>`SUM(CAST(${orders.totalAmount} AS DECIMAL))`.as('revenue'),
        loyalty: customers.loyaltyPoints
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(
        sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`
      )
      .groupBy(customers.id, customers.name, customers.loyaltyPoints)
      .orderBy(sql`SUM(CAST(${orders.totalAmount} AS DECIMAL)) DESC`)
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
}

export const storage = new DatabaseStorage();
