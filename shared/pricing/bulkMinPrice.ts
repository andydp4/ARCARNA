import { z } from "zod";
import { usableCost } from "../purchasing/purchaseLines";
import { checkMinPrice, salePriceOf, storedMinPrice, type FloorProduct } from "./floor";

/**
 * Bulk "Set minimum price" (v1.2 Phase 4, PRC-05). One rule applied to many
 * products, shown as a preview first and written to price history. The same
 * function produces the preview and the write, so what was previewed is what
 * is saved.
 */

export const BULK_MIN_RULES = ["follow", "sale_minus_pct", "cost_plus_pct", "fixed"] as const;
export type BulkMinRuleKind = (typeof BULK_MIN_RULES)[number];

/**
 * "Cost + x%" needs a real margin. The minimum is shown to cashiers at the
 * till, so cost + 0% would print the cost on the till (owner Q4).
 */
export const COST_PLUS_MIN_PERCENT = 1;

export const bulkMinRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("follow") }),
  z.object({ kind: z.literal("sale_minus_pct"), percent: z.number().finite().min(0).max(100) }),
  z.object({ kind: z.literal("cost_plus_pct"), percent: z.number().finite().min(COST_PLUS_MIN_PERCENT).max(1000) }),
  z.object({ kind: z.literal("fixed"), amount: z.number().finite().min(0).max(1_000_000) }),
]);
export type BulkMinRule = z.infer<typeof bulkMinRuleSchema>;

export const bulkMinRequestSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(2000),
  rule: bulkMinRuleSchema,
});

export const BULK_MIN_RULE_LABELS: Record<BulkMinRuleKind, string> = {
  follow: "Follow the sale price",
  sale_minus_pct: "Sale price − x%",
  cost_plus_pct: "Cost + x%",
  fixed: "A fixed £",
};

export type BulkMinSkip = "NO_COST" | "MIN_ABOVE_SALE";

export type BulkMinPreviewRow = {
  productId: string;
  name: string;
  salePrice: number;
  /** Stored minimum, or null when it follows the sale price. */
  oldMin: number | null;
  /** The new stored minimum, or null for "follows the sale price". */
  newMin: number | null;
  changed: boolean;
  skipped: BulkMinSkip | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The minimum one product would get under the rule. */
export function bulkMinFor(
  product: FloorProduct,
  rule: BulkMinRule,
): { newMin: number | null; skipped: BulkMinSkip | null } {
  const sale = salePriceOf(product);
  let next: number | null;
  switch (rule.kind) {
    case "follow":
      next = null;
      break;
    case "sale_minus_pct":
      next = round2(sale * (1 - rule.percent / 100));
      break;
    case "cost_plus_pct": {
      const cost = usableCost(product.costPrice ?? null);
      if (cost == null) return { newMin: null, skipped: "NO_COST" };
      next = round2(cost * (1 + rule.percent / 100));
      break;
    }
    case "fixed":
      next = round2(rule.amount);
      break;
  }
  if (next != null && checkMinPrice(next, sale)) return { newMin: next, skipped: "MIN_ABOVE_SALE" };
  return { newMin: next, skipped: null };
}

export function bulkMinPreview(
  products: Array<FloorProduct & { id: string; name: string }>,
  rule: BulkMinRule,
): BulkMinPreviewRow[] {
  return products.map((p) => {
    const { newMin, skipped } = bulkMinFor(p, rule);
    const oldMin = storedMinPrice(p.minPrice);
    return {
      productId: p.id,
      name: p.name,
      salePrice: salePriceOf(p),
      oldMin,
      newMin,
      changed: !skipped && oldMin !== newMin,
      skipped,
    };
  });
}

export function bulkMinSkipLabel(skip: BulkMinSkip): string {
  return skip === "NO_COST" ? "No cost set" : "Would be above the sale price";
}

export function describeBulkMinRule(rule: BulkMinRule): string {
  switch (rule.kind) {
    case "follow":
      return "follow the sale price";
    case "sale_minus_pct":
      return `sale price −${rule.percent}%`;
    case "cost_plus_pct":
      return `cost +${rule.percent}%`;
    case "fixed":
      return `£${rule.amount.toFixed(2)}`;
  }
}
