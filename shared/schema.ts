import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  varchar,
  uuid,
  integer,
  boolean,
  numeric,
  date,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// ==================== ORGANIZATION & ROLES ====================
// Locations are treated as stores (one org can have many locations/stores).
// See ARCHITECTURE.md and RBAC.md for scoping rules.

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER'] as const;
export type Role = typeof ROLES[number];

export const roleEnum = pgEnum('app_role', ROLES);

export const BUSINESS_TYPES = ['retail', 'hospitality', 'services', 'wholesale', 'other'] as const;
export type BusinessType = typeof BUSINESS_TYPES[number];

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  setupComplete: integer("setup_complete").default(0).notNull(),
  setupWizardState: jsonb("setup_wizard_state"),
  onboardingState: jsonb("onboarding_state").default({}).notNull(),
  tradingName: varchar("trading_name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  address: varchar("address", { length: 1024 }),
  vatNumber: varchar("vat_number", { length: 50 }),
  companyNumber: varchar("company_number", { length: 50 }),
  currency: varchar("currency", { length: 10 }).default("GBP"),
  timezone: varchar("timezone", { length: 64 }).default("Europe/London"),
  businessType: varchar("business_type", { length: 32 }),
  logoUrl: varchar("logo_url", { length: 2048 }),
  invoiceTemplate: varchar("invoice_template", { length: 64 }).default("standard"),
  invoicePrefix: varchar("invoice_prefix", { length: 20 }).default("INV"),
  invoiceStartNumber: integer("invoice_start_number").default(1000),
  paymentTerms: varchar("payment_terms", { length: 255 }).default("Net 30"),
  defaultTaxRate: numeric("default_tax_rate", { precision: 5, scale: 2 }).default("20.00"),
  receiptFooter: varchar("receipt_footer", { length: 1024 }),
  receiptStyle: varchar("receipt_style", { length: 32 }).default("standard"),
  receiptTemplateHtml: text("receipt_template_html"),
  accentStyle: varchar("accent_style", { length: 32 }).default("midnight"),
  businessColors: jsonb("business_colors"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;

export const importHistory = pgTable("import_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id).notNull(),
  importType: varchar("import_type", { length: 32 }).notNull(),
  fileName: varchar("file_name", { length: 255 }),
  duplicateMode: varchar("duplicate_mode", { length: 32 }),
  importedCount: integer("imported_count").default(0),
  skippedCount: integer("skipped_count").default(0),
  failedCount: integer("failed_count").default(0),
  failedRows: jsonb("failed_rows"),
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [index("import_history_org_id_idx").on(table.orgId)]);

export type ImportHistory = typeof importHistory.$inferSelect;
export type InsertImportHistory = typeof importHistory.$inferInsert;

// Locations table (stores - one per org)
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
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
}, (table) => [index("locations_org_id_idx").on(table.orgId)]);

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
// id = Replit OIDC sub (varchar, PK). replitUserId = same, for explicit naming.
export const users = pgTable("users", {
  id: varchar("id").primaryKey(), // Auth subject (Replit sub or Clerk user id)
  replitUserId: varchar("replit_user_id", { length: 255 }).unique(), // Legacy; may match id
  authProvider: varchar("auth_provider", { length: 32 }).notNull().default("replit"),
  authUserId: varchar("auth_user_id", { length: 255 }),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  orgId: uuid("org_id").references(() => organizations.id),
  role: roleEnum("role").default("CASHIER"),
  defaultLocationId: uuid("default_location_id").references(() => locations.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("users_org_id_idx").on(table.orgId),
  index("users_replit_user_id_idx").on(table.replitUserId),
]);

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Loyalty tiers table
export const loyaltyTiers = pgTable("loyalty_tiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  name: varchar("name", { length: 50 }).notNull(),
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

// Loyalty redemption settings (F5)
export const loyaltySettings = pgTable("loyalty_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  redemptionRate: numeric("redemption_rate", { precision: 10, scale: 4 }).notNull().default("0.01"),
  minRedeemPoints: integer("min_redeem_points").notNull().default(100),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type LoyaltySettings = typeof loyaltySettings.$inferSelect;

// Promotions/campaigns table
export const promotions = pgTable("promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }),
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

// Customers table (orgId required for new rows; nullable for legacy backfill)
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  receiptEmailOptIn: boolean("receipt_email_opt_in").default(true).notNull(),
  address: varchar("address", { length: 1024 }),
  category: varchar("category", { length: 64 }).default("Bronze"),
  // Acquisition source, e.g. "whatsapp", "import", "pos". Null for legacy rows.
  source: varchar("source", { length: 32 }),
  manualOverrideProtected: integer("manual_override_protected").default(0).notNull(),
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
  totalSpent: true,
  manualOverrideProtected: true,
});
export type InsertCustomerData = z.infer<typeof insertCustomerSchema>;

// Products table (orgId required for new rows; nullable for legacy backfill)
export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  productId: varchar("product_id", { length: 100 }).notNull(),
  locationId: uuid("location_id").references(() => locations.id),
  costPrice: numeric("cost_price", { precision: 10, scale: 2 }),
  defaultSalePrice: numeric("default_sale_price", {
    precision: 10,
    scale: 2,
  }).notNull(),
  stock: integer("stock").default(0),
  stockLimit: integer("stock_limit").default(10),
  barcode: varchar("barcode", { length: 255 }),
  // Optional shorthand names used for WhatsApp/order-intent matching, e.g. ["coke", "large coke"].
  aliases: jsonb("aliases").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("products_org_id_idx").on(table.orgId),
  index("products_org_product_id_idx").on(table.orgId, table.productId),
]);

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;
export const insertProductSchema = createInsertSchema(products).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  stock: true
});
export type InsertProductData = z.infer<typeof insertProductSchema>;

// Per-location stock (authoritative for inventory math)
export const productLocationStock = pgTable(
  "product_location_stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    productId: uuid("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    locationId: uuid("location_id")
      .references(() => locations.id, { onDelete: "cascade" })
      .notNull(),
    stock: integer("stock").notNull().default(0),
    stockLimit: integer("stock_limit").notNull().default(10),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("product_location_stock_org_product_location_uq").on(
      table.orgId,
      table.productId,
      table.locationId,
    ),
    index("product_location_stock_org_location_idx").on(table.orgId, table.locationId),
    index("product_location_stock_product_idx").on(table.productId),
  ],
);

export type ProductLocationStock = typeof productLocationStock.$inferSelect;
export type InsertProductLocationStock = typeof productLocationStock.$inferInsert;

export const TRANSFER_STATUSES = [
  "draft",
  "requested",
  "in_transit",
  "completed",
  "cancelled",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const inventoryTransfers = pgTable(
  "inventory_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    fromLocationId: uuid("from_location_id")
      .references(() => locations.id)
      .notNull(),
    toLocationId: uuid("to_location_id")
      .references(() => locations.id)
      .notNull(),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    notes: varchar("notes", { length: 2000 }),
    correlationId: varchar("correlation_id", { length: 100 }),
    requestedBy: varchar("requested_by", { length: 255 }),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("inventory_transfers_org_status_idx").on(table.orgId, table.status)],
);

export type InventoryTransfer = typeof inventoryTransfers.$inferSelect;
export type InsertInventoryTransfer = typeof inventoryTransfers.$inferInsert;

export const inventoryTransferItems = pgTable(
  "inventory_transfer_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transferId: uuid("transfer_id")
      .references(() => inventoryTransfers.id, { onDelete: "cascade" })
      .notNull(),
    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("inventory_transfer_items_transfer_idx").on(table.transferId)],
);

export type InventoryTransferItem = typeof inventoryTransferItems.$inferSelect;
export type InsertInventoryTransferItem = typeof inventoryTransferItems.$inferInsert;

// Phase 11B: suppliers & replenishment
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    contactName: varchar("contact_name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    leadTimeDays: integer("lead_time_days").notNull().default(0),
    minOrderValue: numeric("min_order_value", { precision: 12, scale: 2 }).default("0"),
    minOrderQuantity: integer("min_order_quantity").default(0),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("suppliers_org_active_idx").on(table.orgId, table.isActive)],
);

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

export const productSuppliers = pgTable(
  "product_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    productId: uuid("product_id")
      .references(() => products.id, { onDelete: "cascade" })
      .notNull(),
    supplierId: uuid("supplier_id")
      .references(() => suppliers.id, { onDelete: "cascade" })
      .notNull(),
    supplierSku: varchar("supplier_sku", { length: 100 }),
    costPrice: numeric("cost_price", { precision: 12, scale: 2 }),
    packSize: integer("pack_size").notNull().default(1),
    minOrderQty: integer("min_order_qty").default(1),
    leadTimeOverrideDays: integer("lead_time_override_days"),
    isPreferred: integer("is_preferred").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("product_suppliers_org_product_supplier_uq").on(table.orgId, table.productId, table.supplierId),
    index("product_suppliers_org_product_idx").on(table.orgId, table.productId),
    index("product_suppliers_org_supplier_idx").on(table.orgId, table.supplierId),
  ],
);

export type ProductSupplier = typeof productSuppliers.$inferSelect;
export type InsertProductSupplier = typeof productSuppliers.$inferInsert;

export const PURCHASE_DRAFT_STATUSES = [
  "draft",
  "reviewed",
  "approved",
  "partially_received",
  "fully_received",
  "cancelled",
] as const;
export type PurchaseDraftStatus = (typeof PURCHASE_DRAFT_STATUSES)[number];

export const purchaseDrafts = pgTable(
  "purchase_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    supplierId: uuid("supplier_id")
      .references(() => suppliers.id)
      .notNull(),
    locationId: uuid("location_id")
      .references(() => locations.id)
      .notNull(),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    sourceRecommendationJson: jsonb("source_recommendation_json"),
    createdBy: varchar("created_by", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("purchase_drafts_org_status_idx").on(table.orgId, table.status)],
);

export type PurchaseDraft = typeof purchaseDrafts.$inferSelect;
export type InsertPurchaseDraft = typeof purchaseDrafts.$inferInsert;

export const purchaseDraftItems = pgTable(
  "purchase_draft_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseDraftId: uuid("purchase_draft_id")
      .references(() => purchaseDrafts.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),
    quantity: integer("quantity").notNull(),
    quantityReceived: integer("quantity_received").notNull().default(0),
    estimatedCost: numeric("estimated_cost", { precision: 12, scale: 2 }),
    supplierSku: varchar("supplier_sku", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("purchase_draft_items_draft_idx").on(table.purchaseDraftId)],
);

export type PurchaseDraftItem = typeof purchaseDraftItems.$inferSelect;
export type InsertPurchaseDraftItem = typeof purchaseDraftItems.$inferInsert;

export const GOODS_RECEIPT_STATUSES = ["pending", "completed", "voided"] as const;
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUSES)[number];

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    purchaseDraftId: uuid("purchase_draft_id")
      .references(() => purchaseDrafts.id)
      .notNull(),
    locationId: uuid("location_id")
      .references(() => locations.id)
      .notNull(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    supplierReference: varchar("supplier_reference", { length: 255 }),
    deliveryNote: varchar("delivery_note", { length: 500 }),
    receivedBy: varchar("received_by", { length: 255 }),
    receivedAt: timestamp("received_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("goods_receipts_org_draft_idx").on(table.orgId, table.purchaseDraftId),
    index("goods_receipts_org_status_idx").on(table.orgId, table.status),
    index("goods_receipts_org_created_idx").on(table.orgId, table.createdAt),
  ],
);

export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type InsertGoodsReceipt = typeof goodsReceipts.$inferInsert;

export const goodsReceiptItems = pgTable(
  "goods_receipt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goodsReceiptId: uuid("goods_receipt_id")
      .references(() => goodsReceipts.id, { onDelete: "cascade" })
      .notNull(),
    purchaseDraftItemId: uuid("purchase_draft_item_id")
      .references(() => purchaseDraftItems.id)
      .notNull(),
    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),
    quantityReceived: integer("quantity_received").notNull(),
    quantityDamaged: integer("quantity_damaged").notNull().default(0),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("goods_receipt_items_receipt_idx").on(table.goodsReceiptId),
    index("goods_receipt_items_draft_item_idx").on(table.purchaseDraftItemId),
  ],
);

export type GoodsReceiptItem = typeof goodsReceiptItems.$inferSelect;
export type InsertGoodsReceiptItem = typeof goodsReceiptItems.$inferInsert;

export const REPLENISHMENT_ACTION_TYPES = [
  "NO_ACTION",
  "TRANSFER",
  "BUY",
  "TRANSFER_PLUS_BUY",
] as const;
export type ReplenishmentActionType = (typeof REPLENISHMENT_ACTION_TYPES)[number];

// Order status enum
export const ORDER_STATUSES = ['pending', 'on-hold', 'awaiting-customer', 'urgent', 'completed'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export const ORDER_CHANNELS = ['pos', 'web', 'api', 'whatsapp', 'phone'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

// Cashier shifts (F2)
export const SHIFT_STATUSES = ["open", "closed", "reopened"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    locationId: uuid("location_id")
      .references(() => locations.id)
      .notNull(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
    openingFloat: numeric("opening_float", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    closingCount: numeric("closing_count", { precision: 10, scale: 2 }),
    expectedCash: numeric("expected_cash", { precision: 10, scale: 2 }),
    variance: numeric("variance", { precision: 10, scale: 2 }),
    notes: text("notes"),
    reopenReason: text("reopen_reason"),
    status: varchar("status", { length: 16 }).notNull().default("open"),
  },
  (table) => [
    index("shifts_org_location_idx").on(table.orgId, table.locationId),
    index("shifts_user_status_idx").on(table.userId, table.status),
  ],
);

export type Shift = typeof shifts.$inferSelect;
export type InsertShift = typeof shifts.$inferInsert;

// Orders table (orgId required for new rows; nullable for legacy backfill)
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  customerId: uuid("customer_id").references(() => customers.id),
  locationId: uuid("location_id").references(() => locations.id),
  shiftId: uuid("shift_id").references(() => shifts.id),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).default("pending"),
  channel: varchar("channel", { length: 32 }).notNull().default("pos"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("orders_org_id_idx").on(table.orgId),
  index("orders_shift_id_idx").on(table.shiftId),
]);

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
  orgId: uuid("org_id").references(() => organizations.id),
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

// Order expenses table (orgId from order; nullable for legacy backfill)
export const orderExpenses = pgTable("order_expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
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

// Order items table (orgId from order; nullable for legacy backfill)
export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  orderId: uuid("order_id").references(() => orders.id),
  productId: uuid("product_id").references(() => products.id),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// Refunds (F3)
export const REFUND_REASONS = [
  "damaged",
  "wrong_item",
  "customer_changed_mind",
  "defect",
  "other",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_METHODS = ["original", "cash", "store_credit"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .references(() => orders.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    cashierId: varchar("cashier_id", { length: 255 }).notNull(),
    shiftId: uuid("shift_id").references(() => shifts.id),
    reason: varchar("reason", { length: 32 }).notNull(),
    notes: text("notes"),
    refundMethod: varchar("refund_method", { length: 16 }).notNull(),
    total: numeric("total", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("refunds_order_id_idx").on(table.orderId),
    index("refunds_org_id_idx").on(table.orgId),
    index("refunds_shift_id_idx").on(table.shiftId),
  ],
);

export type Refund = typeof refunds.$inferSelect;
export type InsertRefund = typeof refunds.$inferInsert;

export const refundLines = pgTable(
  "refund_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    refundId: uuid("refund_id")
      .references(() => refunds.id, { onDelete: "cascade" })
      .notNull(),
    orderLineId: uuid("order_line_id")
      .references(() => orderItems.id)
      .notNull(),
    qty: integer("qty").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [
    index("refund_lines_refund_id_idx").on(table.refundId),
    index("refund_lines_order_line_id_idx").on(table.orderLineId),
  ],
);

export type RefundLine = typeof refundLines.$inferSelect;
export type InsertRefundLine = typeof refundLines.$inferInsert;

export const GIFT_CARD_STATUSES = ["active", "redeemed", "expired", "void"] as const;
export type GiftCardStatus = (typeof GIFT_CARD_STATUSES)[number];
export const GIFT_CARD_MOVEMENT_TYPES = ["issue", "redeem", "refund_credit", "void", "expire"] as const;
export type GiftCardMovementType = (typeof GIFT_CARD_MOVEMENT_TYPES)[number];

export const giftCards = pgTable("gift_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull(),
  originalAmount: numeric("original_amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("GBP"),
  issuedToCustomerId: uuid("issued_to_customer_id").references(() => customers.id),
  issuedByUserId: varchar("issued_by_user_id", { length: 255 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("gift_cards_org_id_idx").on(table.orgId),
  index("gift_cards_customer_id_idx").on(table.issuedToCustomerId),
  index("gift_cards_code_idx").on(table.code),
]);
export type GiftCard = typeof giftCards.$inferSelect;

export const giftCardMovements = pgTable("gift_card_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  giftCardId: uuid("gift_card_id").references(() => giftCards.id, { onDelete: "cascade" }).notNull(),
  orderId: uuid("order_id").references(() => orders.id),
  refundId: uuid("refund_id").references(() => refunds.id),
  type: varchar("type", { length: 16 }).notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("gift_card_movements_card_id_idx").on(table.giftCardId),
  index("gift_card_movements_order_id_idx").on(table.orderId),
  index("gift_card_movements_refund_id_idx").on(table.refundId),
]);
export type GiftCardMovement = typeof giftCardMovements.$inferSelect;

// Saved filter views (U3)
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    page: varchar("page", { length: 32 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    filters: jsonb("filters").notNull().default({}),
    sort: jsonb("sort").notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("saved_views_user_org_page_name_idx").on(table.userId, table.orgId, table.page, table.name),
    index("saved_views_user_org_page_idx").on(table.userId, table.orgId, table.page),
  ],
);
export type SavedView = typeof savedViews.$inferSelect;
export type InsertSavedView = typeof savedViews.$inferInsert;

// Customer RFM segmentation (A2)
export const customerRfm = pgTable(
  "customer_rfm",
  {
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }).notNull(),
    recencyScore: integer("recency_score").notNull(),
    frequencyScore: integer("frequency_score").notNull(),
    monetaryScore: integer("monetary_score").notNull(),
    segment: varchar("segment", { length: 24 }).notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.customerId] }),
    index("customer_rfm_org_segment_idx").on(table.orgId, table.segment),
  ],
);
export type CustomerRfm = typeof customerRfm.$inferSelect;

// Invoices table (orgId from order; nullable for legacy backfill)
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id),
  orderId: uuid("order_id").references(() => orders.id),
  customerId: uuid("customer_id").references(() => customers.id),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull(),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  tax: numeric("tax", { precision: 10, scale: 2 }).default("0"),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 20 }).default("sent"),
  dueDate: varchar("due_date", { length: 10 }),
  googleDriveFileId: varchar("google_drive_file_id", { length: 255 }),
  googleDriveLink: varchar("google_drive_link", { length: 1024 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;
export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertInvoiceData = z.infer<typeof insertInvoiceSchema>;

// Analytics tables (org-scoped; PK includes orgId for multi-tenant)
export const analyticsDaily = pgTable('analytics_daily', {
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  date: date('date').notNull(),
  totalOrders: integer('total_orders').default(0),
  totalRevenue: numeric('total_revenue', { precision: 12, scale: 2 }).default('0'),
}, (table) => ({
  pk: primaryKey({ columns: [table.orgId, table.date] }),
}));

export const analyticsWeekly = pgTable(
  "analytics_weekly",
  {
    orgId: uuid("org_id").references(() => organizations.id).notNull(),
    year: integer("year").notNull(),
    week: integer("week").notNull(),
    totalOrders: integer("total_orders").default(0),
    totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).default(
      "0"
    ),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.year, t.week] }) })
);

export const analyticsMonthly = pgTable(
  "analytics_monthly",
  {
    orgId: uuid("org_id").references(() => organizations.id).notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    totalOrders: integer("total_orders").default(0),
    totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).default(
      "0"
    ),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.year, t.month] }) })
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
  shift: one(shifts, {
    fields: [orders.shiftId],
    references: [shifts.id],
  }),
  items: many(orderItems),
  refunds: many(refunds),
}));

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  location: one(locations, {
    fields: [shifts.locationId],
    references: [locations.id],
  }),
  orders: many(orders),
  refunds: many(refunds),
}));

export const refundsRelations = relations(refunds, ({ one, many }) => ({
  order: one(orders, {
    fields: [refunds.orderId],
    references: [orders.id],
  }),
  lines: many(refundLines),
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
// isOwner (legacy): 1 => SUPER_ADMIN. role takes precedence when set.
export const allowedUsers = pgTable("allowed_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  replitUserId: varchar("replit_user_id", { length: 255 }).notNull().unique(),
  authProvider: varchar("auth_provider", { length: 32 }).notNull().default("replit"),
  authUserId: varchar("auth_user_id", { length: 255 }),
  email: varchar("email", { length: 255 }),
  name: varchar("name", { length: 255 }),
  isOwner: integer("is_owner").default(0).notNull(), // legacy; 1 => SUPER_ADMIN
  orgId: uuid("org_id").references(() => organizations.id),
  role: roleEnum("role").default("CASHIER"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("allowed_users_org_id_idx").on(table.orgId),
  index("allowed_users_email_idx").on(table.email),
]);

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
  authProvider: varchar("auth_provider", { length: 32 }).notNull().default("replit"),
  authUserId: varchar("auth_user_id", { length: 255 }),
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

// ==================== PHASE 10 AUTOMATION ====================

export const automationRules = pgTable(
  "automation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    triggerEventType: varchar("trigger_event_type", { length: 50 }).notNull(),
    conditionJson: jsonb("condition_json").notNull().default({}),
    actionJson: jsonb("action_json").notNull().default({}),
    priority: integer("priority").notNull().default(100),
    isEnabled: integer("is_enabled").notNull().default(0),
    lastTriggeredAt: timestamp("last_triggered_at"),
    executionCount: integer("execution_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("automation_rules_org_enabled_idx").on(table.orgId, table.isEnabled),
    index("automation_rules_org_trigger_idx").on(table.orgId, table.triggerEventType),
  ],
);

export type AutomationRule = typeof automationRules.$inferSelect;
export type InsertAutomationRule = typeof automationRules.$inferInsert;

export const scheduledReports = pgTable(
  "scheduled_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    reportType: varchar("report_type", { length: 64 }).notNull(),
    frequency: varchar("frequency", { length: 20 }).notNull(),
    deliveryMethods: jsonb("delivery_methods").notNull().default(["notification_center"]),
    isEnabled: integer("is_enabled").notNull().default(0),
    nextRunAt: timestamp("next_run_at"),
    lastRunAt: timestamp("last_run_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("scheduled_reports_org_next_idx").on(table.orgId, table.isEnabled, table.nextRunAt)],
);

export type ScheduledReport = typeof scheduledReports.$inferSelect;
export type InsertScheduledReport = typeof scheduledReports.$inferInsert;

export const scheduledReportRuns = pgTable(
  "scheduled_report_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .references(() => scheduledReports.id, { onDelete: "cascade" })
      .notNull(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    executionKey: varchar("execution_key", { length: 512 }).notNull().unique(),
    status: varchar("status", { length: 32 }).notNull().default("completed"),
    snapshotJson: jsonb("snapshot_json"),
    errorMessage: varchar("error_message", { length: 2000 }),
    startedAt: timestamp("started_at").defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("scheduled_report_runs_report_idx").on(table.reportId, table.completedAt)],
);

export type ScheduledReportRun = typeof scheduledReportRuns.$inferSelect;
export type InsertScheduledReportRun = typeof scheduledReportRuns.$inferInsert;

export const orgNotifications = pgTable(
  "org_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    severity: varchar("severity", { length: 20 }).notNull().default("info"),
    source: varchar("source", { length: 64 }).notNull(),
    metadata: jsonb("metadata"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("org_notifications_org_created_idx").on(table.orgId, table.createdAt)],
);

export type OrgNotification = typeof orgNotifications.$inferSelect;
export type InsertOrgNotification = typeof orgNotifications.$inferInsert;

// ==================== EVENT-DRIVEN SYNC SYSTEM ====================

// Event types for the system
export const EVENT_TYPES = [
  'OrderCreated',
  'OrderUpdated', 
  'OrderStatusChanged',
  'PaymentCaptured',
  'RefundIssued',
  'GiftCardIssued',
  'GiftCardRedeemed',
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
  'ExpensesWorker',
  'AutomationWorker',
  'ReceiptEmailWorker',
] as const;
export type WorkerName = typeof WORKER_NAMES[number];

// Job statuses
export const JOB_STATUSES = ['queued', 'running', 'success', 'failed', 'dead_letter'] as const;
export type JobStatus = typeof JOB_STATUSES[number];

// Worker result statuses
export const WORKER_RESULT_STATUSES = ['success', 'failed', 'already_processed', 'retrying', 'skipped'] as const;
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

/** Programmatic access for external channels (C1–C3). */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    keyLookup: varchar("key_lookup", { length: 64 }).notNull(),
    secretHash: varchar("secret_hash", { length: 255 }).notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["products:read"]),
    createdAt: timestamp("created_at").defaultNow(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    index("api_keys_org_idx").on(table.orgId),
    index("api_keys_lookup_idx").on(table.orgId, table.keyLookup),
  ],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

/** Outbound webhook subscriptions (C1, C4). */
export const outboundWebhooks = pgTable(
  "outbound_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    secret: varchar("secret", { length: 512 }).notNull(),
    eventTypes: jsonb("event_types").$type<string[]>().notNull().default(["OrderCreated"]),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("outbound_webhooks_org_idx").on(table.orgId)],
);

export type OutboundWebhook = typeof outboundWebhooks.$inferSelect;
export type InsertOutboundWebhook = typeof outboundWebhooks.$inferInsert;

/** Human-facing admin actions (access approvals, destructive admin ops). S7 */
export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id),
    actorUserId: varchar("actor_user_id", { length: 255 }).notNull(),
    actorRole: varchar("actor_role", { length: 32 }),
    action: varchar("action", { length: 120 }).notNull(),
    targetType: varchar("target_type", { length: 64 }),
    targetId: varchar("target_id", { length: 255 }),
    metadata: jsonb("metadata"),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 1024 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("admin_audit_logs_created_at_idx").on(table.createdAt),
    index("admin_audit_logs_actor_idx").on(table.actorUserId),
  ],
);

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLogs.$inferInsert;

/** Per-org feature toggles (M3). */
export const featureFlags = pgTable(
  "feature_flags",
  {
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    flag: varchar("flag", { length: 64 }).notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.flag] }),
    index("feature_flags_org_id_idx").on(table.orgId),
  ],
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type InsertFeatureFlag = typeof featureFlags.$inferInsert;

// Inventory Movements - audit trail for stock changes
export const inventoryMovements = pgTable("inventory_movements", {
  movementId: varchar("movement_id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").references(() => organizations.id),
  sku: varchar("sku", { length: 100 }).notNull(),
  productId: uuid("product_id").references(() => products.id),
  delta: integer("delta").notNull(), // negative for sale, positive for return
  reason: varchar("reason", { length: 50 }).notNull(), // sale, refund, adjustment, order_update
  correlationId: varchar("correlation_id", { length: 100 }).notNull(), // orderId
  eventId: varchar("event_id", { length: 36 }).notNull(),
  previousStock: integer("previous_stock"),
  newStock: integer("new_stock"),
  locationId: uuid("location_id").references(() => locations.id),
  transferId: uuid("transfer_id"),
  fromLocationId: uuid("from_location_id").references(() => locations.id),
  toLocationId: uuid("to_location_id").references(() => locations.id),
  goodsReceiptId: uuid("goods_receipt_id"),
  purchaseDraftId: uuid("purchase_draft_id"),
  supplierId: uuid("supplier_id"),
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
  orgId: uuid("org_id").references(() => organizations.id),
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

// ==================== WHATSAPP BUSINESS INTEGRATION ====================
// Official WhatsApp Business Platform (Cloud API) channel. Disabled by default
// via WHATSAPP_ENABLED. All tables are org-scoped (Principle 3).

export const WHATSAPP_CONVERSATION_STATUSES = ['open', 'pending', 'closed', 'archived'] as const;
export type WhatsappConversationStatus = (typeof WHATSAPP_CONVERSATION_STATUSES)[number];

export const WHATSAPP_MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type WhatsappMessageDirection = (typeof WHATSAPP_MESSAGE_DIRECTIONS)[number];

export const WHATSAPP_MESSAGE_TYPES = [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'unknown',
] as const;
export type WhatsappMessageType = (typeof WHATSAPP_MESSAGE_TYPES)[number];

export const WHATSAPP_MESSAGE_STATUSES = ['received', 'sent', 'delivered', 'read', 'failed'] as const;
export type WhatsappMessageStatus = (typeof WHATSAPP_MESSAGE_STATUSES)[number];

/** Connected WhatsApp Business account / phone number metadata (one per org number). */
export const whatsappAccounts = pgTable(
  "whatsapp_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    phoneNumber: varchar("phone_number", { length: 32 }).notNull(),
    phoneNumberId: varchar("phone_number_id", { length: 64 }).notNull(),
    businessAccountId: varchar("business_account_id", { length: 64 }),
    displayName: varchar("display_name", { length: 255 }),
    status: varchar("status", { length: 24 }).notNull().default("connected"),
    lastWebhookAt: timestamp("last_webhook_at"),
    lastOutboundAt: timestamp("last_outbound_at"),
    lastOutboundStatus: varchar("last_outbound_status", { length: 24 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("whatsapp_accounts_org_idx").on(table.orgId),
    // phone_number_id is globally unique on Meta's side; used to route inbound webhooks to an org.
    uniqueIndex("whatsapp_accounts_phone_number_id_idx").on(table.phoneNumberId),
  ],
);

export type WhatsappAccount = typeof whatsappAccounts.$inferSelect;
export type InsertWhatsappAccount = typeof whatsappAccounts.$inferInsert;

/** One row per customer/contact conversation. */
export const whatsappConversations = pgTable(
  "whatsapp_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    whatsappAccountId: uuid("whatsapp_account_id")
      .references(() => whatsappAccounts.id, { onDelete: "cascade" })
      .notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    phone: varchar("phone", { length: 32 }).notNull(),
    waId: varchar("wa_id", { length: 32 }).notNull(),
    profileName: varchar("profile_name", { length: 255 }),
    lastMessageAt: timestamp("last_message_at"),
    lastMessagePreview: varchar("last_message_preview", { length: 512 }),
    lastInboundAt: timestamp("last_inbound_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("whatsapp_conversations_org_idx").on(table.orgId),
    index("whatsapp_conversations_customer_idx").on(table.customerId),
    index("whatsapp_conversations_last_message_idx").on(table.orgId, table.lastMessageAt),
    // One conversation per (account, wa_id) — idempotent upsert target.
    uniqueIndex("whatsapp_conversations_account_wa_idx").on(table.whatsappAccountId, table.waId),
  ],
);

export type WhatsappConversation = typeof whatsappConversations.$inferSelect;
export type InsertWhatsappConversation = typeof whatsappConversations.$inferInsert;

/** Inbound/outbound message log. whatsapp_message_id is unique for idempotency. */
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    conversationId: uuid("conversation_id")
      .references(() => whatsappConversations.id, { onDelete: "cascade" })
      .notNull(),
    whatsappMessageId: varchar("whatsapp_message_id", { length: 128 }),
    direction: varchar("direction", { length: 12 }).notNull(),
    messageType: varchar("message_type", { length: 16 }).notNull().default("text"),
    body: text("body"),
    mediaId: varchar("media_id", { length: 128 }),
    mediaMimeType: varchar("media_mime_type", { length: 128 }),
    status: varchar("status", { length: 16 }).notNull().default("received"),
    rawPayload: jsonb("raw_payload"),
    sentByUserId: varchar("sent_by_user_id", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("whatsapp_messages_conversation_idx").on(table.conversationId, table.createdAt),
    index("whatsapp_messages_org_idx").on(table.orgId),
    // Idempotency on Meta's globally-unique message id. A plain unique index still
    // permits multiple NULLs (Postgres treats NULLs as distinct) for outbound-before-ack.
    uniqueIndex("whatsapp_messages_wa_message_id_idx").on(table.whatsappMessageId),
  ],
);

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type InsertWhatsappMessage = typeof whatsappMessages.$inferInsert;

/** Explicit audit of customer<->conversation links (in addition to conversation.customerId). */
export const whatsappCustomerLinks = pgTable(
  "whatsapp_customer_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    conversationId: uuid("conversation_id")
      .references(() => whatsappConversations.id, { onDelete: "cascade" })
      .notNull(),
    customerId: uuid("customer_id")
      .references(() => customers.id, { onDelete: "cascade" })
      .notNull(),
    linkedByUserId: varchar("linked_by_user_id", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("whatsapp_customer_links_org_idx").on(table.orgId),
    index("whatsapp_customer_links_conversation_idx").on(table.conversationId),
  ],
);

export type WhatsappCustomerLink = typeof whatsappCustomerLinks.$inferSelect;
export type InsertWhatsappCustomerLink = typeof whatsappCustomerLinks.$inferInsert;

export const WHATSAPP_ORDER_INTENT_STATUSES = [
  "suggested",
  "accepted",
  "rejected",
  "converted",
] as const;
export type WhatsappOrderIntentStatus = (typeof WHATSAPP_ORDER_INTENT_STATUSES)[number];

/** A single parsed line in an order-intent suggestion. */
export interface WhatsappParsedItem {
  productId?: string;
  sku?: string;
  name: string;
  quantity: number;
  matched: boolean;
}

/** Rule-based order suggestions parsed from inbound messages (pre-confirmation). */
export const whatsappOrderIntents = pgTable(
  "whatsapp_order_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    conversationId: uuid("conversation_id")
      .references(() => whatsappConversations.id, { onDelete: "cascade" })
      .notNull(),
    messageId: uuid("message_id").references(() => whatsappMessages.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    parsedItems: jsonb("parsed_items").$type<WhatsappParsedItem[]>().notNull().default([]),
    rawText: text("raw_text"),
    confidenceScore: numeric("confidence_score", { precision: 4, scale: 3 }),
    status: varchar("status", { length: 16 }).notNull().default("suggested"),
    draftOrderId: uuid("draft_order_id").references(() => orders.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("whatsapp_order_intents_org_idx").on(table.orgId),
    index("whatsapp_order_intents_conversation_idx").on(table.conversationId),
    index("whatsapp_order_intents_status_idx").on(table.orgId, table.status),
  ],
);

export type WhatsappOrderIntent = typeof whatsappOrderIntents.$inferSelect;
export type InsertWhatsappOrderIntent = typeof whatsappOrderIntents.$inferInsert;

/** Synced / seeded WhatsApp message templates. */
export const whatsappTemplates = pgTable(
  "whatsapp_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    templateName: varchar("template_name", { length: 128 }).notNull(),
    category: varchar("category", { length: 48 }),
    language: varchar("language", { length: 16 }).notNull().default("en_GB"),
    // Meta approval status: APPROVED / PENDING / REJECTED / LOCAL (seed, not yet submitted).
    status: varchar("status", { length: 24 }).notNull().default("LOCAL"),
    body: text("body"),
    variables: jsonb("variables").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("whatsapp_templates_org_idx").on(table.orgId),
    uniqueIndex("whatsapp_templates_org_name_lang_idx").on(
      table.orgId,
      table.templateName,
      table.language,
    ),
  ],
);

export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type InsertWhatsappTemplate = typeof whatsappTemplates.$inferInsert;

// Required workers per event type configuration
export const REQUIRED_WORKERS: Record<EventType, WorkerName[]> = {
  OrderCreated: ['InventoryWorker', 'CustomerWorker', 'LoyaltyWorker', 'InvoiceWorker', 'ReceiptEmailWorker', 'BusinessInsightsWorker', 'FinanceWorker', 'AutomationWorker'],
  OrderUpdated: ['InventoryWorker', 'CustomerWorker', 'LoyaltyWorker', 'BusinessInsightsWorker', 'FinanceWorker'],
  OrderStatusChanged: ['CustomerWorker', 'BusinessInsightsWorker', 'FinanceWorker', 'AutomationWorker'],
  PaymentCaptured: ['InvoiceWorker', 'FinanceWorker', 'AutomationWorker'],
  RefundIssued: ['InventoryWorker', 'LoyaltyWorker', 'CustomerWorker', 'BusinessInsightsWorker', 'FinanceWorker'],
  GiftCardIssued: ['CustomerWorker', 'BusinessInsightsWorker'],
  GiftCardRedeemed: ['CustomerWorker', 'BusinessInsightsWorker'],
  OrderCancelled: ['InventoryWorker', 'LoyaltyWorker', 'CustomerWorker', 'BusinessInsightsWorker', 'FinanceWorker'],
  ExpenseLogged: ['ExpensesWorker', 'FinanceWorker', 'BusinessInsightsWorker'],
  ExpenseUpdated: ['ExpensesWorker', 'FinanceWorker', 'BusinessInsightsWorker'],
  ExpenseDeleted: ['ExpensesWorker', 'FinanceWorker', 'BusinessInsightsWorker'],
};