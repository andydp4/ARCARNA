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

/** Escape LIKE/ILIKE wildcards so a customer name is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function isExactCustomerNameMatch(candidateName: string, requestedName: string): boolean {
  return candidateName.trim().toLocaleLowerCase() === requestedName.trim().toLocaleLowerCase();
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
  const exact = await db
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, orgId), ilike(customers.name, escapeLike(term))))
    .limit(1);
  if (exact.length > 0) return exact;
  return db
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, orgId), ilike(customers.name, `%${escapeLike(term)}%`)))
    .limit(limit);
}

/**
 * Find an existing customer by name, or create one.
 * Only exact (case-insensitive) names are safe to auto-bind while saving an
 * assistant order. Partial matches are suggestions for a future pick list; in
 * the write path they could silently attach an order to the wrong customer.
 */
export async function findOrCreateCustomerByName(orgId: string, name: string): Promise<Customer> {
  const candidates = await findCustomerCandidatesByName(orgId, name, 2);
  const exact = candidates.find((candidate) => isExactCustomerNameMatch(candidate.name, name));
  if (exact) return exact;
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
