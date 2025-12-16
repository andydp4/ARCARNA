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

// Order status enum
export const ORDER_STATUSES = ['pending', 'on-hold', 'awaiting-customer', 'urgent', 'completed'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

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

// Order status update schema
export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES)
});
export type UpdateOrderStatus = z.infer<typeof updateOrderStatusSchema>;

// Overhead expenses table (general business costs)
export const overheadExpenses = pgTable("overhead_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(), // rent, utilities, insurance, salaries, etc.
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  frequency: varchar("frequency", { length: 20 }).notNull(), // daily, weekly, monthly, yearly
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  isActive: integer("is_active").default(1).notNull(),
  description: varchar("description", { length: 1024 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type OverheadExpense = typeof overheadExpenses.$inferSelect;
export type InsertOverheadExpense = typeof overheadExpenses.$inferInsert;
export const insertOverheadExpenseSchema = createInsertSchema(overheadExpenses).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
}).extend({
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional()
});
export type InsertOverheadExpenseData = z.infer<typeof insertOverheadExpenseSchema>;

// Order expenses table (order-specific costs)
export const orderExpenses = pgTable("order_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id).notNull(),
  category: varchar("category", { length: 100 }).notNull(), // travel, shipping, packaging, other
  description: varchar("description", { length: 500 }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OrderExpense = typeof orderExpenses.$inferSelect;
export type InsertOrderExpense = typeof orderExpenses.$inferInsert;
export const insertOrderExpenseSchema = createInsertSchema(orderExpenses).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertOrderExpenseData = z.infer<typeof insertOrderExpenseSchema>;

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
export const analyticsDaily = pgTable('analytics_daily', {
  date: date('date').primaryKey(),
  totalOrders: integer('total_orders').default(0),
  totalRevenue: numeric('total_revenue', { precision: 12, scale: 2 }).default('0'),
}, (table) => ({
  dateIdx: index('analytics_daily_date_idx').on(table.date),
}));

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

export const customerMetrics = pgTable('customer_metrics', {
  customerId: uuid('customer_id').primaryKey(),
  lastOrderDate: date('last_order_date'),
  totalSpent: numeric('total_spent', { precision: 12, scale: 2 }).default('0'),
  orderCount: integer('order_count').default(0),
  rfmScore: integer('rfm_score'),
  clv: numeric('clv', { precision: 12, scale: 2 }),
}, (table) => ({
  clvIdx: index('customer_metrics_clv_idx').on(table.clv),
  lastOrderIdx: index('customer_metrics_last_order_idx').on(table.lastOrderDate),
}));

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

// Allowed users table - users who can access the system
export const allowedUsers = pgTable("allowed_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  replitUserId: varchar("replit_user_id", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  name: varchar("name", { length: 255 }),
  isOwner: integer("is_owner").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AllowedUser = typeof allowedUsers.$inferSelect;
export type InsertAllowedUser = typeof allowedUsers.$inferInsert;
export const insertAllowedUserSchema = createInsertSchema(allowedUsers).omit({
  id: true,
  createdAt: true,
});
export type InsertAllowedUserData = z.infer<typeof insertAllowedUserSchema>;

// User approval requests - pending users waiting for approval
export const userApprovalRequests = pgTable("user_approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  replitUserId: varchar("replit_user_id", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  name: varchar("name", { length: 255 }),
  profileImageUrl: varchar("profile_image_url", { length: 500 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending, approved, rejected
  requestedAt: timestamp("requested_at").defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by", { length: 255 }),
});

export type UserApprovalRequest = typeof userApprovalRequests.$inferSelect;
export type InsertUserApprovalRequest = typeof userApprovalRequests.$inferInsert;
export const insertUserApprovalRequestSchema = createInsertSchema(userApprovalRequests).omit({
  id: true,
  requestedAt: true,
  reviewedAt: true,
  reviewedBy: true,
});
export type InsertUserApprovalRequestData = z.infer<typeof insertUserApprovalRequestSchema>;

// ==================== EVENT-DRIVEN SYNC SYSTEM ====================

// Event types for the system
export const EVENT_TYPES = [
  'OrderCreated',
  'OrderUpdated', 
  'OrderStatusChanged',
  'PaymentCaptured',
  'RefundIssued',
  'OrderCancelled',
  'ExpenseLogged',
  'ExpenseUpdated',
  'ExpenseDeleted'
] as const;
export type EventType = typeof EVENT_TYPES[number];

// Worker names
export const WORKER_NAMES = [
  'InventoryWorker',
  'CustomerWorker',
  'InvoiceWorker',
  'LoyaltyWorker',
  'BusinessInsightsWorker',
  'FinanceWorker',
  'ExpensesWorker'
] as const;
export type WorkerName = typeof WORKER_NAMES[number];

// Job statuses
export const JOB_STATUSES = ['queued', 'running', 'success', 'failed', 'dead_letter'] as const;
export type JobStatus = typeof JOB_STATUSES[number];

// Worker result statuses
export const WORKER_RESULT_STATUSES = ['success', 'failed', 'already_processed', 'retrying'] as const;
export type WorkerResultStatus = typeof WORKER_RESULT_STATUSES[number];

// Event Outbox - stores events before dispatch
export const eventOutbox = pgTable("event_outbox", {
  eventId: varchar("event_id", { length: 36 }).primaryKey(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  correlationId: varchar("correlation_id", { length: 100 }).notNull(),
  actor: jsonb("actor").$type<{ type: 'user' | 'system'; id: string }>(),
  source: varchar("source", { length: 100 }),
  version: integer("version").notNull().default(1),
  payload: jsonb("payload").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, dispatched
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("event_outbox_status_occurred_idx").on(table.status, table.occurredAt),
  index("event_outbox_correlation_idx").on(table.correlationId),
]);

export type EventOutbox = typeof eventOutbox.$inferSelect;
export type InsertEventOutbox = typeof eventOutbox.$inferInsert;

// Job Queue - fan-out deliveries to workers
export const jobQueue = pgTable("job_queue", {
  jobId: varchar("job_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id", { length: 36 }).notNull().references(() => eventOutbox.eventId),
  workerName: varchar("worker_name", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(10),
  runAt: timestamp("run_at").notNull().defaultNow(),
  lockedAt: timestamp("locked_at"),
  lockedBy: varchar("locked_by", { length: 100 }),
  lastError: varchar("last_error", { length: 2000 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("job_queue_status_run_at_idx").on(table.status, table.runAt),
  index("job_queue_event_worker_idx").on(table.eventId, table.workerName),
]);

export type JobQueue = typeof jobQueue.$inferSelect;
export type InsertJobQueue = typeof jobQueue.$inferInsert;

// Processed Events - worker idempotency tracking
export const processedEvents = pgTable("processed_events", {
  eventId: varchar("event_id", { length: 36 }).notNull(),
  workerName: varchar("worker_name", { length: 50 }).notNull(),
  processedAt: timestamp("processed_at").defaultNow(),
  resultSummary: varchar("result_summary", { length: 500 }),
}, (table) => [
  primaryKey({ columns: [table.eventId, table.workerName] }),
]);

export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type InsertProcessedEvent = typeof processedEvents.$inferInsert;

// Worker Run Logs - UI display table
export const workerRunLogs = pgTable("worker_run_logs", {
  logId: varchar("log_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id", { length: 36 }).notNull(),
  correlationId: varchar("correlation_id", { length: 100 }).notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  workerName: varchar("worker_name", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  attempt: integer("attempt").notNull().default(1),
  summary: varchar("summary", { length: 500 }),
  data: jsonb("data"),
  error: varchar("error", { length: 2000 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("worker_run_logs_event_idx").on(table.eventId),
  index("worker_run_logs_correlation_idx").on(table.correlationId),
  index("worker_run_logs_worker_status_idx").on(table.workerName, table.status),
  index("worker_run_logs_created_idx").on(table.createdAt),
]);

export type WorkerRunLog = typeof workerRunLogs.$inferSelect;
export type InsertWorkerRunLog = typeof workerRunLogs.$inferInsert;

// Dead Letters - permanently failed jobs
export const deadLetters = pgTable("dead_letters", {
  deadLetterId: varchar("dead_letter_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id", { length: 36 }).notNull(),
  eventId: varchar("event_id", { length: 36 }).notNull(),
  workerName: varchar("worker_name", { length: 50 }).notNull(),
  failedAt: timestamp("failed_at").defaultNow(),
  error: varchar("error", { length: 2000 }),
  payloadSnapshot: jsonb("payload_snapshot"),
}, (table) => [
  index("dead_letters_event_idx").on(table.eventId),
  index("dead_letters_worker_idx").on(table.workerName),
  index("dead_letters_failed_at_idx").on(table.failedAt),
]);

export type DeadLetter = typeof deadLetters.$inferSelect;
export type InsertDeadLetter = typeof deadLetters.$inferInsert;

// Inventory Movements - audit trail for stock changes
export const inventoryMovements = pgTable("inventory_movements", {
  movementId: varchar("movement_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  sku: varchar("sku", { length: 100 }).notNull(),
  productId: uuid("product_id").references(() => products.id),
  delta: integer("delta").notNull(), // negative for sale, positive for return
  reason: varchar("reason", { length: 50 }).notNull(), // sale, refund, adjustment, order_update
  correlationId: varchar("correlation_id", { length: 100 }).notNull(), // orderId
  eventId: varchar("event_id", { length: 36 }).notNull(),
  previousStock: integer("previous_stock"),
  newStock: integer("new_stock"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("inventory_movements_sku_idx").on(table.sku),
  index("inventory_movements_event_sku_idx").on(table.eventId, table.sku),
  index("inventory_movements_correlation_idx").on(table.correlationId),
]);

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type InsertInventoryMovement = typeof inventoryMovements.$inferInsert;

// Loyalty Ledger - audit trail for points changes
export const loyaltyLedger = pgTable("loyalty_ledger", {
  ledgerId: varchar("ledger_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  orderId: uuid("order_id").references(() => orders.id),
  eventId: varchar("event_id", { length: 36 }).notNull(),
  pointsDelta: integer("points_delta").notNull(),
  reason: varchar("reason", { length: 50 }).notNull(), // earn, reverse, adjust
  previousBalance: integer("previous_balance"),
  newBalance: integer("new_balance"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("loyalty_ledger_customer_idx").on(table.customerId),
  index("loyalty_ledger_event_customer_idx").on(table.eventId, table.customerId),
]);

export type LoyaltyLedger = typeof loyaltyLedger.$inferSelect;
export type InsertLoyaltyLedger = typeof loyaltyLedger.$inferInsert;

// Event Envelope type for runtime use
export type EventEnvelope<TPayload = unknown> = {
  eventId: string;
  eventType: EventType;
  occurredAt: string;
  correlationId: string;
  actor?: { type: 'user' | 'system'; id: string };
  source?: string;
  version: number;
  payload: TPayload;
};

// Worker Result type
export type WorkerResult = {
  worker: WorkerName;
  eventId: string;
  correlationId: string;
  status: WorkerResultStatus;
  summary: string;
  data?: Record<string, unknown>;
  error?: string;
};

// Required workers per event type configuration
export const REQUIRED_WORKERS: Record<EventType, WorkerName[]> = {
  OrderCreated: ['InventoryWorker', 'CustomerWorker', 'LoyaltyWorker', 'InvoiceWorker', 'BusinessInsightsWorker', 'FinanceWorker'],
  OrderUpdated: ['InventoryWorker', 'CustomerWorker', 'LoyaltyWorker', 'BusinessInsightsWorker', 'FinanceWorker'],
  OrderStatusChanged: ['CustomerWorker', 'BusinessInsightsWorker', 'FinanceWorker'],
  PaymentCaptured: ['InvoiceWorker', 'FinanceWorker'],
  RefundIssued: ['InventoryWorker', 'LoyaltyWorker', 'CustomerWorker', 'BusinessInsightsWorker', 'FinanceWorker'],
  OrderCancelled: ['InventoryWorker', 'LoyaltyWorker', 'CustomerWorker', 'BusinessInsightsWorker', 'FinanceWorker'],
  ExpenseLogged: ['ExpensesWorker', 'FinanceWorker', 'BusinessInsightsWorker'],
  ExpenseUpdated: ['ExpensesWorker', 'FinanceWorker', 'BusinessInsightsWorker'],
  ExpenseDeleted: ['ExpensesWorker', 'FinanceWorker', 'BusinessInsightsWorker'],
};