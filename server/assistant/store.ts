/**
 * Arcarna Assistant data-access layer (org-scoped, read-only).
 *
 * Direct Drizzle access, mirroring server/whatsapp/store.ts. The QuickEntry
 * engine itself is pure (no DB access) — this module supplies it with
 * products and the customers a spoken name could mean. It creates nothing:
 * since v1.2 Phase 1B a draft opens in the till instead of being saved.
 */
import { and, eq, ilike } from "drizzle-orm";
import { db } from "../db";
import { customers, products, type Customer } from "@shared/schema";
import type { IntentProduct } from "../whatsapp/intent";

export interface AssistantProduct extends IntentProduct {
  id: string; // products.id UUID
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

/** Escape LIKE/ILIKE wildcards so a customer name is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Resolve a spoken/typed customer name to existing candidates (case-insensitive).
 * Returns an exact-name match first if present, otherwise customers whose name
 * contains the term — letting the caller offer a pick list instead of blindly
 * creating a duplicate. Capped to keep the prompt short.
 */
export async function findCustomerCandidatesByName(
  orgId: string,
  name: string,
  limit = 5,
): Promise<Customer[]> {
  const term = name.trim();
  if (!term) return [];
  // Every exact match, not the first: two customers called "Bunny" is the
  // case that must be asked about.
  const exact = await db
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, orgId), ilike(customers.name, escapeLike(term))))
    .limit(limit);
  if (exact.length > 0) return exact;
  return db
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, orgId), ilike(customers.name, `%${escapeLike(term)}%`)))
    .limit(limit);
}
