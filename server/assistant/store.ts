/**
 * Arcarna Assistant data-access layer (org-scoped).
 *
 * Direct Drizzle access, mirroring server/whatsapp/store.ts. The QuickEntry
 * engine itself is pure (no DB access) — this module supplies it with
 * products and turns a confirmed draft into a real order.
 */
import { and, eq, ilike } from "drizzle-orm";
import { db } from "../db";
import { customers, products, type Customer } from "@shared/schema";
import type { IntentProduct } from "../whatsapp/intent";
import type { QuickEntryDraft } from "./quickEntry";

export interface AssistantProduct extends IntentProduct {
  id: string; // products.id UUID, needed by DomainEngine.placeOrder
}

/** Products in a shape that covers both the intent matcher (SKU) and order lines (UUID). */
export async function getProductsForAssistant(orgId: string): Promise<AssistantProduct[]> {
  const rows = await db
    .select({
      id: products.id,
      productId: products.productId,
      name: products.name,
      aliases: products.aliases,
    })
    .from(products)
    .where(eq(products.orgId, orgId));
  return rows.map((r) => ({ id: r.id, productId: r.productId, name: r.name, aliases: r.aliases ?? [] }));
}

/** Find an existing customer by name (case-insensitive), or create one. */
export async function findOrCreateCustomerByName(orgId: string, name: string): Promise<Customer> {
  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, orgId), ilike(customers.name, name)))
    .limit(1);
  if (existing) return existing;
  const now = new Date();
  const [created] = await db
    .insert(customers)
    .values({
      orgId,
      name,
      source: "assistant",
      address: "Created from Arcarna Voice",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created;
}

/** Maps a confirmed QuickEntryDraft's items onto product UUIDs for placeOrder. */
export function resolveOrderLines(
  draft: QuickEntryDraft,
  products: AssistantProduct[],
): Array<{ productId: string; quantity: number; unitPrice: number }> {
  const bySku = new Map(products.map((p) => [p.productId, p]));
  return draft.items.map((item) => {
    const match = bySku.get(item.productId);
    if (!match) throw new Error(`Unknown product: ${item.name}`);
    return { productId: match.id, quantity: item.quantity, unitPrice: item.unitPrice ?? 0 };
  });
}
