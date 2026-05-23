/** Drizzle schema (simplified) - must stay in sync with shared/schema for org-scoped columns */
import { pgTable, uuid, varchar, integer, timestamp, numeric, jsonb, boolean, date } from 'drizzle-orm/pg-core'

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  org_id: uuid('org_id').references(() => organizations.id),
  name: varchar('name',{length:255}).notNull(),
  phone: varchar('phone',{length:20}),
  email: varchar('email',{length:255}),
  address: varchar('address',{length:1024}),
  category: varchar('category',{length:64}).default('Bronze'),
  manual_override_protected: integer('manual_override_protected').default(0).notNull(),
  loyalty_points: integer('loyalty_points').default(0),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  org_id: uuid('org_id').references(() => organizations.id),
  name: varchar('name',{length:255}).notNull(),
  product_id: varchar('product_id',{length:100}).notNull().unique(), // SKU
  cost_price: numeric('cost_price', { precision: 10, scale: 2 }),
  default_sale_price: numeric('default_sale_price',{precision:10,scale:2}).notNull(),
  stock: integer('stock').default(0),
  stock_limit: integer('stock_limit').default(10),
  barcode: varchar('barcode',{length:255}),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  org_id: uuid('org_id').references(() => organizations.id),
  location_id: uuid('location_id'),
  customer_id: uuid('customer_id').references(()=>customers.id),
  total: numeric('total',{precision:10,scale:2}).notNull(),
  payment_method: varchar('payment_method',{length:50}).notNull(),
  status: varchar('status',{length:20}).default('pending'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const order_items = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  org_id: uuid('org_id').references(() => organizations.id),
  order_id: uuid('order_id').references(()=>orders.id),
  product_id: uuid('product_id').references(()=>products.id),
  quantity: integer('quantity').notNull(),
  unit_price: numeric('unit_price',{precision:10,scale:2}).notNull(),
  total_price: numeric('total_price',{precision:10,scale:2}).notNull(),
  created_at: timestamp('created_at').defaultNow(),
})

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  order_id: uuid('order_id').references(()=>orders.id),
  customer_id: uuid('customer_id').references(()=>customers.id),
  invoice_number: varchar('invoice_number',{length:50}).notNull().unique(),
  subtotal: numeric('subtotal',{precision:10,scale:2}).notNull(),
  tax: numeric('tax',{precision:10,scale:2}).default('0'),
  total: numeric('total',{precision:10,scale:2}).notNull(),
  status: varchar('status',{length:20}).default('sent'),
  due_date: date('due_date'),
  google_drive_file_id: varchar('google_drive_file_id',{length:255}),
  google_drive_link: varchar('google_drive_link',{length:1024}),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const audit_logs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: varchar('user_id',{length:100}).notNull(),
  user_role: varchar('user_role',{length:50}),
  action: varchar('action',{length:100}).notNull(),
  entity_type: varchar('entity_type',{length:50}).notNull(),
  entity_id: varchar('entity_id',{length:100}),
  entity_name: varchar('entity_name',{length:255}),
  old_values: jsonb('old_values'),
  new_values: jsonb('new_values'),
  ip_address: varchar('ip_address',{length:45}),
  user_agent: varchar('user_agent',{length:1024}),
  session_id: varchar('session_id',{length:255}),
  success: boolean('success').default(true),
  error_message: varchar('error_message',{length:1024}),
  metadata: jsonb('metadata'),
  created_at: timestamp('created_at').defaultNow(),
})

export const domain_outbox = pgTable('domain_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  org_id: uuid('org_id'),
  type: varchar('type', { length: 128 }).notNull(),
  data: jsonb('data'),
  event_type: varchar('event_type', { length: 128 }),
  aggregate_type: varchar('aggregate_type', { length: 128 }),
  aggregate_id: varchar('aggregate_id', { length: 255 }),
  payload: jsonb('payload').notNull(),
  created_at: timestamp('created_at').defaultNow(),
  processed_at: timestamp('processed_at'),
})


/* === Analytics Tables === */
import { sql } from 'drizzle-orm'
import { primaryKey } from 'drizzle-orm/pg-core'

export const analytics_daily = pgTable('analytics_daily', {
  date: date('date').primaryKey(),
  total_orders: integer('total_orders').default(0),
  total_revenue: numeric('total_revenue',{precision:12,scale:2}).default('0'),
})

export const analytics_weekly = pgTable('analytics_weekly', {
  year: integer('year').notNull(),
  week: integer('week').notNull(),
  total_orders: integer('total_orders').default(0),
  total_revenue: numeric('total_revenue',{precision:12,scale:2}).default('0'),
}, (t) => ({ pk: primaryKey({ columns:[t.year,t.week] }) }))

export const analytics_monthly = pgTable('analytics_monthly', {
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  total_orders: integer('total_orders').default(0),
  total_revenue: numeric('total_revenue',{precision:12,scale:2}).default('0'),
}, (t) => ({ pk: primaryKey({ columns:[t.year,t.month] }) }))

export const customer_metrics = pgTable('customer_metrics', {
  customer_id: uuid('customer_id').primaryKey(),
  last_order_date: date('last_order_date'),
  total_spent: numeric('total_spent',{precision:12,scale:2}).default('0'),
  order_count: integer('order_count').default(0),
  rfm_score: integer('rfm_score'),
  clv: numeric('clv',{precision:12,scale:2}),
})