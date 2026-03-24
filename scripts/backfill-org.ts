/**
 * Backfill orgId on existing rows. Run after db:push and before/after seed.
 * Usage: npx tsx scripts/backfill-org.ts
 *
 * - Creates default org if none exists
 * - Updates rows with null orgId to use the default org
 */
import { db } from "../server/db";
import {
  organizations,
  locations,
  products,
  customers,
  orders,
  orderItems,
  orderExpenses,
  invoices,
  loyaltyTiers,
  promotions,
  overheadExpenses,
} from "../shared/schema";
import { eq, isNull, sql } from "drizzle-orm";

const DEFAULT_ORG_NAME = "Default Organization";

async function backfill() {
  console.log("[Backfill] Starting org backfill...");

  let [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    [org] = await db.insert(organizations).values({ name: DEFAULT_ORG_NAME }).returning();
    console.log("[Backfill] Created default org:", org?.id);
  } else {
    console.log("[Backfill] Using existing org:", org.id);
  }
  if (!org) throw new Error("No org");

  const orgId = org.id;

  const updates: Array<{ table: string; count: number }> = [];

  const productResult = await db.update(products).set({ orgId }).where(isNull(products.orgId)).returning({ id: products.id });
  if (productResult.length > 0) updates.push({ table: "products", count: productResult.length });

  const customerResult = await db.update(customers).set({ orgId }).where(isNull(customers.orgId)).returning({ id: customers.id });
  if (customerResult.length > 0) updates.push({ table: "customers", count: customerResult.length });

  const orderResult = await db.update(orders).set({ orgId }).where(isNull(orders.orgId)).returning({ id: orders.id });
  if (orderResult.length > 0) updates.push({ table: "orders", count: orderResult.length });

  // Backfill order_items from parent order's orgId
  const orderItemRows = await db.select({ id: orderItems.id, orderId: orderItems.orderId }).from(orderItems).where(isNull(orderItems.orgId));
  for (const row of orderItemRows) {
    const [ord] = await db.select({ orgId: orders.orgId }).from(orders).where(eq(orders.id, row.orderId!)).limit(1);
    if (ord?.orgId) {
      await db.update(orderItems).set({ orgId: ord.orgId }).where(eq(orderItems.id, row.id));
    } else {
      await db.update(orderItems).set({ orgId }).where(eq(orderItems.id, row.id));
    }
  }
  if (orderItemRows.length > 0) updates.push({ table: "order_items", count: orderItemRows.length });

  const invoiceResult = await db.update(invoices).set({ orgId }).where(isNull(invoices.orgId)).returning({ id: invoices.id });
  if (invoiceResult.length > 0) updates.push({ table: "invoices", count: invoiceResult.length });

  const locationResult = await db.update(locations).set({ orgId }).where(isNull(locations.orgId)).returning({ id: locations.id });
  if (locationResult.length > 0) updates.push({ table: "locations", count: locationResult.length });

  const tierResult = await db.update(loyaltyTiers).set({ orgId }).where(isNull(loyaltyTiers.orgId)).returning({ id: loyaltyTiers.id });
  if (tierResult.length > 0) updates.push({ table: "loyalty_tiers", count: tierResult.length });

  const promoResult = await db.update(promotions).set({ orgId }).where(isNull(promotions.orgId)).returning({ id: promotions.id });
  if (promoResult.length > 0) updates.push({ table: "promotions", count: promoResult.length });

  const overheadResult = await db.update(overheadExpenses).set({ orgId }).where(isNull(overheadExpenses.orgId)).returning({ id: overheadExpenses.id });
  if (overheadResult.length > 0) updates.push({ table: "overhead_expenses", count: overheadResult.length });

  // Backfill order_expenses from parent order's orgId
  const orderExpRows = await db.select({ id: orderExpenses.id, orderId: orderExpenses.orderId }).from(orderExpenses).where(isNull(orderExpenses.orgId));
  for (const row of orderExpRows) {
    const [ord] = await db.select({ orgId: orders.orgId }).from(orders).where(eq(orders.id, row.orderId)).limit(1);
    if (ord?.orgId) {
      await db.update(orderExpenses).set({ orgId: ord.orgId }).where(eq(orderExpenses.id, row.id));
    } else {
      await db.update(orderExpenses).set({ orgId }).where(eq(orderExpenses.id, row.id));
    }
  }
  if (orderExpRows.length > 0) updates.push({ table: "order_expenses", count: orderExpRows.length });

  for (const u of updates) {
    console.log(`[Backfill] Updated ${u.count} rows in ${u.table}`);
  }
  if (updates.length === 0) {
    console.log("[Backfill] No rows needed backfill.");
  }
  console.log("[Backfill] Done.");
}

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[Backfill] Error:", err);
    process.exit(1);
  });
