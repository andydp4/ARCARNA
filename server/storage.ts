import {
  users,
  customers,
  customerMetrics,
  analyticsDaily,
  analyticsMonthly,
  type User,
  type UpsertUser,
  type Customer,
  type CustomerMetric,
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
}

export const storage = new DatabaseStorage();
