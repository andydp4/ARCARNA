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
}

export const storage = new DatabaseStorage();
