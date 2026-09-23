/**
 * Bulk "Set minimum price" (v1.2 Phase 4, PRC-05): managers and admins.
 *
 * The preview and the write run the same rule (shared/pricing/bulkMinPrice.ts)
 * on the same rows, and the write locks those rows first, so what is saved is
 * what the rule gives on the prices as they stand. Every change goes to price
 * history in the same transaction. A manager's bulk change tells the owner.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { products } from "@shared/schema";
import { bulkMinPreview, describeBulkMinRule, type BulkMinPreviewRow, type BulkMinRule } from "@shared/pricing/bulkMinPrice";
import { recordPriceChanges } from "./priceHistory";
import { notify } from "./signals";
import { resolveUserNames } from "./userDisplayName";

type Executor = typeof db | any;

async function loadProducts(client: Executor, orgId: string, ids: string[], lock: boolean) {
  const q = client
    .select()
    .from(products)
    .where(and(eq(products.orgId, orgId), inArray(products.id, ids)));
  return lock ? q.for("update") : q;
}

export async function previewBulkMin(orgId: string, productIds: string[], rule: BulkMinRule): Promise<BulkMinPreviewRow[]> {
  const rows = await loadProducts(db, orgId, productIds, false);
  return bulkMinPreview(rows, rule).sort((a, b) => a.name.localeCompare(b.name));
}

export async function applyBulkMin(args: {
  orgId: string;
  productIds: string[];
  rule: BulkMinRule;
  actorId: string;
  actorRole: string;
}): Promise<{ changed: number; skipped: number; rows: BulkMinPreviewRow[] }> {
  return db.transaction(async (tx: Executor) => {
    const before = await loadProducts(tx, args.orgId, args.productIds, true);
    const rows = bulkMinPreview(before, args.rule);
    const byId = new Map<string, (typeof before)[number]>(before.map((p: any) => [p.id, p]));
    let changed = 0;
    for (const row of rows) {
      if (!row.changed) continue;
      const old = byId.get(row.productId)!;
      const minPrice = row.newMin == null ? null : row.newMin.toFixed(2);
      const [after] = await tx
        .update(products)
        .set({ minPrice, updatedAt: new Date() })
        .where(eq(products.id, row.productId))
        .returning();
      await recordPriceChanges(tx, {
        orgId: args.orgId,
        productId: row.productId,
        before: old,
        after,
        changedBy: args.actorId,
        source: "bulk",
      });
      changed++;
    }
    const skipped = rows.filter((r) => r.skipped).length;
    // A manager's bulk change is the owner's to know (PRC-05).
    if (changed > 0 && args.actorRole === "MANAGER") {
      const who = (await resolveUserNames([args.actorId])).get(args.actorId) ?? "A manager";
      await notify(
        {
          orgId: args.orgId,
          title: `Minimum prices changed in bulk — ${who}`,
          message: `${who} set the minimum price on ${changed} product${changed === 1 ? "" : "s"} to ${describeBulkMinRule(args.rule)}.${skipped ? ` ${skipped} skipped.` : ""} See each product's price history.`,
          severity: "info",
          source: "bulk_min_price",
          metadata: { productIds: rows.filter((r) => r.changed).map((r) => r.productId).slice(0, 200) },
        },
        tx,
      );
    }
    return { changed, skipped, rows };
  });
}
