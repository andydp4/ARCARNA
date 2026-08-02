/**
 * Quantities are decimal, not whole.
 *
 * Every quantity column was `integer`, so a shop could not sell 0.4 of
 * anything. Anyone trading by weight or length — deli, produce, fabric, cable,
 * timber — could not put their real catalogue through the till.
 *
 * One place defines what a quantity is, so the database column, the request
 * schema and the input field cannot drift apart the way the tax rate did.
 */
import { z } from "zod";

/** Decimal places stored. Matches numeric(14,3) — see migrations/046. */
export const QUANTITY_SCALE = 3;

/** Smallest representable step: one thousandth. */
export const QUANTITY_STEP = 10 ** -QUANTITY_SCALE;

/**
 * Upper bound for a single quantity. Well inside numeric(14,3), and inside the
 * range where a float64 still represents thousandths exactly — past roughly
 * 2^53/1000 it would not, and a silently rounded quantity is worse than a
 * rejected one.
 */
export const QUANTITY_MAX = 1_000_000_000;

/**
 * Rounds to the stored scale. Read/modify/write on a float can otherwise leave
 * a value the column cannot hold (0.1 + 0.2 = 0.30000000000000004), which
 * Postgres would round on write — so the number in the app and the number in
 * the ledger would differ by a hair, and reconciliation would find it.
 */
export function roundQuantity(value: number): number {
  return Math.round(value * 10 ** QUANTITY_SCALE) / 10 ** QUANTITY_SCALE;
}

/** True when `value` needs no rounding to be stored exactly. */
export function isStorableQuantity(value: number): boolean {
  return Number.isFinite(value) && roundQuantity(value) === value;
}

const scaleMessage = `Quantity supports up to ${QUANTITY_SCALE} decimal places`;

/** A quantity that must be greater than zero — a sale, a receipt, a transfer. */
export const positiveQuantity = z
  .number()
  .finite()
  .positive()
  .max(QUANTITY_MAX)
  .refine(isStorableQuantity, { message: scaleMessage });

/** A quantity that may be zero — damaged counts, thresholds, opening stock. */
export const nonNegativeQuantity = z
  .number()
  .finite()
  .min(0)
  .max(QUANTITY_MAX)
  .refine(isStorableQuantity, { message: scaleMessage });

/**
 * Parses a quantity typed into an input. `parseInt` was the reason a decimal
 * silently failed at the till: it reads "0.4" as 0, the row is dropped as
 * empty, and the product disappears off the screen with no error shown.
 */
export function parseQuantityInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const rounded = roundQuantity(parsed);
  if (rounded <= 0 || rounded > QUANTITY_MAX) return null;
  return rounded;
}

/** Trims trailing zeros so 2.000 reads as "2" and 0.400 as "0.4". */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(roundQuantity(value));
}
