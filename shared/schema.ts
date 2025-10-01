import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  uuid,
  integer,
  numeric,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Locations table
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  address: varchar("address", { length: 500 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  zipCode: varchar("zip_code", { length: 10 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  isActive: integer("is_active").default(1).notNull(),
  isDefault: integer("is_default").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Location = typeof locations.$inferSelect;
export type InsertLocation = typeof locations.$inferInsert;

// Session storage table (mandatory for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table (mandatory for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Loyalty tiers table
export const loyaltyTiers = pgTable("loyalty_tiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  pointsRequired: integer("points_required").notNull(),
  discountPercentage: numeric("discount_percentage", { precision: 5, scale: 2 }).default("0"),
  pointsMultiplier: numeric("points_multiplier", { precision: 3, scale: 2 }).default("1.00"),
  color: varchar("color", { length: 7 }).default("#808080"),
  benefits: varchar("benefits", { length: 1024 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type LoyaltyTier = typeof loyaltyTiers.$inferSelect;
export type InsertLoyaltyTier = typeof loyaltyTiers.$inferInsert;
export const insertLoyaltyTierSchema = createInsertSchema(loyaltyTiers).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertLoyaltyTierData = z.infer<typeof insertLoyaltyTierSchema>;

// Promotions/campaigns table
export const promotions = pgTable("promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).unique(),
  type: varchar("type", { length: 20 }).notNull(), // percentage, fixed, bogo, points
  value: numeric("value", { precision: 10, scale: 2 }).notNull(),
  minPurchase: numeric("min_purchase", { precision: 10, scale: 2 }),
  maxDiscount: numeric("max_discount", { precision: 10, scale: 2 }),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  isActive: integer("is_active").default(1).notNull(),
  usageLimit: integer("usage_limit"),
  usageCount: integer("usage_count").default(0),
  tierRequired: uuid("tier_required").references(() => loyaltyTiers.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Promotion = typeof promotions.$inferSelect;
export type InsertPromotion = typeof promotions.$inferInsert;
export const insertPromotionSchema = createInsertSchema(promotions).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  usageCount: true 
});
export type InsertPromotionData = z.infer<typeof insertPromotionSchema>;

// Customers table
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  address: varchar("address", { length: 1024 }),
  category: varchar("category", { length: 20 }).default("Bronze"),
  loyaltyPoints: integer("loyalty_points").default(0),
  tierId: uuid("tier_id").references(() => loyaltyTiers.id),
  totalSpent: numeric("total_spent", { precision: 12, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;
export const insertCustomerSchema = createInsertSchema(customers).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  loyaltyPoints: true,
  totalSpent: true
});
export type InsertCustomerData = z.infer<typeof insertCustomerSchema>;

// Products table
export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  productId: varchar("product_id", { length: 100 }).notNull().unique(),
  locationId: uuid("location_id").references(() => locations.id),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }),
  defaultSalePrice: numeric("default_sale_price", {
    precision: 10,
    scale: 2,
  }).notNull(),
  stock: integer("stock").default(0),
  stockLimit: integer("stock_limit").default(10),
  barcode: varchar("barcode", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;
export const insertProductSchema = createInsertSchema(products).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  stock: true
});
export type InsertProductData = z.infer<typeof insertProductSchema>;

// Orders table
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => customers.id),
  locationId: uuid("location_id").references(() => locations.id),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;
export const insertOrderSchema = createInsertSchema(orders).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  status: true
});
export type InsertOrderData = z.infer<typeof insertOrderSchema>;

// Order items table
export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id),
  productId: uuid("product_id").references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// Analytics tables
export const analyticsDaily = pgTable("analytics_daily", {
  date: date("date").primaryKey(),
  totalOrders: integer("total_orders").default(0),
  totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).default(
    "0"
  ),
});

export const analyticsWeekly = pgTable(
  "analytics_weekly",
  {
    year: integer("year").notNull(),
    week: integer("week").notNull(),
    totalOrders: integer("total_orders").default(0),
    totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).default(
      "0"
    ),
  },
  (t) => ({ pk: primaryKey({ columns: [t.year, t.week] }) })
);

export const analyticsMonthly = pgTable(
  "analytics_monthly",
  {
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    totalOrders: integer("total_orders").default(0),
    totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).default(
      "0"
    ),
  },
  (t) => ({ pk: primaryKey({ columns: [t.year, t.month] }) })
);

export const customerMetrics = pgTable("customer_metrics", {
  customerId: uuid("customer_id").primaryKey(),
  lastOrderDate: date("last_order_date"),
  totalSpent: numeric("total_spent", { precision: 12, scale: 2 }).default("0"),
  orderCount: integer("order_count").default(0),
  rfmScore: integer("rfm_score"),
  clv: numeric("clv", { precision: 12, scale: 2 }),
});

export type CustomerMetric = typeof customerMetrics.$inferSelect;

// Relations
export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
  metrics: many(customerMetrics),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const customerMetricsRelations = relations(customerMetrics, ({ one }) => ({
  customer: one(customers, {
    fields: [customerMetrics.customerId],
    references: [customers.id],
  }),
}));
