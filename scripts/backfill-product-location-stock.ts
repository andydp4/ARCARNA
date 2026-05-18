/**
 * Idempotent backfill: products -> product_location_stock
 * Run: npx tsx scripts/backfill-product-location-stock.ts
 */
import { db } from "../server/db";
import { products, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  ensureProductLocationStockRow,
  resolveProductLocationForBackfill,
  syncLegacyProductStockPlaceholder,
} from "../server/services/productLocationStock";

async function main() {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  let created = 0;
  let skipped = 0;
  const warnings: string[] = [];

  for (const org of orgs) {
    const orgProducts = await db.select().from(products).where(eq(products.orgId, org.id));

    for (const p of orgProducts) {
      const resolved = await resolveProductLocationForBackfill(org.id, {
        id: p.id,
        locationId: p.locationId,
        stock: p.stock,
        stockLimit: p.stockLimit,
      });

      if ("skip" in resolved) {
        skipped++;
        warnings.push(resolved.reason);
        continue;
      }

      const initial = p.stock ?? 0;
      await ensureProductLocationStockRow(
        org.id,
        p.id,
        resolved.locationId,
        initial,
        p.stockLimit ?? 10,
      );
      await syncLegacyProductStockPlaceholder(p.id);
      created++;
    }
  }

  console.log(`Backfill complete: upserted=${created} skipped=${skipped}`);
  if (warnings.length) {
    console.warn("Skipped warnings (first 20):");
    warnings.slice(0, 20).forEach((w) => console.warn(`  - ${w}`));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
