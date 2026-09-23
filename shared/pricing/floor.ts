import { usableCost } from "../purchasing/purchaseLines";

/**
 * The minimum price and the floor (v1.2 Phase 2, PRC-01).
 *
 * `products.min_price` is empty by default and empty means "follows the sale
 * price": a copied figure would go stale the first time the price changed.
 * `effectiveFloor()` is the ONLY place the floor is worked out — the till,
 * the server, the product form and Evidence all call it, so they can never
 * disagree about what counts as underpriced.
 */

type Money = string | number | null | undefined;

export type FloorProduct = {
  minPrice?: Money;
  /** products.default_sale_price; `salePrice` is accepted for engine-shaped rows. */
  defaultSalePrice?: Money;
  salePrice?: Money;
  costPrice?: Money;
};

export type FloorSource = "minimum" | "sale_price" | "cost";

export type Floor = {
  /** The lowest price that is not underpriced. */
  floor: number;
  /** The minimum as it applies today: the stored one, or the sale price when empty. */
  minimum: number;
  /** True when no minimum is stored and it follows the sale price. */
  followsSalePrice: boolean;
  /** Known cost (usableCost rule), or null when not known or not asked for. */
  cost: number | null;
  /** Which figure set the floor. */
  source: FloorSource;
};

function money(value: Money): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A stored minimum, or null for "follows the sale price". £0 is a real
 * minimum ("any price is fine"), unlike a £0 cost, which means nobody entered one.
 */
export function storedMinPrice(value: Money): number | null {
  const n = money(value);
  return n != null && n >= 0 ? n : null;
}

export function salePriceOf(product: FloorProduct): number {
  return money(product.defaultSalePrice ?? product.salePrice) ?? 0;
}

/**
 * The floor for one product: the higher of the minimum and the known cost.
 * `includeCost: false` is the till's version — minimum only, never cost
 * (owner decision Q4: the till never carries a cost figure).
 */
export function effectiveFloor(product: FloorProduct, opts: { includeCost?: boolean } = {}): Floor {
  const includeCost = opts.includeCost ?? true;
  const stored = storedMinPrice(product.minPrice);
  const minimum = stored ?? salePriceOf(product);
  const cost = includeCost ? usableCost(product.costPrice ?? null) : null;
  const minimumSource: FloorSource = stored == null ? "sale_price" : "minimum";
  if (cost != null && cost > minimum) {
    return { floor: cost, minimum, followsSalePrice: stored == null, cost, source: "cost" };
  }
  return { floor: minimum, minimum, followsSalePrice: stored == null, cost, source: minimumSource };
}

export type MinPriceProblem = { code: "MIN_ABOVE_SALE"; message: string };

/** A minimum above the sale price is refused: nothing could ever sell at list. */
export function checkMinPrice(minPrice: Money, salePrice: Money): MinPriceProblem | null {
  const min = storedMinPrice(minPrice);
  const sale = money(salePrice);
  if (min == null || sale == null) return null;
  if (min > sale + 1e-9) {
    return {
      code: "MIN_ABOVE_SALE",
      message: `The minimum price (£${min.toFixed(2)}) is above the sale price (£${sale.toFixed(2)}). Lower the minimum or clear it so it follows the sale price.`,
    };
  }
  return null;
}

/** A minimum below the known cost is allowed, with a gentle warning. */
export function minPriceBelowCost(minPrice: Money, costPrice: Money): boolean {
  const min = storedMinPrice(minPrice);
  const cost = usableCost(costPrice ?? null);
  return min != null && cost != null && min < cost - 1e-9;
}

/**
 * The import cell that clears a stored minimum. A blank cell leaves the value
 * as it is (a sheet without the column must not wipe every floor), so clearing
 * needs a word nobody types by accident.
 */
export const MIN_PRICE_CLEAR_TOKEN = "CLEAR";

/**
 * An import cell for the minimum price:
 * `undefined` keep what is there, `null` clear it, a number set it,
 * `"invalid"` refuse the row.
 */
export function parseMinPriceCell(value: unknown): number | null | undefined | "invalid" {
  if (value === undefined) return undefined;
  // A JSON null reaches the server when the browser preview already turned
  // the clear token into "clear".
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : "invalid";
  const s = String(value).trim();
  if (s === "") return undefined;
  if (s.toUpperCase() === MIN_PRICE_CLEAR_TOKEN) return null;
  const n = Number(s.replace(/[£$€\s,]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

// ---------------------------------------------------------------------------
// Price history (PRC-07).
// ---------------------------------------------------------------------------

export type PriceField = "sale" | "min" | "cost";
export const PRICE_FIELDS: readonly PriceField[] = ["sale", "min", "cost"];

export type PriceChangeSource = "form" | "import" | "create";

export type PriceSnapshot = {
  defaultSalePrice?: Money;
  minPrice?: Money;
  costPrice?: Money;
};

export type PriceChange = { field: PriceField; oldValue: string | null; newValue: string | null };

/** Two-decimal string or null — the numeric(10,2) shape both sides compare in. */
function asStored(value: Money): string | null {
  const n = money(value);
  return n == null ? null : n.toFixed(2);
}

/** The sale, minimum and cost changes between two versions of a product row. */
export function priceChanges(before: PriceSnapshot, after: PriceSnapshot): PriceChange[] {
  const pairs: [PriceField, Money, Money][] = [
    ["sale", before.defaultSalePrice, after.defaultSalePrice],
    ["min", before.minPrice, after.minPrice],
    ["cost", before.costPrice, after.costPrice],
  ];
  const out: PriceChange[] = [];
  for (const [field, a, b] of pairs) {
    const oldValue = asStored(a);
    const newValue = asStored(b);
    if (oldValue !== newValue) out.push({ field, oldValue, newValue });
  }
  return out;
}
