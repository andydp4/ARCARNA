import { eq } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "@shared/schema";

/**
 * The org's configured VAT/sales-tax rate as a percentage (e.g. 20 for 20%),
 * or `undefined` when the org has not set one.
 *
 * `undefined` rather than a hardcoded fallback is deliberate: callers pass this
 * straight into `placeOrder`, whose schema treats an absent `taxRatePercent` as
 * "use DEFAULT_TAX_RATE_PERCENT". Substituting 20 here would look identical
 * today and silently diverge the moment that default changes.
 *
 * Every path that places an order must use this, so the till and the website
 * cannot drift apart: the engine hardcoded 20% once before while the POS showed
 * 10%, and the customer was quoted one total and charged another.
 */
export async function getOrgTaxRatePercent(
  orgId: string | null | undefined,
): Promise<number | undefined> {
  if (!orgId) return undefined;
  const [org] = await db
    .select({ defaultTaxRate: organizations.defaultTaxRate })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (org?.defaultTaxRate == null) return undefined;
  const rate = Number(org.defaultTaxRate);
  return Number.isFinite(rate) ? rate : undefined;
}
