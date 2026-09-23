import { and, eq } from "drizzle-orm";
import { products } from "@shared/schema";
import { canEditMinPrice } from "@shared/accessPolicy";
import { checkMinPrice } from "@shared/pricing/floor";
import { recordPriceChanges } from "./priceHistory";

/**
 * Product create and edit from the product form (v1.2 Phase 2). The rules on
 * the minimum price live here, on the server, so no client can skip them:
 *   - only managers and admins set it;
 *   - it may not sit above the sale price (checked against the price the
 *     product will have AFTER the save, so lowering the sale price alone below
 *     a stored minimum is refused too — the form offers to lower both);
 *   - every sale / minimum / cost change is written to price history in the
 *     same transaction as the change.
 */

export class ProductPricingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductPricingError";
  }
}

type Money = number | null | undefined;

export type ProductEditPatch = {
  salePrice?: number;
  costPrice?: Money;
  minPrice?: Money;
  [key: string]: unknown;
};

function refuseMinPriceFor(role: string | null | undefined, minPrice: Money) {
  if (minPrice !== undefined && !canEditMinPrice(role)) {
    throw new ProductPricingError(403, "MIN_PRICE_FORBIDDEN", "Only a manager or an admin can set a minimum price.");
  }
}

async function apps() {
  const { withTransaction, getDb } = await import("../../apps/server/src/db");
  const { engine } = await import("../../apps/server/src/engine.wiring");
  return { withTransaction, getDb, engine };
}

export async function createProductWithPricing(input: {
  orgId: string;
  body: ProductEditPatch & { defaultSalePrice?: number };
  role: string | null | undefined;
  actorId: string | null;
}) {
  const { body } = input;
  refuseMinPriceFor(input.role, body.minPrice);
  const salePrice = body.salePrice ?? body.defaultSalePrice ?? 0;
  const problem = checkMinPrice(body.minPrice, salePrice);
  if (problem) throw new ProductPricingError(400, problem.code, problem.message);

  const { withTransaction, getDb, engine } = await apps();
  return withTransaction(async () => {
    const created = await engine.createProduct({ ...body, orgId: input.orgId });
    const [after] = await getDb().select().from(products).where(eq(products.id, created.id as string));
    // The first prices are history too: the tab starts from where it began.
    if (after) {
      await recordPriceChanges(getDb(), {
        orgId: input.orgId,
        productId: after.id,
        before: {},
        after,
        changedBy: input.actorId,
        source: "create",
      });
    }
    return created;
  });
}

export async function updateProductWithPricing(input: {
  orgId: string;
  productId: string;
  patch: ProductEditPatch;
  role: string | null | undefined;
  actorId: string | null;
}) {
  const { patch } = input;
  refuseMinPriceFor(input.role, patch.minPrice);

  const { withTransaction, getDb, engine } = await apps();
  return withTransaction(async () => {
    // Locked so a concurrent edit cannot slip between the rule check and the
    // write, and so the "old" figure in history is the one really replaced.
    const [before] = await getDb()
      .select()
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.orgId, input.orgId)))
      .for("update");
    if (!before) throw new ProductPricingError(404, "NOT_FOUND", "Product not found");

    const nextSale = patch.salePrice ?? before.defaultSalePrice;
    const nextMin = patch.minPrice !== undefined ? patch.minPrice : before.minPrice;
    const problem = checkMinPrice(nextMin, nextSale);
    if (problem) throw new ProductPricingError(400, problem.code, problem.message);

    const updated = await engine.updateProduct(input.productId, patch, input.orgId);
    const [after] = await getDb().select().from(products).where(eq(products.id, input.productId));
    await recordPriceChanges(getDb(), {
      orgId: input.orgId,
      productId: input.productId,
      before,
      after,
      changedBy: input.actorId,
      source: "form",
    });
    return updated;
  });
}
