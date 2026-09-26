/**
 * Storage Layer - Data Access Interface
 * 
 * This module provides the primary data access layer for the ARCARNA EPOS system.
 * It abstracts database operations and provides a clean interface for the API layer.
 * 
 * IMPORTANT FIELD NAME CONVENTIONS:
 * - Database columns use snake_case (e.g., default_sale_price, cost_price)
 * - API/Frontend expects camelCase (e.g., defaultSalePrice, costPrice)
 * - Drizzle ORM automatically handles the mapping via shared/schema.ts
 * - All methods return camelCase objects for API consumption
 * 
 * DATA FLOW:
 * Database (PostgreSQL) -> Drizzle ORM -> Storage Layer -> API Routes -> Frontend
 * 
 * CRITICAL NOTES:
 * - Always use shared/schema.ts as the single source of truth for types
 * - Use nullish coalescing (??) for numeric fields to handle 0 values correctly
 * - Never use || for numeric fields as it treats 0 as falsy
 * - All numeric values from DB are strings (numeric type) - parse carefully
 */
import {
  users,
  customers,
  customerMetrics,
  products,
  productLocationStock,
  orders,
  orderItems,
  invoices,
  locations,
  loyaltyTiers,
  promotions,
  overheadExpenses,
  orderExpenses,
  allowedUsers,
  userApprovalRequests,
  adminAuditLogs,
  featureFlags,
  organizations,
  importHistory,
  customerRfm,
  type Organization,
  type ImportHistory,
  type InsertImportHistory,
  type User,
  type UpsertUser,
  type Customer,
  type CustomerMetric,
  type Product,
  type Order,
  type OrderItem,
  type Location,
  type LocationPickerOption,
  type LoyaltyTier,
  type InsertLoyaltyTier,
  type Promotion,
  type InsertPromotion,
  type OverheadExpense,
  type InsertOverheadExpense,
  type OrderExpense,
  type InsertOrderExpense,
  type InsertProduct,
  type AllowedUser,
  type InsertAllowedUser,
  type UserApprovalRequest,
  type InsertUserApprovalRequest,
  type AdminAuditLog,
  type InsertAdminAuditLog,
  type FeatureFlag,
  apiKeys,
  outboundWebhooks,
  type ApiKey,
  type OutboundWebhook,
  commissionRateSchema,
} from "@shared/schema";
import type { WebsiteProductSettingsPatch } from "@shared/website";
import { withRetries } from "./lib/dbUtils";
import { db } from "./db";
import { eq, desc, sql, and, or, lte, gte, isNull, between, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { LOW_STOCK_THRESHOLD_PERCENT } from "@shared/constants/stock";

// --- Utility Functions ---
import { parseImportInteger, parseImportNumber } from "@shared/importValues";
import { MIN_PRICE_CLEAR_TOKEN, checkMinPrice, parseMinPriceCell } from "@shared/pricing/floor";
import { canEditMinPrice } from "@shared/accessPolicy";
import { recordPriceChanges } from "./services/priceHistory";

function safeParseFloat(value: string | number | null | undefined, defaultValue: number = 0): number {
  return parseImportNumber(value) ?? defaultValue;
}

function safeParseInt(value: string | number | null | undefined, defaultValue: number = 0): number {
  return parseImportInteger(value) ?? defaultValue;
}

export type ProductImportOptions = {
  duplicateMode?: "skip" | "overwrite";
  confirmed?: boolean;
  /** The importer's role: a minimum-price column needs manager or above. */
  role?: string | null;
  /** Written to price history as who made the change. */
  actorId?: string | null;
};

// --- CRITICAL NOTE: Storage <-> API Field Mapping ---
/**
 * Storage Interface - Defines all data operations
 * Each method is consumed by corresponding API endpoints in server/routes.ts
 */
export interface IStorage {
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Analytics operations
  getTopCustomers(limit: number, orgId: string): Promise<
    Array<{
      customer: Customer;
      metrics: CustomerMetric | null;
    }>
  >;
  getDailyRevenue(days: number, orgId: string): Promise<
    Array<{
      date: string;
      totalOrders: number;
      totalRevenue: string;
    }>
  >;
  getMonthlySummary(months: number, orgId: string): Promise<
    Array<{
      year: number;
      month: number;
      totalOrders: number;
      totalRevenue: string;
    }>
  >;

  // POS operations
  getProducts(orgId: string): Promise<Product[]>;
  getCustomers(orgId: string): Promise<Customer[]>;

  // Product operations
  createProduct(data: InsertProduct): Promise<Product>; // Use InsertProduct type
  updateProduct(id: string, data: any): Promise<Product>;
  updateProductWebsiteSettings(
    id: string,
    orgId: string,
    patch: WebsiteProductSettingsPatch,
  ): Promise<Product | null>;
  deleteProduct(id: string, orgId: string): Promise<void>;
  getProduct(id: string, orgId: string): Promise<Product | null>;
  importProducts(
    products: any[],
    orgId: string,
    options?: ProductImportOptions,
  ): Promise<{ imported: number; skipped: number; failed: number; errors: string[] }>;
  importCustomers(
    customers: any[],
    orgId: string,
    options?: { duplicateMode?: "skip" | "merge" | "overwrite"; confirmed?: boolean },
  ): Promise<{ imported: number; skipped: number; merged: number; failed: number; errors: string[] }>;
  getOrgProfile(orgId: string): Promise<Organization | null>;
  updateOrgProfile(orgId: string, patch: Record<string, unknown>): Promise<Organization>;
  updateOnboardingState(orgId: string, state: Record<string, unknown>): Promise<Organization>;
  completeOrgSetup(orgId: string): Promise<Organization>;
  getImportHistory(orgId: string, limit?: number): Promise<ImportHistory[]>;
  recordImportHistory(data: InsertImportHistory): Promise<ImportHistory>;

  // Customer operations
  createCustomer(data: any): Promise<Customer>;
  updateCustomer(id: string, data: any): Promise<Customer>;
  deleteCustomer(id: string, orgId: string): Promise<void>;
  getCustomer(id: string, orgId: string): Promise<Customer | null>;

  // Inventory operations
  getProductsWithStock(orgId: string, locationId?: string | null): Promise<Product[]>;
  updateProductStock(
    productId: string,
    adjustment: number,
    type: 'add' | 'set',
    userId: string,
    orgId: string,
    locationId?: string | null,
  ): Promise<Product>;

  // Reports operations
  getReportData(fromDate: Date, toDate: Date, orgId: string): Promise<any>;
  generateCSVReport(data: any, type: string): Promise<string>;
  generatePDFReport(data: any, type: string, period?: string): Promise<Buffer>;

  // Locations operations
  getLocations(orgId: string): Promise<Location[]>;
  getLocationPickerOptions(orgId: string): Promise<LocationPickerOption[]>;
  createLocation(data: any): Promise<Location>;
  updateLocation(id: string, data: any, orgId: string): Promise<Location>;
  deleteLocation(id: string, orgId: string): Promise<void>;
  setDefaultLocation(id: string, orgId: string): Promise<Location>;

  // Loyalty operations
  getLoyaltyTiers(orgId: string): Promise<LoyaltyTier[]>;
  createLoyaltyTier(data: InsertLoyaltyTier): Promise<LoyaltyTier>;
  updateLoyaltyTier(id: string, data: Partial<InsertLoyaltyTier>, orgId: string): Promise<LoyaltyTier>;
  deleteLoyaltyTier(id: string, orgId: string): Promise<void>;
  updateCustomerTier(customerId: string): Promise<Customer>;

  // Promotions operations
  getPromotions(orgId: string, active?: boolean): Promise<Promotion[]>;
  createPromotion(data: InsertPromotion): Promise<Promotion>;
  updatePromotion(id: string, data: Partial<InsertPromotion>, orgId: string): Promise<Promotion>;
  deletePromotion(id: string, orgId: string): Promise<void>;
  validatePromoCode(code: string, orgId: string): Promise<Promotion | null>;
  applyPromotion(orderId: string, promoCode: string): Promise<number>;

  // Expense operations
  getOverheadExpenses(orgId: string): Promise<OverheadExpense[]>;
  createOverheadExpense(data: InsertOverheadExpense): Promise<OverheadExpense>;
  updateOverheadExpense(id: string, data: Partial<InsertOverheadExpense>, orgId: string): Promise<OverheadExpense>;
  deleteOverheadExpense(id: string, orgId: string): Promise<void>;
  getOrderExpenses(orderId: string, orgId: string): Promise<OrderExpense[]>;
  createOrderExpenses(orderId: string, expenses: InsertOrderExpense[], orgId: string): Promise<void>;
  getExpenseAnalytics(startDate: Date, endDate: Date, orgId: string): Promise<{
    overheadTotal: number;
    orderExpenseTotal: number;
    totalExpenses: number;
    dailyOverhead: number;
    overheadBreakdown: any[];
  }>;
  getExpenseReport(startDate: Date, endDate: Date, orgId: string): Promise<any>;
  getProfitAnalysis(startDate: Date, endDate: Date, orgId: string): Promise<any>;

  // Invoice operations
  getInvoicesWithDetails(orgId: string): Promise<any[]>;

  // Allow list operations
  isUserAllowed(authSubjectId: string): Promise<boolean>;
  getUserRoleAndOrg(authSubjectId: string): Promise<{ role: string; orgId: string | null } | null>;
  findAllowedUserByAuthSubject(authSubjectId: string): Promise<AllowedUser | null>;
  tryLinkAuthUserByEmail(params: {
    email: string;
    newAuthUserId: string;
    authProvider: string;
  }): Promise<{ linked: boolean; reason?: string }>;
  getAllowedUsers(orgId: string): Promise<AllowedUser[]>;
  /** SUPER_ADMIN cross-tenant reads only. */
  adminGetAllAllowedUsers(): Promise<AllowedUser[]>;
  addAllowedUser(data: InsertAllowedUser): Promise<AllowedUser>;
  removeAllowedUser(replitUserId: string): Promise<void>;
  getOwner(): Promise<AllowedUser | null>;
  updateAllowedUserAccess(
    replitUserId: string,
    updates: { role?: string; orgId?: string | null },
    actor: { role: string; orgId: string | null; replitUserId: string },
  ): Promise<AllowedUser>;

  // Organization operations
  listOrganizations(): Promise<Organization[]>;
  getOrganization(id: string): Promise<Organization | null>;
  createOrganization(name: string): Promise<Organization>;
  updateOrganizationName(id: string, name: string): Promise<Organization>;
  countOrganizations(): Promise<number>;
  countAllowedUsers(): Promise<number>;

  // Approval request operations
  getPendingApprovals(): Promise<UserApprovalRequest[]>;
  getApprovalRequest(replitUserId: string): Promise<UserApprovalRequest | null>;
  createApprovalRequest(data: InsertUserApprovalRequest): Promise<UserApprovalRequest>;
  approveUser(
    replitUserId: string,
    approvedBy: string,
    options?: { role?: string; orgId?: string | null },
  ): Promise<void>;
  rejectUser(replitUserId: string, rejectedBy: string): Promise<void>;

  insertAdminAuditLog(row: InsertAdminAuditLog): Promise<void>;
  listAdminAuditLogs(opts: { limit: number; offset: number }): Promise<AdminAuditLog[]>;

  getFeatureFlag(orgId: string, flag: string): Promise<FeatureFlag | undefined>;
  listFeatureFlagsForOrg(orgId: string): Promise<FeatureFlag[]>;
  upsertFeatureFlag(orgId: string, flag: string, enabled: boolean): Promise<FeatureFlag>;

  createApiKeyForOrg(
    orgId: string,
    name: string,
    scopes?: string[],
  ): Promise<{ id: string; name: string; keyLookup: string; plainKey: string; createdAt: Date | null }>;
  listApiKeysForOrg(orgId: string): Promise<ApiKey[]>;
  revokeApiKey(id: string, orgId: string): Promise<void>;
  verifyApiKeyAndGetOrg(plainToken: string): Promise<{ orgId: string; scopes: string[]; keyId?: string } | null>;
  getProductsForOrgPublic(orgId: string): Promise<Product[]>;

  createOutboundWebhook(
    orgId: string,
    input: { url: string; secret: string; eventTypes?: string[] },
  ): Promise<OutboundWebhook>;
  listOutboundWebhooksForOrg(orgId: string): Promise<OutboundWebhook[]>;
  listActiveOutboundWebhooksForOrg(orgId: string): Promise<OutboundWebhook[]>;
}

/** An approve/reject on a request that is not a pending, unclaimed sign-up. */
export class ApprovalStateError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalStateError";
  }
}

export class AmbiguousStockLocationError extends Error {
  constructor() {
    super("Choose a location before editing stock for a multi-location organization");
    this.name = "AmbiguousStockLocationError";
  }
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    return withRetries(async () => {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user;
    });
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const subjectId = userData.id ?? (userData as { replitUserId?: string }).replitUserId;
    if (!subjectId) throw new Error("upsertUser requires id");
    const authProvider =
      (userData as { authProvider?: string }).authProvider ?? "replit";
    const authUserId =
      (userData as { authUserId?: string }).authUserId ?? subjectId;
    return withRetries(async () => {
      const [user] = await db
        .insert(users)
        .values({
          ...userData,
          id: subjectId,
          replitUserId: (userData as { replitUserId?: string }).replitUserId ?? subjectId,
          authProvider,
          authUserId,
        } as typeof users.$inferInsert)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: userData.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            updatedAt: new Date(),
          },
        })
        .returning();
      return user;
    });
  }

  async getTopCustomers(limit: number = 10, orgId: string): Promise<
    Array<{
      customer: Customer;
      metrics: CustomerMetric | null;
    }>
  > {
    return withRetries(async () => {
      const base = db
        .select({
          customer: customers,
          metrics: customerMetrics,
        })
        .from(customers)
        .leftJoin(
          customerMetrics,
          eq(customers.id, customerMetrics.customerId)
        );
      // NULLS LAST is load-bearing, not tidiness. Postgres sorts NULLs FIRST
      // under DESC, and this is a LEFT JOIN, so every customer who has never
      // bought anything has clv = NULL and was ranked ABOVE the paying ones.
      // On a real dataset the "Top Customers" table showed nothing but people
      // who had never placed an order, and the actual best customers fell off
      // the end of the limit.
      const results = await base
        .where(eq(customers.orgId, orgId))
        .orderBy(sql`${customerMetrics.clv} DESC NULLS LAST`)
        .limit(limit);
      return results;
    });
  }

  async getDailyRevenue(days: number = 30, orgId: string): Promise<
    Array<{
      date: string;
      totalOrders: number;
      totalRevenue: string;
    }>
  > {
    return withRetries(async () => {
      // Same definition as the Control Centre card — see services/revenue.ts.
      // This read the analytics_daily projection, which books revenue on
      // OrderCreated with no status filter, so this chart and that card
      // disagreed about the same day by design.
      const { settledRevenueByDay } = await import("./services/revenue");
      const { offsetDate } = await import("@shared/analytics/kpi");

      const today = new Date();
      const toDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const fromDate = offsetDate(toDate, -(days - 1));
      const byDay = await settledRevenueByDay(orgId, fromDate, toDate);

      // A contiguous series: a day with no takings is a real zero, and a chart
      // that silently omits it draws a misleading line between the days either
      // side of it.
      const out: Array<{ date: string; totalOrders: number; totalRevenue: string }> = [];
      for (let i = 0; i < days; i++) {
        const date = offsetDate(fromDate, i);
        const day = byDay.get(date);
        out.push({
          date,
          totalOrders: day?.txns ?? 0,
          totalRevenue: (day?.revenue ?? 0).toFixed(2),
        });
      }
      return out;
    });
  }

  async getMonthlySummary(months: number = 12, orgId: string): Promise<
    Array<{
      year: number;
      month: number;
      totalOrders: number;
      totalRevenue: string;
    }>
  > {
    return withRetries(async () => {
      // Rolled up from the same daily figures the Control Centre shows, so a
      // month always equals the sum of its days. analytics_monthly was
      // accumulated independently of analytics_daily from the same events,
      // which meant the two could — and did — drift apart.
      const { settledRevenueByMonth } = await import("./services/revenue");
      const rows = await settledRevenueByMonth(orgId, months);
      return rows.map((r) => ({
        year: r.year,
        month: r.month,
        totalOrders: r.txns,
        totalRevenue: r.revenue.toFixed(2),
      }));
    });
  }

  async getProducts(orgId: string): Promise<Product[]> {
    return withRetries(async () => {
      return await db.select().from(products).where(eq(products.orgId, orgId)).orderBy(products.name);
    });
  }

  async createProduct(data: InsertProduct): Promise<Product> {
    // Validate data before insertion. This flow is intentionally not wrapped in
    // withRetries: replaying a successful insert after a transient post-insert
    // failure can create duplicate catalog rows.
    if (!data.name || data.name.trim().length === 0) {
      throw new Error('Product name is required');
    }
    // products.org_id is nullable, so an insert that omits it succeeds and
    // creates a product owned by no tenant — invisible to every org-scoped
    // query, and skipped by the location-stock setup below, which already
    // guards with `if (product.orgId)`. That guard treats a missing org as a
    // normal case rather than the defect it is: the product exists in the
    // catalogue with no stock row anywhere, so it can never be sold or counted.
    //
    // Rejecting here rather than at the column: making org_id NOT NULL is the
    // right end state but needs a backfill first, and invoices already show
    // what happens when orphans accumulate ahead of that constraint.
    if (!data.orgId) {
      throw new Error('Product requires an organisation — refusing to create an unowned product');
    }
    if (data.defaultSalePrice !== undefined && safeParseFloat(data.defaultSalePrice) < 0) {
      throw new Error('Product price cannot be negative');
    }
    if (data.stock !== undefined && safeParseInt(data.stock) < 0) {
      throw new Error('Stock cannot be negative');
    }

    const [product] = await db.insert(products).values(data).returning();
    if (product.orgId) {
      const { ensureProductLocationStockRow, syncLegacyProductStockPlaceholder, resolveProductLocationForBackfill } =
        await import("./services/productLocationStock");
      const resolved = await resolveProductLocationForBackfill(product.orgId, {
        id: product.id,
        locationId: product.locationId,
        stock: product.stock,
        stockLimit: product.stockLimit,
      });
      if (!("skip" in resolved)) {
        await ensureProductLocationStockRow(
          product.orgId,
          product.id,
          resolved.locationId,
          product.stock ?? 0,
          product.stockLimit ?? 10,
        );
        await syncLegacyProductStockPlaceholder(product.id);
      }
    }
    return product;
  }

  async updateProduct(id: string, data: any): Promise<Product> {
    const [product] = await db.update(products).set({ ...data, updatedAt: new Date() }).where(eq(products.id, id)).returning();
    return product!;
  }

  async updateProductWebsiteSettings(
    id: string,
    orgId: string,
    patch: WebsiteProductSettingsPatch,
  ): Promise<Product | null> {
    const [product] = await db
      .update(products)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(products.id, id), eq(products.orgId, orgId)))
      .returning();
    return product ?? null;
  }

  async deleteProduct(id: string, orgId: string): Promise<void> {
    const [deleted] = await db.delete(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).returning();
    if (!deleted) throw new Error('Product not found');
  }

  async getProduct(id: string, orgId: string): Promise<Product | null> {
    const [product] = await db.select().from(products).where(and(eq(products.id, id), eq(products.orgId, orgId)));
    return product || null;
  }

  /** Update a product's WhatsApp/order-intent aliases (org-scoped). */
  async updateProductAliases(id: string, orgId: string, aliases: string[]): Promise<Product | null> {
    const [product] = await db
      .update(products)
      .set({ aliases, updatedAt: new Date() })
      .where(and(eq(products.id, id), eq(products.orgId, orgId)))
      .returning();
    return product || null;
  }

  async importProducts(
    productList: any[],
    orgId: string,
    options?: ProductImportOptions,
  ): Promise<{ imported: number; skipped: number; failed: number; errors: string[] }> {
    if (!options?.confirmed) {
      throw new Error("Import requires confirmed preview (confirmed: true)");
    }
    const duplicateMode = options.duplicateMode ?? "skip";
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const productData of productList) {
      try {
        const salePrice =
          parseImportNumber(
            productData.defaultSalePrice ?? productData.salePrice ?? productData.price,
          );
        // Blank or missing cost is "not known": a new product stores NULL and
        // an overwrite keeps the cost already there. It used to become £0,
        // so re-importing a price list without a cost column wiped every cost.
        const costPrice = parseImportNumber(
          productData.costPrice ?? productData.tax,
        );
        // Blank or missing keeps the stored minimum; the clear token clears it.
        const minCell = parseMinPriceCell(productData.minPrice);
        const stock =
          productData.stock !== undefined ? parseImportInteger(productData.stock) : undefined;
        const stockLimit =
          productData.stockLimit !== undefined
            ? parseImportInteger(productData.stockLimit)
            : undefined;

        if (!productData.name?.trim() || salePrice === undefined) {
          errors.push(
            `Row ${failed + imported + skipped + 1}: Missing name or invalid sale price (use numbers only, e.g. 9.99)`,
          );
          failed++;
          continue;
        }

        if (minCell === "invalid") {
          errors.push(
            `Row ${failed + imported + skipped + 1}: Invalid minimum price (a number, blank to keep, or ${MIN_PRICE_CLEAR_TOKEN} to clear)`,
          );
          failed++;
          continue;
        }
        if (minCell !== undefined && !canEditMinPrice(options.role)) {
          errors.push(`Row ${failed + imported + skipped + 1}: Only a manager or an admin can set a minimum price`);
          failed++;
          continue;
        }

        productData.defaultSalePrice = salePrice;
        if (stock !== undefined) productData.stock = stock;
        if (stockLimit !== undefined) productData.stockLimit = stockLimit;

        let existingProduct = null;
        const sku = productData.productId?.trim();
        if (sku) {
          const existCond = orgId
            ? and(eq(products.productId, sku), eq(products.orgId, orgId))
            : eq(products.productId, sku);
          [existingProduct] = await db.select().from(products).where(existCond);
        }

        if (existingProduct) {
          if (duplicateMode !== "overwrite") {
            skipped++;
            continue;
          }
          const nextMin = minCell === undefined ? existingProduct.minPrice : minCell == null ? null : String(minCell);
          const minProblem = checkMinPrice(nextMin, salePrice);
          if (minProblem) {
            errors.push(`Row ${failed + imported + skipped + 1}: ${minProblem.message}`);
            failed++;
            continue;
          }
          const updatedProduct = await db.transaction(async (tx) => {
            const [row] = await tx
              .update(products)
              .set({
                name: productData.name,
                barcode: productData.barcode ?? existingProduct.barcode,
                defaultSalePrice: String(salePrice),
                costPrice: costPrice !== undefined ? String(costPrice) : existingProduct.costPrice,
                minPrice: nextMin,
                stock: 0,
                stockLimit: productData.stockLimit ?? existingProduct.stockLimit,
                locationId: productData.locationId ?? existingProduct.locationId,
                updatedAt: new Date(),
              })
              .where(eq(products.id, existingProduct.id))
              .returning();
            if (row && orgId) {
              await recordPriceChanges(tx, {
                orgId,
                productId: row.id,
                before: existingProduct,
                after: row,
                changedBy: options.actorId ?? null,
                source: "import",
              });
            }
            return row;
          });
          if (orgId && updatedProduct) {
            const { ensureProductLocationStockRow, resolveProductLocationForBackfill, adjustProductLocationStock } =
              await import("./services/productLocationStock");
            const resolved = await resolveProductLocationForBackfill(orgId, {
              id: updatedProduct.id,
              locationId: updatedProduct.locationId,
              stock: productData.stock ?? existingProduct.stock,
              stockLimit: updatedProduct.stockLimit,
            });
            if (!("skip" in resolved)) {
              await ensureProductLocationStockRow(orgId, updatedProduct.id, resolved.locationId, 0, updatedProduct.stockLimit ?? 10);
              if (productData.stock !== undefined) {
                await adjustProductLocationStock({
                  orgId,
                  productId: updatedProduct.id,
                  locationId: resolved.locationId,
                  setStock: Number(productData.stock),
                  movement: {
                    reason: "adjustment",
                    correlationId: `import-${updatedProduct.id}`,
                    eventId: `import-${Date.now()}`,
                    sku: updatedProduct.productId,
                  },
                });
              }
            }
          }
          imported++;
        } else {
          const newMin = typeof minCell === "number" ? minCell : null;
          const minProblem = checkMinPrice(newMin, salePrice);
          if (minProblem) {
            errors.push(`Row ${failed + imported + skipped + 1}: ${minProblem.message}`);
            failed++;
            continue;
          }
          const created = await db.transaction(async (tx) => {
            const [row] = await tx
              .insert(products)
              .values({
                productId: sku || `PRD-${Date.now()}-${imported}`,
                name: productData.name,
                barcode: productData.barcode,
                defaultSalePrice: String(salePrice),
                costPrice: costPrice !== undefined ? String(costPrice) : null,
                minPrice: newMin == null ? null : String(newMin),
                stock: 0,
                stockLimit: productData.stockLimit ?? 100,
                locationId: productData.locationId,
                orgId: orgId ?? undefined,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            if (row && orgId) {
              await recordPriceChanges(tx, {
                orgId,
                productId: row.id,
                before: {},
                after: row,
                changedBy: options.actorId ?? null,
                source: "import",
              });
            }
            return row;
          });
          if (orgId && created) {
            const { ensureProductLocationStockRow, resolveProductLocationForBackfill, adjustProductLocationStock } =
              await import("./services/productLocationStock");
            const resolved = await resolveProductLocationForBackfill(orgId, {
              id: created.id,
              locationId: created.locationId,
              stock: productData.stock ?? 0,
              stockLimit: created.stockLimit,
            });
            if (!("skip" in resolved)) {
              await ensureProductLocationStockRow(
                orgId,
                created.id,
                resolved.locationId,
                Number(productData.stock ?? 0),
                created.stockLimit ?? 10,
              );
              await adjustProductLocationStock({
                orgId,
                productId: created.id,
                locationId: resolved.locationId,
                setStock: Number(productData.stock ?? 0),
                movement: {
                  reason: "adjustment",
                  correlationId: `import-${created.id}`,
                  eventId: `import-${Date.now()}`,
                  sku: created.productId,
                },
              });
            }
          }
          imported++;
        }
      } catch (error: any) {
        errors.push(`Row ${failed + imported + skipped + 1}: ${error.message}`);
        failed++;
      }
    }

    return { imported, skipped, failed, errors };
  }

  async importCustomers(
    customerList: any[],
    orgId: string,
    options?: { duplicateMode?: "skip" | "merge" | "overwrite"; confirmed?: boolean },
  ): Promise<{ imported: number; skipped: number; merged: number; failed: number; errors: string[] }> {
    if (!options?.confirmed) {
      throw new Error("Import requires confirmed preview (confirmed: true)");
    }
    const duplicateMode = options.duplicateMode ?? "skip";
    const existing = await this.getCustomers(orgId);
    let imported = 0;
    let skipped = 0;
    let merged = 0;
    let failed = 0;
    const errors: string[] = [];

    const { findCustomerDuplicate } = await import("./import/customerImport");

    for (const row of customerList) {
      try {
        if (!row.name) {
          errors.push(`Row ${failed + imported + skipped + merged + 1}: Name is required`);
          failed++;
          continue;
        }
        const dup = findCustomerDuplicate(row, existing);
        if (dup) {
          if (duplicateMode === "skip") {
            skipped++;
            continue;
          }
          if (duplicateMode === "merge") {
            await db
              .update(customers)
              .set({
                name: row.name || dup.name,
                email: row.email ?? dup.email,
                phone: row.phone ?? dup.phone,
                address: row.address ?? dup.address,
                category: row.category ?? dup.category,
                updatedAt: new Date(),
              })
              .where(and(eq(customers.id, dup.id), eq(customers.orgId, orgId)));
            merged++;
            continue;
          }
          await db
            .update(customers)
            .set({
              name: row.name,
              email: row.email ?? null,
              phone: row.phone ?? null,
              address: row.address ?? null,
              category: row.category ?? dup.category,
              updatedAt: new Date(),
            })
            .where(and(eq(customers.id, dup.id), eq(customers.orgId, orgId)));
          imported++;
          continue;
        }
        const [created] = await db
          .insert(customers)
          .values({
            orgId,
            name: row.name,
            email: row.email ?? null,
            phone: row.phone ?? null,
            address: row.address ?? null,
            category: row.category ?? "Bronze",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        existing.push(created);
        imported++;
      } catch (error: any) {
        errors.push(`Row ${failed + imported + skipped + merged + 1}: ${error.message}`);
        failed++;
      }
    }

    return { imported, skipped, merged, failed, errors };
  }

  async getOrgProfile(orgId: string): Promise<Organization | null> {
    return this.getOrganization(orgId);
  }

  async updateOrgProfile(orgId: string, patch: Record<string, unknown>): Promise<Organization> {
    const allowed: Record<string, unknown> = {};
    const keys = [
      "name", "tradingName", "email", "phone", "address", "vatNumber", "companyNumber",
      "currency", "timezone", "businessType", "logoUrl", "invoiceTemplate", "invoicePrefix",
      "invoiceStartNumber", "paymentTerms", "defaultTaxRate", "receiptFooter", "receiptStyle",
      "receiptTemplateHtml",
      "accentStyle", "businessColors", "setupWizardState", "onboardingState",
      "receiptLogoEnabled", "invoiceLogoEnabled",
      "invoiceBankName", "invoiceBankSortCode", "invoiceBankAccountNumber", "invoicePaymentLink",
      "cashierCommissionEnabled", "defaultCashierCommissionRate", "requireCashierForSale",
      "shiftInactivityCloseAfter", "globalExpenseAllocationMode",
      // Operations Centre timing policy (migration 065). This list is an
      // allow-list, not a filter of known-bad keys: anything absent from it is
      // dropped in silence, so a setting wired into the schema and the card but
      // missed here would save, toast "updated", and change nothing.
      "opsPrepSlaMinutes", "opsDueSoonLeadMinutes", "opsLateGraceMinutes",
      "opsDeliveryLeadMinutes", "opsAutoClaimOnCreate", "opsReconcilePollSeconds",
      "opsAlertOnSlaDue", "opsKeepScreenAwake",
      // Shop privacy notice + complaints contact (migration 073).
      "privacyNoticeUrl", "privacyNoticeText", "complaintsContactName", "complaintsContactEmail",
    ];
    for (const k of keys) {
      if (patch[k] !== undefined) allowed[k] = patch[k];
    }
    // Commission rates are agreed per cashier and land on figures like 12 or
    // 25, so any rate is valid — but it still has to be a rate. A rate outside
    // 0–100 would silently distort every pool derived from it.
    if (allowed.defaultCashierCommissionRate !== undefined) {
      const parsed = commissionRateSchema.safeParse(allowed.defaultCashierCommissionRate);
      if (!parsed.success) {
        throw new Error(parsed.error.errors[0]?.message ?? "Invalid commission rate");
      }
      allowed.defaultCashierCommissionRate = String(parsed.data);
    }
    const [org] = await db
      .update(organizations)
      .set({ ...allowed, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!org) throw new Error("Organization not found");
    return org;
  }

  async updateOnboardingState(orgId: string, state: Record<string, unknown>): Promise<Organization> {
    const [org] = await db
      .update(organizations)
      .set({ onboardingState: state, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!org) throw new Error("Organization not found");
    return org;
  }

  async completeOrgSetup(orgId: string): Promise<Organization> {
    const [org] = await db
      .update(organizations)
      .set({ setupComplete: 1, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!org) throw new Error("Organization not found");
    return org;
  }

  async getImportHistory(orgId: string, limit = 50): Promise<ImportHistory[]> {
    return db
      .select()
      .from(importHistory)
      .where(eq(importHistory.orgId, orgId))
      .orderBy(desc(importHistory.createdAt))
      .limit(limit);
  }

  async recordImportHistory(data: InsertImportHistory): Promise<ImportHistory> {
    const [row] = await db.insert(importHistory).values(data).returning();
    return row;
  }

  async getCustomers(orgId: string): Promise<Customer[]> {
    return await db.select().from(customers).where(eq(customers.orgId, orgId)).orderBy(customers.name);
  }

  async createCustomer(data: any): Promise<Customer> {
    const [customer] = await db
      .insert(customers)
      .values({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return customer;
  }

  async updateCustomer(id: string, data: any): Promise<Customer> {
    const [customer] = await db.update(customers).set({ ...data, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
    return customer!;
  }

  async deleteCustomer(id: string, orgId: string): Promise<void> {
    const [deleted] = await db.delete(customers).where(and(eq(customers.id, id), eq(customers.orgId, orgId))).returning();
    if (!deleted) throw new Error('Customer not found');
  }

  async getCustomer(id: string, orgId: string): Promise<Customer | null> {
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, orgId)));
    return customer || null;
  }

  // storage.createOrder was removed here. It was dead code — nothing called it —
  // and it carried its own explicit insert values list for the orders table, so
  // it was a fifth place a new order column had to be threaded to avoid being
  // silently dropped. Orders are created through the domain engine
  // (engine.placeOrder -> OrdersRepoDrizzle.save), which is the only write path.

  async getProductsWithStock(orgId: string, locationId?: string | null): Promise<Product[]> {
    const { productLocationStock } = await import("@shared/schema");
    const base = await db.select().from(products).where(eq(products.orgId, orgId)).orderBy(products.name);

    const stockRows = locationId
      ? await db
          .select({
            productId: productLocationStock.productId,
            total: productLocationStock.stock,
          })
          .from(productLocationStock)
          .where(
            and(
              eq(productLocationStock.orgId, orgId),
              eq(productLocationStock.locationId, locationId),
            ),
          )
      : await db
          .select({
            productId: productLocationStock.productId,
            total: sql<number>`COALESCE(SUM(${productLocationStock.stock}), 0)`.as("total"),
          })
          .from(productLocationStock)
          .where(eq(productLocationStock.orgId, orgId))
          .groupBy(productLocationStock.productId);

    const stockMap = new Map(stockRows.map((t) => [t.productId, Number(t.total) || 0]));

    return base.map((p) => ({
      ...p,
      stock: stockMap.has(p.id) ? stockMap.get(p.id)! : 0,
    }));
  }

  async updateProductStock(
    productId: string, 
    adjustment: number, 
    type: 'add' | 'set',
    userId: string,
    orgId: string,
    locationId?: string | null,
  ): Promise<Product> {
    const { adjustProductLocationStock, resolveStockLocationId } = await import(
      "./services/productLocationStock",
    );

    if (!locationId) {
      const activeLocations = await db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.orgId, orgId), eq(locations.isActive, 1)));
      if (activeLocations.length > 1) {
        throw new AmbiguousStockLocationError();
      }
    }

    const locId = await resolveStockLocationId({ orgId, userId, locationId });

    const cond = and(eq(products.id, productId), eq(products.orgId, orgId));
    const [currentProduct] = await db.select().from(products).where(cond);
    if (!currentProduct) throw new Error("Product not found");

    const [row] = await db
      .select()
      .from(productLocationStock)
      .where(
        and(
          eq(productLocationStock.orgId, orgId),
          eq(productLocationStock.productId, productId),
          eq(productLocationStock.locationId, locId),
        ),
      )
      .limit(1);

    const current = row?.stock ?? 0;
    const target = type === "set" ? adjustment : current + adjustment;

    await adjustProductLocationStock({
      orgId,
      productId,
      locationId: locId,
      setStock: type === "set" ? target : undefined,
      delta: type === "add" ? adjustment : target - current,
      allowNegative: false,
      movement: {
        reason: "adjustment",
        correlationId: `manual-${productId}`,
        eventId: `manual-${Date.now()}`,
        sku: currentProduct.productId,
      },
    });

    const [updatedProduct] = await db.select().from(products).where(cond);
    const totals = await db
      .select({
        total: sql<number>`COALESCE(SUM(${productLocationStock.stock}), 0)`.as("total"),
      })
      .from(productLocationStock)
      .where(and(eq(productLocationStock.orgId, orgId), eq(productLocationStock.productId, productId)));

    return {
      ...updatedProduct!,
      stock: Number(totals[0]?.total) || 0,
    };
  }

  async getReportData(fromDate: Date, toDate: Date, orgId: string): Promise<any> {
    const [
      revenueData,
      orderData, 
      customerData,
      inventoryData
    ] = await Promise.all([
      this.getRevenueReports(fromDate, toDate, orgId),
      this.getOrderReports(fromDate, toDate, orgId),
      this.getCustomerReports(fromDate, toDate, orgId),
      this.getInventoryReports(fromDate, toDate, orgId)
    ]);

    return {
      revenue: revenueData,
      orders: orderData,
      customers: customerData,
      inventory: inventoryData
    };
  }

  /**
   * ARC-020: this used to count every order in the date range regardless of
   * status — pending, on-hold and cancelled orders all added to "revenue" —
   * and never netted refunds, so the Truths hub disagreed with Control Centre
   * about the same range (one live example: 77 of 85 seed orders were
   * `pending` and were still being counted as takings). Rebuilt on
   * {@link settledRevenueByDay} — settled orders only, valued at the
   * settlement snapshot, net of refunds issued — the same definition Control
   * Centre and Daily/Weekly Sales use.
   */
  private async getRevenueReports(fromDate: Date, toDate: Date, orgId: string) {
    const { settledRevenueByDay } = await import("./services/revenue");
    const { offsetDate } = await import("@shared/analytics/kpi");

    const fromIso = fromDate.toISOString().slice(0, 10);
    const toIso = toDate.toISOString().slice(0, 10);
    const byDay = await settledRevenueByDay(orgId, fromIso, toIso);

    let total = 0;
    const dailyRevenue: Array<{ date: string; revenue: number; orders: number }> = [];
    for (let d = fromIso; d <= toIso; d = offsetDate(d, 1)) {
      const kpi = byDay.get(d);
      const revenue = kpi?.revenue ?? 0;
      total += revenue;
      dailyRevenue.push({ date: d, revenue, orders: kpi?.txns ?? 0 });
    }

    // Payment-method split — scoped to the same settled window as `total`, so
    // it no longer disagrees with it by including open or cancelled orders.
    // Refunds are netted into `total` above, not per method here.
    const settledCond = and(
      eq(orders.orgId, orgId),
      eq(orders.status, "completed"),
      gte(sql`date(${orders.settledAt})`, sql`${fromIso}::date`),
      lte(sql`date(${orders.settledAt})`, sql`${toIso}::date`),
    );
    const byPaymentMethod = await db
      .select({
        method: orders.paymentMethod,
        count: sql<number>`COUNT(*)`.as('count'),
        revenue: sql<number>`COALESCE(SUM(CAST(COALESCE(${orders.settledTotal}, ${orders.total}) AS DECIMAL)), 0)`.as('revenue')
      })
      .from(orders)
      .where(settledCond)
      .groupBy(orders.paymentMethod);

    // ARC-030: this used to always return [], so the Truths hub's "Revenue by
    // category" pie chart was permanently empty. `products.website_category`
    // is the only real category field on the product (see shared/schema.ts) —
    // not every product has one set, so an uncategorised product's revenue is
    // grouped under a real, visible "Uncategorised" bucket rather than
    // silently vanishing from the total the pie chart's slices should sum to.
    const categoryRows = await db
      .select({
        category: sql<string>`COALESCE(${products.websiteCategory}, 'Uncategorised')`.as('category'),
        revenue: sql<number>`COALESCE(SUM(CAST(${orderItems.totalPrice} AS DECIMAL)), 0)`.as('revenue'),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(settledCond)
      .groupBy(sql`COALESCE(${products.websiteCategory}, 'Uncategorised')`)
      .orderBy(sql`COALESCE(SUM(CAST(${orderItems.totalPrice} AS DECIMAL)), 0) DESC`);
    const byCategory = categoryRows.map((r) => {
      const revenue = parseFloat(String(r.revenue)) || 0;
      return { category: r.category, revenue, percentage: total ? (revenue / total) * 100 : 0 };
    });

    // Of which delivery fees (v1.2.1), shown on their own on Sales at a glance.
    const { deliveryFeeTakingsByDate } = await import("./services/deliveryFeeTakings");
    const fees = await deliveryFeeTakingsByDate(orgId, fromIso, toIso);

    return {
      total,
      deliveryFees: fees.total,
      deliveryFeeOrders: fees.orders,
      byDay: dailyRevenue,
      byCategory,
      byPaymentMethod
    };
  }

  /** ARC-020: order count, AOV and top products now scope to settled orders — see {@link getRevenueReports}. */
  private async getOrderReports(fromDate: Date, toDate: Date, orgId: string) {
    const { settledRevenueByDay } = await import("./services/revenue");

    const fromIso = fromDate.toISOString().slice(0, 10);
    const toIso = toDate.toISOString().slice(0, 10);
    const byDay = await settledRevenueByDay(orgId, fromIso, toIso);

    let totalOrders = 0;
    let totalRevenue = 0;
    for (const kpi of byDay.values()) {
      totalOrders += kpi.txns;
      totalRevenue += kpi.revenue;
    }
    const average = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const settledCond = and(
      eq(orders.orgId, orgId),
      eq(orders.status, "completed"),
      gte(sql`date(${orders.settledAt})`, sql`${fromIso}::date`),
      lte(sql`date(${orders.settledAt})`, sql`${toIso}::date`),
    );
    const topProducts = await db
      .select({
        name: products.name,
        quantity: sql<number>`SUM(${orderItems.quantity})`.as('quantity'),
        revenue: sql<number>`SUM(CAST(${orderItems.totalPrice} AS DECIMAL))`.as('revenue')
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(settledCond)
      .groupBy(products.name)
      .orderBy(sql`SUM(${orderItems.quantity}) DESC`)
      .limit(10);

    // Bucketed by SETTLED time, not created_at: a backdated or pre-order sale
    // carries a noon-local placeholder stamp on created_at (ARC-028's "11:00"
    // bug in the dedicated Busiest Hours report), while settled_at is always
    // the real wall-clock moment the order was completed.
    const hourlyDistribution = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${orders.settledAt})`.as('hour'),
        count: sql<number>`COUNT(*)`.as('count')
      })
      .from(orders)
      .where(settledCond)
      .groupBy(sql`EXTRACT(HOUR FROM ${orders.settledAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${orders.settledAt})`);

    return {
      total: totalOrders,
      average,
      topProducts,
      hourlyDistribution
    };
  }

  private async getCustomerReports(fromDate: Date, toDate: Date, orgId: string) {
    const dateCond = sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`;
    const orderWhereCond = and(dateCond, eq(orders.orgId, orgId));
    const custDateCond = sql`${customers.createdAt} >= ${fromDate} AND ${customers.createdAt} <= ${toDate}`;
    const custWhereCond = and(custDateCond, eq(customers.orgId, orgId));
    const totalCustomers = await db
      .select({ total: sql<number>`COUNT(DISTINCT ${orders.customerId})` })
      .from(orders)
      .where(orderWhereCond);
    const newCustomers = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${customers.id})` })
      .from(customers)
      .where(custWhereCond);
    const topCustomers = await db
      .select({
        name: customers.name,
        orders: sql<number>`COUNT(${orders.id})`.as('orders'),
        revenue: sql<number>`SUM(CAST(${orders.total} AS DECIMAL))`.as('revenue'),
        loyalty: customers.loyaltyPoints
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(orderWhereCond)
      .groupBy(customers.id, customers.name, customers.loyaltyPoints)
      .orderBy(sql`SUM(CAST(${orders.total} AS DECIMAL)) DESC`)
      .limit(10);

    const total = totalCustomers[0]?.total || 0;
    const newCount = newCustomers[0]?.count || 0;

    // ARC-030: this used to always return [], so the Truths hub's "RFM
    // segments" table was permanently empty even though every org's real
    // segmentation already lives in `customer_rfm` (populated by
    // recomputeOrgRfm — see server/lib/rfmService.ts, the same table
    // analytics/rfm.tsx reads). Not scoped to fromDate/toDate: a segment is a
    // customer's current standing, not an event that happened within a
    // window — the same way analytics/rfm.tsx shows one org-wide snapshot.
    const rfmRows = await db
      .select({
        segment: customerRfm.segment,
        count: sql<number>`COUNT(*)`.as('count'),
        avgRevenue: sql<number>`COALESCE(AVG(CAST(${customers.totalSpent} AS DECIMAL)), 0)`.as('avgRevenue'),
      })
      .from(customerRfm)
      .innerJoin(customers, eq(customers.id, customerRfm.customerId))
      .where(eq(customerRfm.orgId, orgId))
      .groupBy(customerRfm.segment);
    const rfmSegments = rfmRows.map((r) => ({
      segment: r.segment,
      count: Number(r.count) || 0,
      avgRevenue: parseFloat(String(r.avgRevenue)) || 0,
    }));

    return {
      total,
      new: newCount,
      returning: total - newCount,
      topCustomers,
      rfmSegments,
    };
  }

  private async getInventoryReports(fromDate: Date, toDate: Date, orgId: string) {
    // Stock is authoritative in productLocationStock; products.stock is a legacy
    // placeholder written as 0 by syncLegacyProductStockPlaceholder. Derive
    // valuation and counts from real per-location totals (same source as POS/inventory).
    const withStock = await this.getProductsWithStock(orgId);
    const stockByProduct = new Map(withStock.map((p) => [p.id, p.stock ?? 0]));

    const totalValue = withStock.reduce(
      (sum, p) => sum + (p.stock ?? 0) * (parseFloat(String(p.costPrice ?? 0)) || 0),
      0,
    );
    // ARC-030: this used its own 20% cutoff, so the same org's stock could
    // read "3 low stock" here and "5 low stock" on Control Centre in the same
    // moment. Both now read LOW_STOCK_THRESHOLD_PERCENT (30%) — the definition
    // Control Centre and /api/inventory/alerts already used — from one place.
    const lowStock = withStock.filter((p) => {
      const limit = p.stockLimit ?? 0;
      const s = p.stock ?? 0;
      return limit > 0 && s > 0 && s <= limit * (LOW_STOCK_THRESHOLD_PERCENT / 100);
    }).length;
    const outOfStock = withStock.filter((p) => (p.stock ?? 0) === 0).length;

    // Parenthesised: unwrapped, `and(...)` below read this as
    // "in range, OR (no order AND this org)", so every org's products with a
    // sale in the window reached this org's Evidence and its export.
    const topMovingCond = sql`(${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate} OR ${orders.createdAt} IS NULL)`;
    const topMovingWhere = and(topMovingCond, eq(products.orgId, orgId));
    const topMovingRaw = await db
      .select({
        productId: products.id,
        product: products.name,
        sold: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`.as('sold'),
      })
      .from(products)
      .leftJoin(orderItems, eq(products.id, orderItems.productId))
      .leftJoin(orders, eq(orderItems.orderId, orders.id))
      .where(topMovingWhere)
      .groupBy(products.id, products.name)
      .orderBy(sql`COALESCE(SUM(${orderItems.quantity}), 0) DESC`)
      .limit(10);
    const topMoving = topMovingRaw.map((r) => ({
      product: r.product,
      sold: r.sold,
      remaining: stockByProduct.get(r.productId) ?? 0,
    }));

    // ARC-030: this always returned 0, so the Truths hub's "Turnover" tile
    // permanently showed "0.0×" regardless of real sales. Org-wide turnover =
    // units sold across the period (settled orders only, matching the rest
    // of this report — ARC-020) divided by total units currently on hand.
    // Same shape as the per-category calc in shared/analytics/stockTurn.ts,
    // rolled up to one org-wide number instead of split by category.
    const totalStockOnHand = withStock.reduce((sum, p) => sum + (p.stock ?? 0), 0);
    const settledUnitsSoldRows = await db
      .select({ total: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)` })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.orgId, orgId),
          eq(orders.status, "completed"),
          gte(orders.settledAt, fromDate),
          lte(orders.settledAt, toDate),
        ),
      );
    const unitsSoldInPeriod = Number(settledUnitsSoldRows[0]?.total) || 0;
    const turnoverRate = totalStockOnHand > 0 ? Math.round((unitsSoldInPeriod / totalStockOnHand) * 10) / 10 : 0;

    return {
      totalValue,
      lowStock,
      outOfStock,
      turnoverRate,
      topMoving
    };
  }

  async generateCSVReport(data: any, type: string): Promise<string> {
    // The shared writer (FIX-14): a product or customer name starting with
    // "=" exports as text, every cell is quoted, and Excel reads it as UTF-8.
    const { csvDocument } = await import("@shared/csv");
    const byDay = (): unknown[][] =>
      (data.revenue?.byDay ?? []).map((day: any) => [day.date, day.revenue, day.orders]);

    switch (type) {
      case 'revenue':
        return csvDocument(['Date', 'Revenue', 'Orders'], byDay());
      case 'orders':
        return csvDocument(
          ['Product', 'Quantity', 'Revenue'],
          (data.orders?.topProducts ?? []).map((p: any) => [p.name, p.quantity, p.revenue]),
        );
      case 'customers':
        return csvDocument(
          ['Customer', 'Orders', 'Revenue', 'Loyalty Points'],
          (data.customers?.topCustomers ?? []).map((c: any) => [c.name, c.orders, c.revenue, c.loyalty]),
        );
      case 'inventory':
        return csvDocument(
          ['Product', 'Sold', 'Remaining'],
          (data.inventory?.topMoving ?? []).map((i: any) => [i.product, i.sold, i.remaining]),
        );
      case 'full':
        return csvDocument(['FULL REPORT'], [
          [],
          ['REVENUE SUMMARY'],
          ['Total Revenue', data.revenue?.total],
          [],
          ['Daily Revenue'],
          ['Date', 'Revenue', 'Orders'],
          ...byDay(),
        ]);
      default:
        return '';
    }
  }

  async generatePDFReport(data: any, type: string, period?: string): Promise<Buffer> {
    // Real, branded PDF via pdfkit. This previously returned CSV bytes under a
    // .pdf filename, producing a file that would not open.
    const { buildInsightsPdf } = await import("./services/reportPdf");
    return buildInsightsPdf(data, type, period);
  }

  async getLocations(orgId: string): Promise<Location[]> {
    const locs = await db
      .select()
      .from(locations)
      .where(eq(locations.orgId, orgId))
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

  /** Location list for the POS/shift pickers: no stats, no extra queries. */
  async getLocationPickerOptions(orgId: string): Promise<LocationPickerOption[]> {
    return db
      .select({
        id: locations.id,
        name: locations.name,
        isActive: locations.isActive,
        isDefault: locations.isDefault,
      })
      .from(locations)
      .where(eq(locations.orgId, orgId))
      .orderBy(desc(locations.isDefault), locations.name);
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

  async updateLocation(id: string, data: any, orgId: string): Promise<Location> {
    const cond = and(eq(locations.id, id), eq(locations.orgId, orgId));
    const [location] = await db
      .update(locations)
      .set({ ...data, isActive: data.isActive ? 1 : 0, updatedAt: new Date() })
      .where(cond)
      .returning();
    if (!location) throw new Error('Location not found');
    return location!;
  }

  async deleteLocation(id: string, orgId: string): Promise<void> {
    const cond = and(eq(locations.id, id), eq(locations.orgId, orgId));
    const [location] = await db.select().from(locations).where(cond);
    if (!location) throw new Error('Location not found');
    if (location.isDefault === 1) throw new Error("Cannot delete default location");
    await db.delete(locations).where(cond);
  }

  async setDefaultLocation(id: string, orgId: string): Promise<Location> {
    const cond = and(eq(locations.id, id), eq(locations.orgId, orgId));
    const [loc] = await db.select().from(locations).where(cond);
    if (!loc) throw new Error('Location not found');
    await db.transaction(async (tx) => {
      const unsetCond = and(eq(locations.isDefault, 1), eq(locations.orgId, orgId));
      await tx.update(locations).set({ isDefault: 0 }).where(unsetCond);
      await tx.update(locations).set({ isDefault: 1 }).where(cond);
    });
    const [location] = await db.select().from(locations).where(cond);
    return location!;
  }

  async getLoyaltyTiers(orgId: string): Promise<LoyaltyTier[]> {
    return db
      .select()
      .from(loyaltyTiers)
      .where(eq(loyaltyTiers.orgId, orgId))
      .orderBy(loyaltyTiers.pointsRequired);
  }

  async createLoyaltyTier(data: InsertLoyaltyTier): Promise<LoyaltyTier> {
    const [tier] = await db
      .insert(loyaltyTiers)
      .values(data)
      .returning();
    return tier;
  }

  async updateLoyaltyTier(id: string, data: Partial<InsertLoyaltyTier>, orgId: string): Promise<LoyaltyTier> {
    const cond = and(eq(loyaltyTiers.id, id), eq(loyaltyTiers.orgId, orgId));
    const [tier] = await db.update(loyaltyTiers).set({ ...data, updatedAt: new Date() }).where(cond).returning();
    if (!tier) throw new Error('Loyalty tier not found');
    return tier!;
  }

  async deleteLoyaltyTier(id: string, orgId: string): Promise<void> {
    const cond = and(eq(loyaltyTiers.id, id), eq(loyaltyTiers.orgId, orgId));
    const [d] = await db.delete(loyaltyTiers).where(cond).returning();
    if (!d) throw new Error('Loyalty tier not found');
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
  async getOverheadExpenses(orgId: string): Promise<any[]> {
    return db
      .select()
      .from(overheadExpenses)
      .where(eq(overheadExpenses.orgId, orgId))
      .orderBy(overheadExpenses.createdAt);
  }

  async createOverheadExpense(data: any): Promise<any> {
    const [expense] = await db.insert(overheadExpenses).values(data).returning();
    return expense;
  }

  async updateOverheadExpense(id: string, data: any, orgId: string): Promise<any> {
    const cond = and(eq(overheadExpenses.id, id), eq(overheadExpenses.orgId, orgId));
    const [expense] = await db.update(overheadExpenses).set({ ...data, updatedAt: new Date() }).where(cond).returning();
    if (!expense) throw new Error('Overhead expense not found');
    return expense!;
  }

  async deleteOverheadExpense(id: string, orgId: string): Promise<void> {
    const cond = and(eq(overheadExpenses.id, id), eq(overheadExpenses.orgId, orgId));
    const [d] = await db.delete(overheadExpenses).where(cond).returning();
    if (!d) throw new Error('Overhead expense not found');
  }

  async getOrderExpenses(orderId: string, orgId: string): Promise<any[]> {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
    if (!order) return [];
    return await db
      .select()
      .from(orderExpenses)
      .where(and(eq(orderExpenses.orderId, orderId), eq(orderExpenses.orgId, orgId)));
  }

  async createOrderExpenses(orderId: string, expenses: any[], orgId: string): Promise<void> {
    if (expenses && expenses.length > 0) {
      const values = expenses.map(exp => ({
        ...exp,
        orderId,
        orgId,
      }));
      await db.insert(orderExpenses).values(values);
    }
  }

  async getExpenseReport(startDate: Date, endDate: Date, orgId: string): Promise<any> {
    const analytics = await this.getExpenseAnalytics(startDate, endDate, orgId);

    // Get detailed overhead expenses by category
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const overheadCond = orgId
      ? and(lte(overheadExpenses.startDate, endDate), eq(overheadExpenses.isActive, 1), or(isNull(overheadExpenses.endDate), gte(overheadExpenses.endDate, startDate)), eq(overheadExpenses.orgId, orgId))
      : and(lte(overheadExpenses.startDate, endDate), eq(overheadExpenses.isActive, 1), or(isNull(overheadExpenses.endDate), gte(overheadExpenses.endDate, startDate)));
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
      .where(overheadCond)
      .groupBy(overheadExpenses.category);

    const orderDateCond = and(between(orders.createdAt, startDate, endDate), eq(orders.orgId, orgId));
    const orderExpensesByCategory = await db
      .select({
        category: orderExpenses.category,
        total: sql<number>`SUM(CAST(${orderExpenses.amount} AS DECIMAL))`,
        count: sql<number>`COUNT(*)`,
      })
      .from(orderExpenses)
      .innerJoin(orders, eq(orderExpenses.orderId, orders.id))
      .where(orderDateCond)
      .groupBy(orderExpenses.category);

    const dailyTrends = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`,
        orderExpenses: sql<number>`COALESCE(SUM(CAST(${orderExpenses.amount} AS DECIMAL)), 0)`,
      })
      .from(orders)
      .leftJoin(orderExpenses, eq(orderExpenses.orderId, orders.id))
      .where(orderDateCond)
      .groupBy(sql`DATE(${orders.createdAt})`);

    // Add daily overhead to trends  
    const enhancedTrends = dailyTrends.map(day => ({
      ...day,
      overhead: analytics.dailyOverhead,
      total: parseFloat(day.orderExpenses.toString()) + analytics.dailyOverhead,
    }));

    return {
      summary: analytics,
      // ARC-025: an empty category (or no overhead/order expenses at all in
      // range) divided by zero here and rendered "NaN%" on the pie chart —
      // guarded to a real 0% instead.
      overheadByCategory: overheadByCategory.map(cat => ({
        ...cat,
        percentage: analytics.overheadTotal > 0 ? (cat.total / analytics.overheadTotal) * 100 : 0,
      })),
      orderExpensesByCategory: orderExpensesByCategory.map(cat => ({
        ...cat,
        percentage: analytics.orderExpenseTotal > 0 ? (cat.total / analytics.orderExpenseTotal) * 100 : 0,
      })),
      dailyTrends: enhancedTrends,
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days: daysDiff,
      },
    };
  }

  /**
   * ARC-025 (Profit Truths): revenue was every order in the date range by
   * `created_at` with no status filter and no refund netting — the same class
   * of bug as ARC-020 — and COGS joined `order_items` to `orders` on the same
   * unfiltered `created_at` window. Revenue is now {@link settledRevenueByDay}
   * (settled orders, net of refunds); COGS is scoped to the matching settled
   * window (`settled_at`, `status = 'completed'`), so a line only counts once
   * the sale it belongs to has actually completed.
   *
   * COGS is costed from each line's cost snapshot (v1.2 Phase 2, PRC-06),
   * so editing a cost today does not move a past period. Lines sold before
   * snapshots existed fall back to the product's cost today (no backfill) —
   * see `lineUnitCostSql`. `productsMissingCost` flags when the number is
   * incomplete because a sold line has no known cost.
   */
  async getProfitAnalysis(startDate: Date, endDate: Date, orgId: string): Promise<any> {
    const { settledRevenueByDay } = await import("./services/revenue");
    const { offsetDate } = await import("@shared/analytics/kpi");

    const fromIso = startDate.toISOString().slice(0, 10);
    const toIso = endDate.toISOString().slice(0, 10);
    const byDay = await settledRevenueByDay(orgId, fromIso, toIso);

    let totalRevenue = 0;
    let orderCount = 0;
    for (const kpi of byDay.values()) {
      totalRevenue += kpi.revenue;
      orderCount += kpi.txns;
    }

    const cogsCond = and(
      eq(orders.orgId, orgId),
      eq(orders.status, 'completed'),
      gte(sql`date(${orders.settledAt})`, sql`${fromIso}::date`),
      lte(sql`date(${orders.settledAt})`, sql`${toIso}::date`),
    );
    const { lineCostSql, lineUnitCostSql } = await import("./services/lineCost");
    const cogsData = await db
      .select({
        totalCOGS: sql<number>`COALESCE(SUM(${lineCostSql}), 0)`,
        productsMissingCost: sql<number>`COUNT(DISTINCT ${orderItems.productId}) FILTER (WHERE ${lineUnitCostSql} IS NULL)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(cogsCond);

    // Postgres numeric/decimal columns come back as strings over the wire —
    // coerced to real numbers so callers get a number, not "5.00000".
    const totalCOGS = Number(cogsData[0]?.totalCOGS) || 0;
    const productsMissingCost = Number(cogsData[0]?.productsMissingCost) || 0;

    const expenses = await this.getExpenseAnalytics(startDate, endDate, orgId);

    // The delivery fee is a service charge, not goods (v1.2.1): left out of
    // gross profit and margin unless the admin counts it, and added back
    // below gross so operating and net profit still include the money.
    const { deliveryFeeTakingsByDate } = await import("./services/deliveryFeeTakings");
    const fees = await deliveryFeeTakingsByDate(orgId, fromIso, toIso);
    const [feeOrg] = await db
      .select({ counted: organizations.deliveryFeeCommissionable })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const feesCounted = feeOrg?.counted === true;
    const feesOutsideMargin = feesCounted ? 0 : fees.total;

    // Calculate profit margins — guarded against a zero-revenue period so an
    // empty range renders 0%, never NaN%.
    const marginRevenue = totalRevenue - feesOutsideMargin;
    const grossProfit = marginRevenue - totalCOGS;
    const grossMargin = marginRevenue > 0 ? (grossProfit / marginRevenue) * 100 : 0;

    const operatingProfit = grossProfit + feesOutsideMargin - expenses.totalExpenses;
    const operatingMargin = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

    const netProfit = operatingProfit; // Could subtract taxes here if tracked
    const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    const dailyCOGS = await db
      .select({
        date: sql<string>`DATE(${orders.settledAt})`,
        cogs: sql<number>`COALESCE(SUM(${lineCostSql}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(cogsCond)
      .groupBy(sql`DATE(${orders.settledAt})`);
    const cogsByDate = new Map(dailyCOGS.map((c) => [String(c.date), Number(c.cogs) || 0]));

    // Combine daily data — one row per calendar day in range, built from the
    // same settled-revenue map as `totalRevenue`, so the trend sums to it.
    const profitTrends: Array<{
      date: string;
      revenue: number;
      cogs: number;
      grossProfit: number;
      expenses: number;
      netProfit: number;
      grossMargin: number;
      netMargin: number;
    }> = [];
    for (let d = fromIso; d <= toIso; d = offsetDate(d, 1)) {
      const revenue = byDay.get(d)?.revenue ?? 0;
      const cogs = cogsByDate.get(d) ?? 0;
      const dayFees = feesCounted ? 0 : fees.byDate.get(d) ?? 0;
      const dailyGrossProfit = revenue - dayFees - cogs;
      const dailyNetProfit = dailyGrossProfit + dayFees - expenses.dailyOverhead;
      profitTrends.push({
        date: d,
        revenue,
        cogs,
        grossProfit: dailyGrossProfit,
        expenses: expenses.dailyOverhead,
        netProfit: dailyNetProfit,
        grossMargin: revenue - dayFees > 0 ? (dailyGrossProfit / (revenue - dayFees)) * 100 : 0,
        netMargin: revenue > 0 ? (dailyNetProfit / revenue) * 100 : 0,
      });
    }

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
        productsMissingCost,
        // Delivery fees inside `revenue` (v1.2.1), and whether gross profit counts them.
        deliveryFees: fees.total,
        deliveryFeesInMargin: feesCounted,
        // Every figure here is settled orders, net of refunds, VAT-inclusive
        // (orders.total already has VAT added on top of the net subtotal —
        // see server/services/orgTaxRate.ts) — stated so the card doesn't
        // leave the reader guessing.
        vatTreatment: "incl. VAT",
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

  async getExpenseAnalytics(startDate: Date, endDate: Date, orgId: string): Promise<any> {
    const overheadCond = orgId
      ? and(lte(overheadExpenses.startDate, endDate), eq(overheadExpenses.isActive, 1), or(isNull(overheadExpenses.endDate), gte(overheadExpenses.endDate, startDate)), eq(overheadExpenses.orgId, orgId))
      : and(lte(overheadExpenses.startDate, endDate), eq(overheadExpenses.isActive, 1), or(isNull(overheadExpenses.endDate), gte(overheadExpenses.endDate, startDate)));
    const overheads = await db
      .select({
        name: overheadExpenses.name,
        category: overheadExpenses.category,
        amount: sql<number>`CAST(${overheadExpenses.amount} AS DECIMAL)`,
        frequency: overheadExpenses.frequency,
      })
      .from(overheadExpenses)
      .where(overheadCond);

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

    const orderCond = and(between(orders.createdAt, startDate, endDate), eq(orders.orgId, orgId));
    const orderExpenseResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(CAST(${orderExpenses.amount} AS DECIMAL)), 0)`,
      })
      .from(orderExpenses)
      .innerJoin(orders, eq(orderExpenses.orderId, orders.id))
      .where(orderCond);

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
  async getPromotions(orgId: string, active?: boolean): Promise<Promotion[]> {
    const conds = [eq(promotions.orgId, orgId)];
    if (active !== undefined) conds.push(eq(promotions.isActive, active ? 1 : 0));
    return db
      .select()
      .from(promotions)
      .where(and(...conds))
      .orderBy(desc(promotions.createdAt));
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

  async updatePromotion(id: string, data: Partial<InsertPromotion>, orgId: string): Promise<Promotion> {
    const cond = and(eq(promotions.id, id), eq(promotions.orgId, orgId));
    const [promo] = await db.update(promotions).set({ ...data, updatedAt: new Date() }).where(cond).returning();
    if (!promo) throw new Error('Promotion not found');
    return promo!;
  }

  async deletePromotion(id: string, orgId: string): Promise<void> {
    const cond = and(eq(promotions.id, id), eq(promotions.orgId, orgId));
    const [d] = await db.delete(promotions).where(cond).returning();
    if (!d) throw new Error('Promotion not found');
  }

  async validatePromoCode(code: string, orgId: string): Promise<Promotion | null> {
    const now = new Date();
    const baseCond = sql`${promotions.code} = ${code} AND ${promotions.isActive} = 1 AND ${promotions.startDate} <= ${now} AND ${promotions.endDate} >= ${now} AND (${promotions.usageLimit} IS NULL OR ${promotions.usageCount} < ${promotions.usageLimit})`;
    const cond = and(baseCond, eq(promotions.orgId, orgId));
    const [promo] = await db.select().from(promotions).where(cond);
    return promo || null;
  }

  async applyPromotion(orderId: string, promoCode: string): Promise<number> {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order?.orgId) throw new Error("Order not found");
    const promo = await this.validatePromoCode(promoCode, order.orgId);
    if (!promo) {
      throw new Error("Invalid or expired promo code");
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

  async getInvoicesWithDetails(orgId: string): Promise<any[]> {
    // One list and one status rule (v1.2 Phase 1C): server/services/invoices.ts.
    const { listInvoices } = await import("./services/invoices");
    return listInvoices(orgId);
  }

  // Allow list operations
  private allowedUserSubjectWhere(subjectId: string) {
    return or(
      eq(allowedUsers.authUserId, subjectId),
      eq(allowedUsers.replitUserId, subjectId),
    );
  }

  private approvalSubjectWhere(subjectId: string) {
    return or(
      eq(userApprovalRequests.authUserId, subjectId),
      eq(userApprovalRequests.replitUserId, subjectId),
    );
  }

  async isUserAllowed(authSubjectId: string): Promise<boolean> {
    const [user] = await db
      .select()
      .from(allowedUsers)
      .where(this.allowedUserSubjectWhere(authSubjectId));
    return !!user;
  }

  async getUserRoleAndOrg(authSubjectId: string): Promise<{ role: string; orgId: string | null } | null> {
    const [user] = await db
      .select({ role: allowedUsers.role, orgId: allowedUsers.orgId, isOwner: allowedUsers.isOwner })
      .from(allowedUsers)
      .where(this.allowedUserSubjectWhere(authSubjectId));
    if (!user) return null;
    const role = user.isOwner ? "SUPER_ADMIN" : (user.role || "CASHIER");
    return { role, orgId: user.orgId ?? null };
  }

  async findAllowedUserByAuthSubject(authSubjectId: string): Promise<AllowedUser | null> {
    const [user] = await db
      .select()
      .from(allowedUsers)
      .where(this.allowedUserSubjectWhere(authSubjectId));
    return user ?? null;
  }

  /**
   * Phased Clerk migration: match allowed_users by email and set auth_user_id.
   * Refuses when the same email appears in multiple orgs (no silent cross-org merge).
   */
  async tryLinkAuthUserByEmail(params: {
    email: string;
    newAuthUserId: string;
    authProvider: string;
  }): Promise<{ linked: boolean; reason?: string }> {
    const normalized = params.email.trim().toLowerCase();
    if (!normalized) return { linked: false, reason: "empty_email" };

    const rows = await db
      .select()
      .from(allowedUsers)
      .where(sql`lower(trim(${allowedUsers.email})) = ${normalized}`);

    if (rows.length === 0) return { linked: false, reason: "not_found" };
    if (rows.length > 1) {
      const orgKeys = new Set(rows.map((r) => r.orgId ?? "__none__"));
      if (orgKeys.size > 1) {
        return { linked: false, reason: "multiple_orgs_same_email" };
      }
    }

    const row = rows[0]!;
    if (row.authUserId === params.newAuthUserId && row.authProvider === params.authProvider) {
      return { linked: true };
    }
    if (
      row.authProvider === "clerk" &&
      row.authUserId &&
      row.authUserId !== params.newAuthUserId
    ) {
      return { linked: false, reason: "already_linked_other_subject" };
    }

    await db
      .update(allowedUsers)
      .set({
        authUserId: params.newAuthUserId,
        authProvider: params.authProvider,
      })
      .where(eq(allowedUsers.id, row.id));

    await db
      .update(users)
      .set({
        authUserId: params.newAuthUserId,
        authProvider: params.authProvider,
      })
      .where(
        or(
          eq(users.replitUserId, row.replitUserId),
          eq(users.id, row.replitUserId),
          sql`lower(trim(${users.email})) = ${normalized}`,
        ),
      );

    return { linked: true };
  }

  /**
   * The access list, with each person's commission rate alongside.
   *
   * The rate lives on `users`, not `allowed_users`, so it is joined in rather
   * than duplicated — the access screen is where it is set, and showing a stale
   * copy of somebody's pay rate would be worse than not showing it.
   */
  private async attachCommissionRates<T extends { replitUserId: string }>(
    rows: T[],
  ): Promise<Array<T & { commissionRate: string | null }>> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.replitUserId).filter(Boolean);
    const userRows = ids.length
      ? await db
          .select({ id: users.id, replitUserId: users.replitUserId, rate: users.commissionRate })
          .from(users)
          .where(or(inArray(users.id, ids), inArray(users.replitUserId, ids)))
      : [];
    const byKey = new Map<string, string | null>();
    for (const u of userRows) {
      if (u.id) byKey.set(u.id, u.rate);
      if (u.replitUserId) byKey.set(u.replitUserId, u.rate);
    }
    return rows.map((r) => ({ ...r, commissionRate: byKey.get(r.replitUserId) ?? null }));
  }

  async getAllowedUsers(orgId: string): Promise<AllowedUser[]> {
    // `org_id` is NULL by design for a SUPER_ADMIN row — their org is resolved
    // per request (server/auth/commonAuth.ts), never stored on their own row —
    // so a strict org match alone hides them from every org's own access list.
    // They belong on all of them: that NULL row genuinely has access to this
    // org, same reasoning as loadStaff's fix for the Ops board roster.
    const rows = await db
      .select()
      .from(allowedUsers)
      .where(or(eq(allowedUsers.orgId, orgId), isNull(allowedUsers.orgId)))
      .orderBy(desc(allowedUsers.createdAt));
    return this.attachCommissionRates(rows) as unknown as Promise<AllowedUser[]>;
  }

  async adminGetAllAllowedUsers(): Promise<AllowedUser[]> {
    const rows = await db.select().from(allowedUsers).orderBy(desc(allowedUsers.createdAt));
    return this.attachCommissionRates(rows) as unknown as Promise<AllowedUser[]>;
  }

  async addAllowedUser(data: InsertAllowedUser): Promise<AllowedUser> {
    const authUserId = data.authUserId ?? data.replitUserId;
    const authProvider = data.authProvider ?? "replit";
    const [user] = await db
      .insert(allowedUsers)
      .values({
        ...data,
        authUserId,
        authProvider,
      })
      .onConflictDoUpdate({
        target: allowedUsers.replitUserId,
        set: {
          email: data.email,
          name: data.name,
          isOwner: data.isOwner,
          orgId: data.orgId ?? undefined,
          role: data.role ?? undefined,
          authUserId,
          authProvider,
        },
      })
      .returning();
    return user;
  }

  async removeAllowedUser(replitUserId: string): Promise<void> {
    await db.delete(allowedUsers).where(eq(allowedUsers.replitUserId, replitUserId));
  }

  async getOwner(): Promise<AllowedUser | null> {
    const [owner] = await db
      .select()
      .from(allowedUsers)
      .where(eq(allowedUsers.isOwner, 1));
    return owner || null;
  }

  /**
   * Sets a person's commission rate, or clears it back to the org default.
   *
   * Keyed on the replit user id the access screen already works in, matched
   * against both `users.replitUserId` and `users.id` because the two are the
   * same value for accounts created since the auth migration and differ for
   * older ones.
   */
  async setUserCommissionRate(replitUserId: string, rate: number | null): Promise<void> {
    await db
      .update(users)
      .set({
        commissionRate: rate == null ? null : String(rate),
        updatedAt: new Date(),
      })
      .where(or(eq(users.replitUserId, replitUserId), eq(users.id, replitUserId)));
  }

  async updateAllowedUserAccess(
    replitUserId: string,
    updates: { role?: string; orgId?: string | null },
    actor: { role: string; orgId: string | null; replitUserId: string },
  ): Promise<AllowedUser> {
    const [target] = await db
      .select()
      .from(allowedUsers)
      .where(eq(allowedUsers.replitUserId, replitUserId));
    if (!target) throw new Error("User not found");

    const actorRole = actor.role as Role;
    const targetRole = (updates.role ?? target.role ?? "CASHIER") as Role;

    if (updates.role && !isRole(updates.role)) {
      throw new Error("Invalid role");
    }
    if (updates.role && !canAssignRole(actorRole, targetRole)) {
      throw new Error("You cannot assign this role");
    }
    const effectiveTargetOrg = updates.orgId !== undefined ? updates.orgId : target.orgId;
    if (!canManageUser(actorRole, actor.orgId, effectiveTargetOrg)) {
      throw new Error("You cannot manage users outside your organization");
    }
    if (target.isOwner === 1 && updates.role && updates.role !== "SUPER_ADMIN") {
      throw new Error("Cannot change platform owner role");
    }
    if (targetRole === "SUPER_ADMIN" && updates.orgId) {
      throw new Error("SUPER_ADMIN cannot be assigned to an organization");
    }
    if (actor.replitUserId === replitUserId && updates.role) {
      throw new Error("You cannot change your own role");
    }

    const patch: Partial<typeof allowedUsers.$inferInsert> = {};
    if (updates.role) {
      patch.role = targetRole;
      patch.isOwner = targetRole === "SUPER_ADMIN" ? 1 : 0;
    }
    if (updates.orgId !== undefined) {
      patch.orgId = targetRole === "SUPER_ADMIN" ? null : updates.orgId;
    }

    // Nothing on the row itself to change (a commission- or location-only
    // edit): answer with the row as it is instead of the driver's
    // "No values to set" (v1.2.1 SEC-500-NONUUID, related).
    if (Object.keys(patch).length === 0) {
      const [current] = await db.select().from(allowedUsers).where(eq(allowedUsers.replitUserId, replitUserId));
      return current;
    }

    const [updated] = await db
      .update(allowedUsers)
      .set(patch)
      .where(eq(allowedUsers.replitUserId, replitUserId))
      .returning();
    return updated;
  }

  async listOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations).orderBy(organizations.name);
  }

  async getOrganization(id: string): Promise<Organization | null> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org ?? null;
  }

  async createOrganization(name: string): Promise<Organization> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Organization name is required");
    const [org] = await db.insert(organizations).values({ name: trimmed }).returning();
    return org;
  }

  async updateOrganizationName(id: string, name: string): Promise<Organization> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Organization name is required");
    const [org] = await db
      .update(organizations)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    if (!org) throw new Error("Organization not found");
    return org;
  }

  async countOrganizations(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(organizations);
    return row?.count ?? 0;
  }

  /**
   * Used by the dev auth bypass to tell a genuinely empty install (where it
   * must grant enough access to create the first user) from a populated one
   * (where an unrecognised id is a misconfiguration, not a bootstrap).
   */
  async countAllowedUsers(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(allowedUsers);
    return row?.count ?? 0;
  }

  // Approval request operations
  async getPendingApprovals(): Promise<UserApprovalRequest[]> {
    // Only unclaimed sign-ups: a request whose person already has access (in
    // any organisation) is not something an admin can act on here, and
    // listing it would show one organisation's staff to another's admins.
    return db
      .select()
      .from(userApprovalRequests)
      .where(
        and(
          eq(userApprovalRequests.status, 'pending'),
          sql`NOT EXISTS (SELECT 1 FROM allowed_users au WHERE au.replit_user_id = ${userApprovalRequests.replitUserId})`,
        ),
      )
      .orderBy(desc(userApprovalRequests.requestedAt));
  }

  async getApprovalRequest(authSubjectId: string): Promise<UserApprovalRequest | null> {
    const [request] = await db
      .select()
      .from(userApprovalRequests)
      .where(this.approvalSubjectWhere(authSubjectId));
    return request || null;
  }

  async createApprovalRequest(data: InsertUserApprovalRequest): Promise<UserApprovalRequest> {
    const authUserId = data.authUserId ?? data.replitUserId;
    const authProvider = data.authProvider ?? "replit";
    const [request] = await db
      .insert(userApprovalRequests)
      .values({
        ...data,
        authUserId,
        authProvider,
      })
      .onConflictDoUpdate({
        target: userApprovalRequests.replitUserId,
        set: {
          email: data.email,
          name: data.name,
          profileImageUrl: data.profileImageUrl,
          status: "pending",
          authUserId,
          authProvider,
        },
      })
      .returning();
    return request;
  }

  /**
   * Approve a PENDING sign-up request (v1.2.1 SEC-APPROVE-XORG).
   *
   * Only an unclaimed request can be approved: its status must be "pending"
   * and the person must not already have an allowed_users row. Anything else
   * (an existing member of any organisation, the owner, an already-approved or
   * rejected request) throws ApprovalStateError, so an admin cannot re-home or
   * re-role someone through this path; User Access (PATCH) is the place for
   * that, and it is organisation-scoped.
   */
  async approveUser(
    replitUserId: string,
    approvedBy: string,
    options?: { role?: string; orgId?: string | null },
  ): Promise<void> {
    const role = options?.role ?? "CUSTOMER";
    if (role === "SUPER_ADMIN") {
      throw new ApprovalStateError(403, "Cannot approve new users as SUPER_ADMIN");
    }
    await db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(userApprovalRequests)
        .where(eq(userApprovalRequests.replitUserId, replitUserId))
        .for("update");
      if (!request) throw new ApprovalStateError(404, "Approval request not found");
      if (request.status !== "pending") {
        throw new ApprovalStateError(409, "This request is not pending");
      }
      const [existing] = await tx
        .select({ id: allowedUsers.id })
        .from(allowedUsers)
        .where(eq(allowedUsers.replitUserId, replitUserId))
        .limit(1);
      if (existing) {
        throw new ApprovalStateError(409, "This person already has access; change it in User Access");
      }

      const [approver] = await tx
        .select({ orgId: allowedUsers.orgId, role: allowedUsers.role, isOwner: allowedUsers.isOwner })
        .from(allowedUsers)
        .where(eq(allowedUsers.replitUserId, approvedBy));
      const approverRole = approver?.isOwner ? "SUPER_ADMIN" : (approver?.role ?? "CASHIER");
      const orgId =
        options?.orgId !== undefined
          ? options.orgId
          : approverRole === "SUPER_ADMIN"
            ? null
            : approver?.orgId ?? null;

      await tx
        .update(userApprovalRequests)
        .set({ status: "approved", reviewedAt: new Date(), reviewedBy: approvedBy })
        .where(eq(userApprovalRequests.replitUserId, replitUserId));

      // Plain insert, never an upsert: an existing row was refused above, and a
      // concurrent insert fails on the unique key instead of being overwritten.
      await tx.insert(allowedUsers).values({
        replitUserId: request.replitUserId,
        authUserId: request.authUserId ?? request.replitUserId,
        authProvider: request.authProvider ?? "replit",
        email: request.email,
        name: request.name,
        isOwner: 0,
        orgId,
        role: role as Role,
      });
    });
  }

  /** Reject a PENDING, unclaimed sign-up request (v1.2.1 SEC-APPROVE-XORG). */
  async rejectUser(replitUserId: string, rejectedBy: string): Promise<void> {
    const [existing] = await db
      .select({ id: allowedUsers.id })
      .from(allowedUsers)
      .where(eq(allowedUsers.replitUserId, replitUserId))
      .limit(1);
    if (existing) {
      throw new ApprovalStateError(409, "This person already has access; change it in User Access");
    }
    const updated = await db
      .update(userApprovalRequests)
      .set({
        status: 'rejected',
        reviewedAt: new Date(),
        reviewedBy: rejectedBy,
      })
      .where(and(eq(userApprovalRequests.replitUserId, replitUserId), eq(userApprovalRequests.status, "pending")))
      .returning({ id: userApprovalRequests.id });
    if (updated.length === 0) {
      throw new ApprovalStateError(404, "No pending request for this person");
    }
  }

  async insertAdminAuditLog(row: InsertAdminAuditLog): Promise<void> {
    await db.insert(adminAuditLogs).values(row);
  }

  async listAdminAuditLogs(opts: { limit: number; offset: number }): Promise<AdminAuditLog[]> {
    return db
      .select()
      .from(adminAuditLogs)
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
  }

  async getFeatureFlag(orgId: string, flag: string): Promise<FeatureFlag | undefined> {
    const [row] = await db
      .select()
      .from(featureFlags)
      .where(and(eq(featureFlags.orgId, orgId), eq(featureFlags.flag, flag)));
    return row;
  }

  async listFeatureFlagsForOrg(orgId: string): Promise<FeatureFlag[]> {
    return db.select().from(featureFlags).where(eq(featureFlags.orgId, orgId));
  }

  async upsertFeatureFlag(orgId: string, flag: string, enabled: boolean): Promise<FeatureFlag> {
    const [row] = await db
      .insert(featureFlags)
      .values({ orgId, flag, enabled, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [featureFlags.orgId, featureFlags.flag],
        set: { enabled, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async createApiKeyForOrg(
    orgId: string,
    name: string,
    scopes?: string[],
  ): Promise<{ id: string; name: string; keyLookup: string; plainKey: string; createdAt: Date | null }> {
    const lookup = randomBytes(12).toString("hex").toLowerCase();
    const secretPart = randomBytes(24).toString("hex").toLowerCase();
    const plain = `mk_live_${lookup}_${secretPart}`;
    const secretHash = await bcrypt.hash(plain, 10);
    const [row] = await db
      .insert(apiKeys)
      .values({
        orgId,
        name: name?.trim() || "API key",
        keyLookup: lookup,
        secretHash,
        scopes: scopes?.length ? scopes : ["products:read"],
      })
      .returning();
    return {
      id: row.id,
      name: row.name,
      keyLookup: row.keyLookup,
      plainKey: plain,
      createdAt: row.createdAt ?? null,
    };
  }

  async listApiKeysForOrg(orgId: string): Promise<ApiKey[]> {
    return db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.orgId, orgId))
      .orderBy(desc(apiKeys.createdAt));
  }

  async revokeApiKey(id: string, orgId: string): Promise<void> {
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)));
  }

  async verifyApiKeyAndGetOrg(plainToken: string): Promise<{ orgId: string; scopes: string[]; keyId?: string } | null> {
    const m = plainToken.match(/^mk_live_([a-f0-9]{24})_([a-f0-9]{48})$/i);
    if (!m) return null;
    const lookup = m[1].toLowerCase();
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyLookup, lookup), isNull(apiKeys.revokedAt)));
    for (const row of rows) {
      if (await bcrypt.compare(plainToken, row.secretHash)) {
        // keyId: who read what, for the customer data access log (v1.2 Phase 6).
        return { orgId: row.orgId, scopes: (row.scopes as string[]) ?? [], keyId: row.id };
      }
    }
    return null;
  }

  async getProductsForOrgPublic(orgId: string): Promise<Product[]> {
    return db
      .select()
      .from(products)
      .where(eq(products.orgId, orgId))
      .orderBy(products.name)
      .limit(500);
  }

  async createOutboundWebhook(
    orgId: string,
    input: { url: string; secret: string; eventTypes?: string[] },
  ): Promise<OutboundWebhook> {
    const [row] = await db
      .insert(outboundWebhooks)
      .values({
        orgId,
        url: input.url,
        secret: input.secret,
        eventTypes: input.eventTypes?.length ? input.eventTypes : ["OrderCreated"],
        isActive: 1,
      })
      .returning();
    return row;
  }

  async listOutboundWebhooksForOrg(orgId: string): Promise<OutboundWebhook[]> {
    return db
      .select()
      .from(outboundWebhooks)
      .where(eq(outboundWebhooks.orgId, orgId))
      .orderBy(desc(outboundWebhooks.createdAt));
  }

  async listActiveOutboundWebhooksForOrg(orgId: string): Promise<OutboundWebhook[]> {
    return db
      .select()
      .from(outboundWebhooks)
      .where(and(eq(outboundWebhooks.orgId, orgId), eq(outboundWebhooks.isActive, 1)));
  }
}

export const storage = new DatabaseStorage();
