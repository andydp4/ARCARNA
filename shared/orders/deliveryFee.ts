/**
 * The delivery fee (v1.2.1): a service charge on top of the goods, never part
 * of them. It is an order-level amount, not a product line, so it has no
 * stock, no cost and no minimum price by construction; stock, margin and the
 * price guard read the lines and never see it.
 *
 * Money rules (one place, read by the till, the server and the reports):
 *  - it counts in the order total and in takings;
 *  - it is VAT'd at the org rate (priceOrder() adds it to the VAT base);
 *  - tier and promotion discounts are on the goods only, never on the fee;
 *  - it is left out of commission and margin unless the org's admin setting
 *    "Delivery fee earns commission" is on (off by default).
 *
 * Pure: the till (online and offline), the server and the reports share it.
 */

export const DELIVERY_FEE_NAME_DEFAULT = "Delivery fee";
export const DELIVERY_FEE_PRICE_DEFAULT = 3;
export const DELIVERY_FEE_NAME_MAX = 60;
/** A typo guard, not a business rule: £100 covers any real delivery. */
export const DELIVERY_FEE_MAX = 100;

export type DeliveryFeeSettings = {
  name: string;
  /** The price one tap adds, in pounds. */
  defaultPrice: number;
  /** When true the fee counts towards the cashier's commission. Default false. */
  commissionable: boolean;
};

export const DEFAULT_DELIVERY_FEE_SETTINGS: DeliveryFeeSettings = {
  name: DELIVERY_FEE_NAME_DEFAULT,
  defaultPrice: DELIVERY_FEE_PRICE_DEFAULT,
  commissionable: false,
};

function toPence(pounds: number): number {
  return Math.round(Number((pounds * 100).toPrecision(12)));
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** The org row's three columns as settings; blanks fall back to the defaults. */
export function deliveryFeeSettingsFrom(row: {
  deliveryFeeName?: string | null;
  deliveryFeePrice?: string | number | null;
  deliveryFeeCommissionable?: boolean | null;
} | null | undefined): DeliveryFeeSettings {
  const name = String(row?.deliveryFeeName ?? "").trim();
  const price = row?.deliveryFeePrice == null ? DELIVERY_FEE_PRICE_DEFAULT : num(row.deliveryFeePrice);
  return {
    name: name || DELIVERY_FEE_NAME_DEFAULT,
    defaultPrice: Math.max(0, price),
    commissionable: row?.deliveryFeeCommissionable === true,
  };
}

export type DeliveryFeeCheck =
  | { ok: true; fee: number }
  | { ok: false; message: string; code: "DELIVERY_FEE_INVALID" | "DELIVERY_FEE_TOO_HIGH" | "DELIVERY_FEE_NOT_DELIVERY" };

/**
 * The fee a request asks for. Absent, null, blank or 0 is no fee (every order
 * from before the fee existed, and every offline sale queued by an older till,
 * reads as none). A fee on a collection or personal-use order is refused:
 * nothing was delivered, so nothing may be charged for it.
 */
export function readDeliveryFee(
  raw: unknown,
  context: { fulfilmentMethod: string | null | undefined; isPersonalUse?: boolean },
): DeliveryFeeCheck {
  if (raw === undefined || raw === null || raw === "") return { ok: true, fee: 0 };
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: "The delivery fee must be £0.00 or more.", code: "DELIVERY_FEE_INVALID" };
  }
  const pence = toPence(n);
  if (Math.abs(pence - n * 100) > 1e-6) {
    return { ok: false, message: "The delivery fee must be in pounds and pence.", code: "DELIVERY_FEE_INVALID" };
  }
  if (pence === 0) return { ok: true, fee: 0 };
  if (pence > toPence(DELIVERY_FEE_MAX)) {
    return {
      ok: false,
      message: `The delivery fee cannot be more than £${DELIVERY_FEE_MAX.toFixed(2)}.`,
      code: "DELIVERY_FEE_TOO_HIGH",
    };
  }
  if (context.isPersonalUse || context.fulfilmentMethod !== "delivery") {
    return {
      ok: false,
      message: "A delivery fee can only go on a delivery order.",
      code: "DELIVERY_FEE_NOT_DELIVERY",
    };
  }
  return { ok: true, fee: pence / 100 };
}

/** The stored fee as a number; NULL (orders from before the fee) is 0. */
export function storedDeliveryFee(row: { deliveryFee?: string | number | null } | null | undefined): number {
  return Math.max(0, num(row?.deliveryFee));
}

/**
 * The fee as the customer paid it: the fee plus the VAT on it at the order's
 * rate, in pence then pounds. What a refund of the fee gives back, and what
 * delivery fee takings count (they are VAT inclusive, like takings).
 */
export function deliveryFeeCharged(deliveryFee: number, vatRatePercent: number | null | undefined): number {
  const feeP = toPence(Math.max(0, deliveryFee));
  const vatP = Math.round((feeP * Math.max(0, Number(vatRatePercent) || 0)) / 100);
  return (feeP + vatP) / 100;
}

/**
 * What commission and margin are worked out on: the order's total less the
 * delivery fee (and the VAT charged on it), unless the org counts the fee.
 * Never below zero.
 */
export function amountExcludingDeliveryFee(
  total: number,
  deliveryFee: number,
  options: { commissionable?: boolean; vatRatePercent?: number } = {},
): number {
  if (options.commissionable) return total;
  const feeP = toPence(Math.max(0, deliveryFee));
  if (feeP === 0) return total;
  const vatP = Math.round((feeP * Math.max(0, options.vatRatePercent ?? 0)) / 100);
  return Math.max(0, toPence(total) - feeP - vatP) / 100;
}

/** "£3.50" for the receipt line and the till button. */
export function formatDeliveryFee(fee: number): string {
  return `£${Math.max(0, fee).toFixed(2)}`;
}

/**
 * The share of an order's total that is goods, 0–1: what commission scales
 * the money collected by, so a part-paid or credit order leaves the fee out in
 * proportion. 1 when there is no fee, or when the org counts the fee.
 */
export function goodsShareOfTotal(
  total: number,
  deliveryFee: number,
  options: { commissionable?: boolean; vatRatePercent?: number } = {},
): number {
  if (options.commissionable || !(deliveryFee > 0) || !(total > 0)) return 1;
  const goods = amountExcludingDeliveryFee(total, deliveryFee, options);
  return Math.min(1, Math.max(0, goods / total));
}
