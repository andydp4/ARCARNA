/**
 * Limits a sale has to fit before anything is written, and plain words for a
 * sale the till sent that does not validate (v1.2.1 e2e, E2E-08 and E2E-09).
 *
 * Money columns on orders and order lines are numeric(10,2): the largest
 * amount one can hold is £99,999,999.99. Each line on its own passes the
 * per-line bounds (quantity under 10,000, price under £1,000,000), but a typo
 * such as 9,999 × £999,999 does not fit, and the database refused it half way
 * through writing the sale, which the till saw as "Failed to create order"
 * (a 500 it retries for ever when queued offline).
 */
import type { ZodError } from "zod";

/** The largest amount a numeric(10,2) money column holds. */
export const MAX_SALE_AMOUNT = 99_999_999.99;

type SaleLine = { quantity: number; unitPrice: number };

const gbp = (n: number) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A sentence for the till when a line or the whole sale is too large to
 * record, or null when it fits. VAT is included, as the total will be.
 */
export function saleTooLargeMessage(lines: SaleLine[], taxRatePercent = 0): string | null {
  const vat = 1 + Math.max(0, Number(taxRatePercent) || 0) / 100;
  let total = 0;
  for (const [i, line] of lines.entries()) {
    const lineTotal = Number(line.quantity) * Number(line.unitPrice) * vat;
    if (!Number.isFinite(lineTotal) || lineTotal > MAX_SALE_AMOUNT) {
      return `Line ${i + 1} comes to ${gbp(lineTotal)}, which is more than one sale can record (${gbp(MAX_SALE_AMOUNT)}). Check the quantity and price.`;
    }
    total += lineTotal;
  }
  if (total > MAX_SALE_AMOUNT) {
    return `This sale comes to ${gbp(total)}, which is more than one sale can record (${gbp(MAX_SALE_AMOUNT)}). Check the quantities and prices.`;
  }
  return null;
}

const FIELD_WORDS: Record<string, string> = {
  quantity: "quantity",
  unitPrice: "price",
  productId: "product",
  customerId: "customer",
  lines: "items",
};

/**
 * The first validation problem as one sentence the till can show in its
 * toast, e.g. "Line 1 quantity: Quantity must be more than 0". The full
 * issue list still goes back as `errors` for anything that wants detail.
 */
export function plainValidationMessage(error: Pick<ZodError, "issues">): string {
  const issue = error.issues?.[0];
  if (!issue) return "Some of the sale's details are not valid.";
  const path = issue.path ?? [];
  let where = "";
  if (path[0] === "lines" && typeof path[1] === "number") {
    const field = typeof path[2] === "string" ? FIELD_WORDS[path[2]] ?? path[2] : "";
    where = `Line ${path[1] + 1}${field ? ` ${field}` : ""}: `;
  } else if (typeof path[0] === "string") {
    where = `${FIELD_WORDS[path[0]] ?? path[0]}: `;
  }
  const words = where ? where.charAt(0).toUpperCase() + where.slice(1) : "";
  return `${words}${issue.message}`;
}
