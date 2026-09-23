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

/** What a person sees when the org has no VAT rate set (v1.2 Phase 1B). */
export const ORG_VAT_RATE_MISSING_MESSAGE =
  "Set your VAT rate in Settings before taking orders (0% if you are not VAT registered).";

/**
 * The org has no VAT rate set. Orders are refused rather than priced at a
 * fallback: a guessed rate is exactly how the engine once charged 20% at a
 * shop that was not VAT registered.
 */
export class OrgVatRateMissingError extends Error {
  readonly statusCode = 422;
  readonly code = "ORG_VAT_RATE_MISSING";
  constructor() {
    super(ORG_VAT_RATE_MISSING_MESSAGE);
    this.name = "OrgVatRateMissingError";
  }
}

/** The org's rate, or OrgVatRateMissingError. Every order path uses this. */
export async function requireOrgTaxRatePercent(orgId: string | null | undefined): Promise<number> {
  const rate = await getOrgTaxRatePercent(orgId);
  if (rate === undefined || rate < 0 || rate > 100) throw new OrgVatRateMissingError();
  return rate;
}
