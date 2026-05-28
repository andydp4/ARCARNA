/**
 * Storage Layer - Data Access Interface
 * 
 * This module provides the primary data access layer for the Midnight EPOS system.
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
  analyticsDaily,
  analyticsMonthly,
  products,
  productLocationStock,
  orders,
  orderItems,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, or, lte, gte, isNull, between } from "drizzle-orm";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";

// --- Utility Functions ---
import { parseImportInteger, parseImportNumber } from "@shared/importValues";

function safeParseFloat(value: string | number | null | undefined, defaultValue: number = 0): number {
  return parseImportNumber(value) ?? defaultValue;
}

function safeParseInt(value: string | number | null | undefined, defaultValue: number = 0): number {
  return parseImportInteger(value) ?? defaultValue;
}

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
  createOrder(orderData: any): Promise<Order>;

  // Product operations
  createProduct(data: InsertProduct): Promise<Product>; // Use InsertProduct type
  updateProduct(id: string, data: any): Promise<Product>;
  deleteProduct(id: string, orgId: string): Promise<void>;
  getProduct(id: string, orgId: string): Promise<Product | null>;
  importProducts(
    products: any[],
    orgId: string,
    options?: { duplicateMode?: "skip" | "overwrite"; confirmed?: boolean },
  ): Promise<{ imported: number; skipped: number; failed: number; errors: string[] }>;
  importCustomers(
    customers: any[],
    orgId: string,
    options?: { duplicateMode?: "skip" | "merge" | "overwrite"; confirmed?: boolean },
  ): Promise<{ imported: number; skipped: number; merged: number; failed: number; errors: string[] }>;
  getOrgProfile(orgId: string): Promise<Organization | null>;
  updateOrgProfile(orgId: string, patch: Record<string, unknown>): Promise<Organization>;
  completeOrgSetup(orgId: string): Promise<Organization>;
  getImportHistory(orgId: string, limit?: number): Promise<ImportHistory[]>;
  recordImportHistory(data: InsertImportHistory): Promise<ImportHistory>;

  // Customer operations
  createCustomer(data: any): Promise<Customer>;
  updateCustomer(id: string, data: any): Promise<Customer>;
  deleteCustomer(id: string, orgId: string): Promise<void>;
  getCustomer(id: string, orgId: string): Promise<Customer | null>;

  // Inventory operations
  getProductsWithStock(orgId: string): Promise<Product[]>;
  updateProductStock(productId: string, adjustment: number, type: 'add' | 'set', userId: string, orgId: string): Promise<Product>;

  // Reports operations
  getReportData(fromDate: Date, toDate: Date, orgId: string): Promise<any>;
  generateCSVReport(data: any, type: string): Promise<string>;
  generatePDFReport(data: any, type: string): Promise<Buffer>;

  // Locations operations
  getLocations(orgId: string): Promise<Location[]>;
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
  verifyApiKeyAndGetOrg(plainToken: string): Promise<{ orgId: string; scopes: string[] } | null>;
  getProductsForOrgPublic(orgId: string): Promise<Product[]>;

  createOutboundWebhook(
    orgId: string,
    input: { url: string; secret: string; eventTypes?: string[] },
  ): Promise<OutboundWebhook>;
  listOutboundWebhooksForOrg(orgId: string): Promise<OutboundWebhook[]>;
  listActiveOutboundWebhooksForOrg(orgId: string): Promise<OutboundWebhook[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const subjectId = userData.id ?? (userData as { replitUserId?: string }).replitUserId;
    if (!subjectId) throw new Error("upsertUser requires id");
    const authProvider =
      (userData as { authProvider?: string }).authProvider ?? "replit";
    const authUserId =
      (userData as { authUserId?: string }).authUserId ?? subjectId;
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
  }

  async getTopCustomers(limit: number = 10, orgId: string): Promise<
    Array<{
      customer: Customer;
      metrics: CustomerMetric | null;
    }>
  > {
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
    const results = await base.where(eq(customers.orgId, orgId)).orderBy(desc(customerMetrics.clv)).limit(limit);
    return results;
  }

  async getDailyRevenue(days: number = 30, orgId: string): Promise<
    Array<{
      date: string;
      totalOrders: number;
      totalRevenue: string;
    }>
  > {
    let q = db
      .select({
        date: analyticsDaily.date,
        totalOrders: analyticsDaily.totalOrders,
        totalRevenue: analyticsDaily.totalRevenue,
      })
      .from(analyticsDaily);
    q = q.where(eq(analyticsDaily.orgId, orgId)) as typeof q;
    const results = await q.orderBy(desc(analyticsDaily.date)).limit(days);
    return results.reverse().map((r) => ({
      date: r.date || "",
      totalOrders: r.totalOrders || 0,
      totalRevenue: r.totalRevenue || "0",
    }));
  }

  async getMonthlySummary(months: number = 12, orgId: string): Promise<
    Array<{
      year: number;
      month: number;
      totalOrders: number;
      totalRevenue: string;
    }>
  > {
    let q = db
      .select({
        year: analyticsMonthly.year,
        month: analyticsMonthly.month,
        totalOrders: analyticsMonthly.totalOrders,
        totalRevenue: analyticsMonthly.totalRevenue,
      })
      .from(analyticsMonthly);
    q = q.where(eq(analyticsMonthly.orgId, orgId)) as typeof q;
    const results = await q.orderBy(desc(analyticsMonthly.year), desc(analyticsMonthly.month)).limit(months);
    return results.reverse().map((r) => ({
      year: r.year || 0,
      month: r.month || 0,
      totalOrders: r.totalOrders || 0,
      totalRevenue: r.totalRevenue || "0",
    }));
  }

  async getProducts(orgId: string): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.orgId, orgId)).orderBy(products.name);
  }

  async createProduct(data: InsertProduct): Promise<Product> {
    // Validate data before insertion
    if (!data.name || data.name.trim().length === 0) {
      throw new Error('Product name is required');
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

  async deleteProduct(id: string, orgId: string): Promise<void> {
    const [deleted] = await db.delete(products).where(and(eq(products.id, id), eq(products.orgId, orgId))).returning();
    if (!deleted) throw new Error('Product not found');
  }

  async getProduct(id: string, orgId: string): Promise<Product | null> {
    const [product] = await db.select().from(products).where(and(eq(products.id, id), eq(products.orgId, orgId)));
    return product || null;
  }

  async importProducts(
    productList: any[],
    orgId: string,
    options?: { duplicateMode?: "skip" | "overwrite"; confirmed?: boolean },
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
        const costPrice = parseImportNumber(
          productData.costPrice ?? productData.tax,
        );
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

        productData.defaultSalePrice = salePrice;
        productData.costPrice = costPrice ?? 0;
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
          const updatedRows = await db
            .update(products)
            .set({
              name: productData.name,
              barcode: productData.barcode ?? existingProduct.barcode,
              defaultSalePrice: productData.defaultSalePrice ?? productData.salePrice ?? productData.price,
              costPrice: productData.costPrice ?? productData.tax ?? existingProduct.costPrice,
              stock: 0,
              stockLimit: productData.stockLimit ?? existingProduct.stockLimit,
              locationId: productData.locationId ?? existingProduct.locationId,
              updatedAt: new Date(),
            })
            .where(eq(products.id, existingProduct.id))
            .returning();
          const updatedProduct = updatedRows[0];
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
          const [created] = await db
            .insert(products)
            .values({
              productId: sku || `PRD-${Date.now()}-${imported}`,
              name: productData.name,
              barcode: productData.barcode,
              defaultSalePrice: productData.defaultSalePrice ?? productData.salePrice ?? productData.price,
              costPrice: productData.costPrice ?? productData.tax ?? 0,
              stock: 0,
              stockLimit: productData.stockLimit ?? 100,
              locationId: productData.locationId,
              orgId: orgId ?? undefined,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();
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
      "accentStyle", "businessColors", "setupWizardState",
    ];
    for (const k of keys) {
      if (patch[k] !== undefined) allowed[k] = patch[k];
    }
    const [org] = await db
      .update(organizations)
      .set({ ...allowed, updatedAt: new Date() })
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

  async createOrder(orderData: any): Promise<Order> {
    return await db.transaction(async (tx) => {
      // Create order
      const orgId = orderData.orgId ?? orderData.org_id ?? null;
      const [order] = await tx
        .insert(orders)
        .values({
          orgId,
          customerId: orderData.customerId ?? orderData.customer_id,
          locationId: orderData.locationId ?? orderData.location_id,
          total: orderData.total,
          paymentMethod: orderData.paymentMethod ?? orderData.payment_method,
          status: "completed",
          channel: orderData.channel ?? orderData.channel_id ?? "pos",
        })
        .returning();

      // Create order items (orgId from order)
      if (orderData.items && orderData.items.length > 0) {
        await tx.insert(orderItems).values(
          orderData.items.map((item: any) => ({
            orgId,
            orderId: order.id,
            productId: item.productId ?? item.product_id,
            quantity: item.quantity,
            unitPrice: item.unitPrice ?? item.unit_price,
            totalPrice: item.totalPrice ?? item.total_price,
          }))
        );

        // Create order expenses if provided (orgId from order)
        if (orderData.expenses && orderData.expenses.length > 0) {
          await tx.insert(orderExpenses).values(
            orderData.expenses.map((expense: any) => ({
              orgId,
              orderId: order.id,
              category: expense.category,
              description: expense.description,
              amount: expense.amount,
            }))
          );
        }

        // Stock: event-driven InventoryWorker (product_location_stock authoritative)
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

  async getProductsWithStock(orgId: string): Promise<Product[]> {
    const { productLocationStock } = await import("@shared/schema");
    const base = await db.select().from(products).where(eq(products.orgId, orgId)).orderBy(products.name);

    const totals = await db
      .select({
        productId: productLocationStock.productId,
        total: sql<number>`COALESCE(SUM(${productLocationStock.stock}), 0)::int`.as("total"),
      })
      .from(productLocationStock)
      .where(eq(productLocationStock.orgId, orgId))
      .groupBy(productLocationStock.productId);

    const stockMap = new Map(totals.map((t) => [t.productId, Number(t.total) || 0]));

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

    const locId = locationId
      ? locationId
      : await resolveStockLocationId({ orgId, userId });

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
        total: sql<number>`COALESCE(SUM(${productLocationStock.stock}), 0)::int`.as("total"),
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

  private async getRevenueReports(fromDate: Date, toDate: Date, orgId: string) {
    const dateCond = sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`;
    const whereCond = and(dateCond, eq(orders.orgId, orgId));
    const totalRevenue = await db
      .select({
        total: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`
      })
      .from(orders)
      .where(whereCond);

    const dailyRevenue = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`.as('date'),
        revenue: sql<number>`SUM(CAST(${orders.total} AS DECIMAL))`.as('revenue'),
        orders: sql<number>`COUNT(*)`.as('orders')
      })
      .from(orders)
      .where(whereCond)
      .groupBy(sql`DATE(${orders.createdAt})`)
      .orderBy(sql`DATE(${orders.createdAt})`);

    const byPaymentMethod = await db
      .select({
        method: orders.paymentMethod,
        count: sql<number>`COUNT(*)`.as('count'),
        revenue: sql<number>`SUM(CAST(${orders.total} AS DECIMAL))`.as('revenue')
      })
      .from(orders)
      .where(whereCond)
      .groupBy(orders.paymentMethod);

    return {
      total: totalRevenue[0]?.total || 0,
      byDay: dailyRevenue,
      byCategory: [], // Would need to join with products and categories
      byPaymentMethod
    };
  }

  private async getOrderReports(fromDate: Date, toDate: Date, orgId: string) {
    const dateCond = sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate}`;
    const whereCond = and(dateCond, eq(orders.orgId, orgId));
    const totalOrders = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(orders)
      .where(whereCond);
    const avgOrder = await db
      .select({ average: sql<number>`AVG(CAST(${orders.total} AS DECIMAL))` })
      .from(orders)
      .where(whereCond);
    const topProducts = await db
      .select({
        name: products.name,
        quantity: sql<number>`SUM(${orderItems.quantity})`.as('quantity'),
        revenue: sql<number>`SUM(CAST(${orderItems.totalPrice} AS DECIMAL))`.as('revenue')
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(whereCond)
      .groupBy(products.name)
      .orderBy(sql`SUM(${orderItems.quantity}) DESC`)
      .limit(10);

    const hourlyDistribution = await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${orders.createdAt})`.as('hour'),
        count: sql<number>`COUNT(*)`.as('count')
      })
      .from(orders)
      .where(whereCond)
      .groupBy(sql`EXTRACT(HOUR FROM ${orders.createdAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${orders.createdAt})`);

    return {
      total: totalOrders[0]?.total || 0,
      average: avgOrder[0]?.average || 0,
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

    return {
      total,
      new: newCount,
      returning: total - newCount,
      topCustomers,
      rfmSegments: [] // Would need more complex RFM calculation
    };
  }

  private async getInventoryReports(fromDate: Date, toDate: Date, orgId: string) {
    let prodQ = db.select({
      total: sql<number>`SUM(${products.stock} * CAST(${products.costPrice} AS DECIMAL))`
    }).from(products);
    if (orgId) prodQ = prodQ.where(eq(products.orgId, orgId)) as any;
    const stockValue = await prodQ;
    const lowStockCond = sql`${products.stock} <= ${products.stockLimit} * 0.2 AND ${products.stock} > 0`;
    const lowStockWhere = and(lowStockCond, eq(products.orgId, orgId));
    const lowStock = await db.select({ count: sql<number>`COUNT(*)` }).from(products).where(lowStockWhere);
    const outStockWhere = and(eq(products.stock, 0), eq(products.orgId, orgId));
    const outOfStock = await db.select({ count: sql<number>`COUNT(*)` }).from(products).where(outStockWhere);

    const topMovingCond = sql`${orders.createdAt} >= ${fromDate} AND ${orders.createdAt} <= ${toDate} OR ${orders.createdAt} IS NULL`;
    const topMovingWhere = and(topMovingCond, eq(products.orgId, orgId));
    const topMoving = await db
      .select({
        product: products.name,
        sold: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`.as('sold'),
        remaining: products.stock
      })
      .from(products)
      .leftJoin(orderItems, eq(products.id, orderItems.productId))
      .leftJoin(orders, eq(orderItems.orderId, orders.id))
      .where(topMovingWhere)
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

  async getProfitAnalysis(startDate: Date, endDate: Date, orgId: string): Promise<any> {
    const revCond = orgId
      ? and(between(orders.createdAt, startDate, endDate), eq(orders.status, 'completed'), eq(orders.orgId, orgId))
      : and(between(orders.createdAt, startDate, endDate), eq(orders.status, 'completed'));
    const revenueData = await db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(revCond);

    const totalRevenue = revenueData[0]?.totalRevenue || 0;
    const orderCount = revenueData[0]?.orderCount || 0;

    const cogsCond = orgId
      ? and(between(orders.createdAt, startDate, endDate), eq(orders.status, 'completed'), eq(orders.orgId, orgId))
      : and(between(orders.createdAt, startDate, endDate), eq(orders.status, 'completed'));
    const cogsData = await db
      .select({
        totalCOGS: sql<number>`COALESCE(SUM(CAST(${orderItems.quantity} AS INTEGER) * CAST(${products.costPrice} AS DECIMAL)), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(cogsCond);

    const totalCOGS = cogsData[0]?.totalCOGS || 0;

    const expenses = await this.getExpenseAnalytics(startDate, endDate, orgId);

    // Calculate profit margins
    const grossProfit = totalRevenue - totalCOGS;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const operatingProfit = grossProfit - expenses.totalExpenses;
    const operatingMargin = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

    const netProfit = operatingProfit; // Could subtract taxes here if tracked
    const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    const dailyProfits = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`,
        revenue: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(revCond)
      .groupBy(sql`DATE(${orders.createdAt})`);

    const dailyCOGS = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`,
        cogs: sql<number>`COALESCE(SUM(CAST(${orderItems.quantity} AS INTEGER) * CAST(${products.costPrice} AS DECIMAL)), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(cogsCond)
      .groupBy(sql`DATE(${orders.createdAt})`);

    // Combine daily data
    const profitTrends = dailyProfits.map(day => {
      const dailyCog = dailyCOGS.find(c => c.date === day.date)?.cogs || 0;
      const revenue = Number(day.revenue) || 0;
      const cogs = Number(dailyCog) || 0;
      const dailyGrossProfit = revenue - cogs;
      const dailyNetProfit = dailyGrossProfit - expenses.dailyOverhead;

      return {
        date: day.date,
        revenue: revenue,
        cogs: cogs,
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
    const ordersData = await db
      .select({ order: orders, customer: customers })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(eq(orders.orgId, orgId))
      .orderBy(desc(orders.createdAt));

    // For each order, fetch order items with product details
    const invoices = await Promise.all(
      ordersData.map(async ({ order, customer }) => {
        const items = await db
          .select({
            item: orderItems,
            product: products,
          })
          .from(orderItems)
          .leftJoin(products, eq(orderItems.productId, products.id))
          .where(eq(orderItems.orderId, order.id));

        const createdAt = order.createdAt ?? new Date();
        const invoiceNumber = `INV-${new Date(createdAt).getFullYear()}-${order.id.slice(0, 8).toUpperCase()}`;
        const orderTotal = parseFloat(order.total);
        const subtotal = orderTotal / 1.2; // Assuming 20% VAT
        const vat = orderTotal - subtotal;
        const dueDate = new Date(createdAt);
        dueDate.setDate(dueDate.getDate() + 30); // 30 days payment terms

        // Determine invoice status
        let status: 'paid' | 'pending' | 'overdue' | 'cancelled' = 'pending';
        if (order.status === 'cancelled') {
          status = 'cancelled';
        } else if (order.status === 'completed') {
          status = 'paid';
        } else if (new Date() > dueDate) {
          status = 'overdue';
        }

        return {
          id: order.id,
          invoiceNumber,
          orderId: order.id,
          customerId: order.customerId,
          customerName: customer?.name || 'Walk-in Customer',
          customerEmail: customer?.email || '',
          date: (order.createdAt ?? new Date()).toISOString(),
          dueDate: dueDate.toISOString(),
          total: orderTotal,
          subtotal,
          vat,
          status,
          paymentMethod: order.paymentMethod,
          items: items.map(({ item, product }) => ({
            name: product?.name || 'Unknown Product',
            quantity: item.quantity,
            unitPrice: parseFloat(item.unitPrice),
            total: parseFloat(item.totalPrice)
          }))
        };
      })
    );

    return invoices;
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

  async getAllowedUsers(orgId: string): Promise<AllowedUser[]> {
    return db
      .select()
      .from(allowedUsers)
      .where(eq(allowedUsers.orgId, orgId))
      .orderBy(desc(allowedUsers.createdAt));
  }

  async adminGetAllAllowedUsers(): Promise<AllowedUser[]> {
    return db.select().from(allowedUsers).orderBy(desc(allowedUsers.createdAt));
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

  // Approval request operations
  async getPendingApprovals(): Promise<UserApprovalRequest[]> {
    return db
      .select()
      .from(userApprovalRequests)
      .where(eq(userApprovalRequests.status, 'pending'))
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

  async approveUser(
    replitUserId: string,
    approvedBy: string,
    options?: { role?: string; orgId?: string | null },
  ): Promise<void> {
    await db
      .update(userApprovalRequests)
      .set({
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: approvedBy,
      })
      .where(eq(userApprovalRequests.replitUserId, replitUserId));

    const [request] = await db
      .select()
      .from(userApprovalRequests)
      .where(eq(userApprovalRequests.replitUserId, replitUserId));

    if (request) {
      const [approver] = await db
        .select({ orgId: allowedUsers.orgId, role: allowedUsers.role, isOwner: allowedUsers.isOwner })
        .from(allowedUsers)
        .where(eq(allowedUsers.replitUserId, approvedBy));
      const approverRole = approver?.isOwner ? "SUPER_ADMIN" : (approver?.role ?? "CASHIER");
      const role = options?.role ?? "CASHIER";
      const orgId =
        options?.orgId !== undefined
          ? options.orgId
          : approverRole === "SUPER_ADMIN"
            ? options?.orgId ?? null
            : approver?.orgId ?? null;

      if (role === "SUPER_ADMIN") {
        throw new Error("Cannot approve new users as SUPER_ADMIN");
      }

      await this.addAllowedUser({
        replitUserId: request.replitUserId,
        authUserId: request.authUserId ?? request.replitUserId,
        authProvider: request.authProvider ?? "replit",
        email: request.email,
        name: request.name,
        isOwner: 0,
        orgId: role === "SUPER_ADMIN" ? null : orgId,
        role: role as Role,
      });
    }
  }

  async rejectUser(replitUserId: string, rejectedBy: string): Promise<void> {
    await db
      .update(userApprovalRequests)
      .set({
        status: 'rejected',
        reviewedAt: new Date(),
        reviewedBy: rejectedBy,
      })
      .where(eq(userApprovalRequests.replitUserId, replitUserId));
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

  async verifyApiKeyAndGetOrg(plainToken: string): Promise<{ orgId: string; scopes: string[] } | null> {
    const m = plainToken.match(/^mk_live_([a-f0-9]{24})_([a-f0-9]{48})$/i);
    if (!m) return null;
    const lookup = m[1].toLowerCase();
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyLookup, lookup), isNull(apiKeys.revokedAt)));
    for (const row of rows) {
      if (await bcrypt.compare(plainToken, row.secretHash)) {
        return { orgId: row.orgId, scopes: (row.scopes as string[]) ?? [] };
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