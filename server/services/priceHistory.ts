import { and, desc, eq } from "drizzle-orm";
import { productPriceHistory, users } from "@shared/schema";
import { priceChanges, type PriceChangeSource, type PriceSnapshot } from "@shared/pricing/floor";
import { db } from "../db";

/**
 * Price history (v1.2 Phase 2, PRC-07). Every writer of a product's sale
 * price, minimum or cost calls `recordPriceChanges` with the row before and
 * after, inside the same transaction as the write, so a change that saved
 * always has its record and a record never outlives a rolled-back change.
 */

// Any drizzle executor: the app db, a transaction, or the engine's getDb().
// The two drizzle instances have different static types, so only the one
// method used is described.
type Executor = { insert: (table: typeof productPriceHistory) => { values: (rows: any[]) => PromiseLike<unknown> } };

export async function recordPriceChanges(
  executor: Executor,
  input: {
    orgId: string;
    productId: string;
    before: PriceSnapshot;
    after: PriceSnapshot;
    changedBy: string | null;
    source: PriceChangeSource;
  },
): Promise<number> {
  const changes = priceChanges(input.before, input.after);
  if (changes.length === 0) return 0;
  await executor.insert(productPriceHistory).values(
    changes.map((c) => ({
      orgId: input.orgId,
      productId: input.productId,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      changedBy: input.changedBy,
      source: input.source,
    })),
  );
  return changes.length;
}

export type PriceHistoryEntry = {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  source: string;
  changedBy: string | null;
  changedByName: string | null;
  createdAt: Date;
};

export async function listPriceHistory(orgId: string, productId: string, limit = 200): Promise<PriceHistoryEntry[]> {
  const rows = await db
    .select({
      id: productPriceHistory.id,
      field: productPriceHistory.field,
      oldValue: productPriceHistory.oldValue,
      newValue: productPriceHistory.newValue,
      source: productPriceHistory.source,
      changedBy: productPriceHistory.changedBy,
      createdAt: productPriceHistory.createdAt,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(productPriceHistory)
    .leftJoin(users, eq(users.id, productPriceHistory.changedBy))
    .where(and(eq(productPriceHistory.orgId, orgId), eq(productPriceHistory.productId, productId)))
    .orderBy(desc(productPriceHistory.createdAt), desc(productPriceHistory.id))
    .limit(limit);
  return rows.map((r) => {
    const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
    return {
      id: r.id,
      field: r.field,
      oldValue: r.oldValue,
      newValue: r.newValue,
      source: r.source,
      changedBy: r.changedBy,
      changedByName: name || r.email || null,
      createdAt: r.createdAt,
    };
  });
}
