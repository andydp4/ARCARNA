/** Drizzle schema (simplified) - must stay in sync with shared/schema for org-scoped columns */
import { pgTable, uuid, varchar, integer, timestamp, numeric, jsonb, boolean, date, text } from 'drizzle-orm/pg-core'

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
  source: varchar('source', { length: 32 }),
  manual_override_protected: integer('manual_override_protected').default(0).notNull(),
  loyalty_points: integer('loyalty_points').default(0),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const website_uploaded_files = pgTable('website_uploaded_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  org_id: uuid('org_id').references(() => organizations.id).notNull(),
  provider: varchar('provider', { length: 32 }).default('local').notNull(),
  storage_key: varchar('storage_key', { length: 1024 }),
  public_url: varchar('public_url', { length: 2048 }).notNull(),
  file_name: varchar('file_name', { length: 255 }).notNull(),
  original_file_name: varchar('original_file_name', { length: 255 }),
  mime_type: varchar('mime_type', { length: 128 }).notNull(),
  byte_size: integer('byte_size').notNull(),
  width: integer('width'),
  height: integer('height'),
  alt_text: varchar('alt_text', { length: 255 }),
  status: varchar('status', { length: 32 }).default('available').notNull(),
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
  // Must match shared/schema.ts: these are the same physical columns, and
  // drizzle's integer mapper runs parseInt on what numeric returns, so a
  // declaration left as integer reads 0.400 as 0.
  stock: numeric('stock', { precision: 14, scale: 3, mode: 'number' }).default(0),
  stock_limit: numeric('stock_limit', { precision: 14, scale: 3, mode: 'number' }).default(10),
  barcode: varchar('barcode',{length:255}),
  available_for_website: boolean('available_for_website').default(false).notNull(),
  website_title: varchar('website_title', { length: 255 }),
  website_description: text('website_description'),
  website_category: varchar('website_category', { length: 120 }),
  website_unit_label: varchar('website_unit_label', { length: 120 }),
  website_sort_order: integer('website_sort_order').default(0).notNull(),
  website_image_file_id: uuid('website_image_file_id').references(() => website_uploaded_files.id),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  org_id: uuid('org_id').references(() => organizations.id),
  location_id: uuid('location_id'),
  shift_id: uuid('shift_id'),
  cashier_id: uuid('cashier_id'),
  cashier_shift_id: uuid('cashier_shift_id'),
  // Commission splits 90/10 between whoever loaded the order and whoever
  // completed it, so one cashier column cannot express it — see
  // shared/schema.ts and migration 051. NULL input_cashier_id means no human
  // loaded it (web / storefront), which gives the completer the whole pool.
  input_cashier_id: uuid('input_cashier_id'),
  // Who actually did the work, by user account — see shared/schema.ts and
  // migration 057. varchar because users.id is the auth subject, not a uuid.
  input_user_id: varchar('input_user_id', { length: 255 }),
  completed_user_id: varchar('completed_user_id', { length: 255 }),
  // Operational fields for the counter view — see shared/schema.ts.
  delay_flag: boolean('delay_flag').default(false).notNull(),
  delay_reason: varchar('delay_reason', { length: 255 }),
  eta_given: timestamp('eta_given'),
  revised_eta: timestamp('revised_eta'),
  // Written once, at the first transition to 'completed', like settled_total.
  completed_cashier_id: uuid('completed_cashier_id'),
  completed_cashier_shift_id: uuid('completed_cashier_shift_id'),
  customer_id: uuid('customer_id').references(()=>customers.id),
  total: numeric('total',{precision:10,scale:2}).notNull(),
  payment_method: varchar('payment_method',{length:50}).notNull(),
  status: varchar('status',{length:20}).default('pending'),
  // How the customer takes the goods — see shared/schema.ts and migration 047.
  // Independent of the arrival channel: a WhatsApp order can be collected and a
  // counter sale can be delivered.
  fulfilment_method: varchar('fulfilment_method',{length:16}).notNull().default('collection'),
  // Immutable settlement snapshot — see shared/schema.ts and migration 044.
  // Refunds cap against this, not `total`, so post-payment line edits cannot
  // inflate the refundable amount.
  settled_total: numeric('settled_total',{precision:10,scale:2}),
  settled_at: timestamp('settled_at'),
  // Why stock left without a sale — see shared/schema.ts and migration 054.
  personal_use_reason: text('personal_use_reason'),
  channel: varchar('channel', { length: 32 }).default('pos').notNull(),
  // When it was keyed in, and whether created_at is that moment or the day the
  // sale is for — see shared/schema.ts and migration 062.
  entered_at: timestamp('entered_at').defaultNow(),
  date_kind: varchar('date_kind', { length: 16 }).notNull().default('live'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
})

export const order_items = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  org_id: uuid('org_id').references(() => organizations.id),
  order_id: uuid('order_id').references(()=>orders.id),
  product_id: uuid('product_id').references(()=>products.id),
  quantity: numeric('quantity', { precision: 14, scale: 3, mode: 'number' }).notNull(),
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
  // varchar(10), not date: the column is character varying and
  // shared/schema.ts declares it as such. Reading it through a `date`
  // declaration hands the caller a Date where the rest of the codebase
  // expects a 'YYYY-MM-DD' string.
  due_date: varchar('due_date', { length: 10 }),
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
