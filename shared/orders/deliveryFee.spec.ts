import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELIVERY_FEE_SETTINGS,
  amountExcludingDeliveryFee,
  deliveryFeeSettingsFrom,
  goodsShareOfTotal,
  readDeliveryFee,
  storedDeliveryFee,
} from "./deliveryFee";

const delivery = { fulfilmentMethod: "delivery" };

describe("readDeliveryFee: what a sale may be charged for delivery", () => {
  it("reads no fee from an order that sends none (older tills, queued offline sales)", () => {
    for (const raw of [undefined, null, "", 0, "0", "0.00"]) {
      expect(readDeliveryFee(raw, delivery)).toEqual({ ok: true, fee: 0 });
    }
    // Even on a collection: sending nothing is never an error.
    expect(readDeliveryFee(undefined, { fulfilmentMethod: "collection" })).toEqual({ ok: true, fee: 0 });
  });

  it("takes pounds and pence, as a number or a typed string", () => {
    expect(readDeliveryFee(3.5, delivery)).toEqual({ ok: true, fee: 3.5 });
    expect(readDeliveryFee(" 4.25 ", delivery)).toEqual({ ok: true, fee: 4.25 });
    expect(readDeliveryFee("3.35", delivery)).toEqual({ ok: true, fee: 3.35 });
  });

  it("refuses a negative, unreadable, sub-penny or oversized fee", () => {
    expect(readDeliveryFee(-1, delivery)).toMatchObject({ ok: false, code: "DELIVERY_FEE_INVALID" });
    expect(readDeliveryFee("three", delivery)).toMatchObject({ ok: false, code: "DELIVERY_FEE_INVALID" });
    expect(readDeliveryFee(2.555, delivery)).toMatchObject({ ok: false, code: "DELIVERY_FEE_INVALID" });
    expect(readDeliveryFee(100.01, delivery)).toMatchObject({ ok: false, code: "DELIVERY_FEE_TOO_HIGH" });
    expect(readDeliveryFee(100, delivery)).toEqual({ ok: true, fee: 100 });
  });

  it("refuses a fee on a collection or on personal use: nothing was delivered", () => {
    expect(readDeliveryFee(3, { fulfilmentMethod: "collection" })).toMatchObject({
      ok: false,
      code: "DELIVERY_FEE_NOT_DELIVERY",
    });
    expect(readDeliveryFee(3, { fulfilmentMethod: "delivery", isPersonalUse: true })).toMatchObject({
      ok: false,
      code: "DELIVERY_FEE_NOT_DELIVERY",
    });
  });
});

describe("the org's delivery fee settings", () => {
  it("default to 'Delivery fee', £3.00 and not counted in commission", () => {
    expect(deliveryFeeSettingsFrom(null)).toEqual(DEFAULT_DELIVERY_FEE_SETTINGS);
    expect(DEFAULT_DELIVERY_FEE_SETTINGS).toEqual({ name: "Delivery fee", defaultPrice: 3, commissionable: false });
  });

  it("read the org's columns, numeric strings included", () => {
    expect(
      deliveryFeeSettingsFrom({ deliveryFeeName: " Van charge ", deliveryFeePrice: "4.50", deliveryFeeCommissionable: true }),
    ).toEqual({ name: "Van charge", defaultPrice: 4.5, commissionable: true });
    expect(deliveryFeeSettingsFrom({ deliveryFeeName: "  " }).name).toBe("Delivery fee");
  });
});

describe("commission and margin leave the fee out by default", () => {
  it("storedDeliveryFee reads NULL (orders from before the fee) as none", () => {
    expect(storedDeliveryFee({ deliveryFee: null })).toBe(0);
    expect(storedDeliveryFee({ deliveryFee: "3.50" })).toBe(3.5);
    expect(storedDeliveryFee(undefined)).toBe(0);
  });

  it("takes the fee and the VAT on it off the total", () => {
    expect(amountExcludingDeliveryFee(53.5, 3.5)).toBe(50);
    // £50 goods + £3.50 fee at 20%: total £64.20; the fee brought in £4.20.
    expect(amountExcludingDeliveryFee(64.2, 3.5, { vatRatePercent: 20 })).toBe(60);
    expect(amountExcludingDeliveryFee(53.5, 3.5, { commissionable: true })).toBe(53.5);
    expect(amountExcludingDeliveryFee(2, 3.5)).toBe(0);
  });

  it("goodsShareOfTotal scales money collected to the goods part", () => {
    expect(goodsShareOfTotal(53.5, 3.5)).toBeCloseTo(50 / 53.5, 10);
    expect(goodsShareOfTotal(53.5, 0)).toBe(1);
    expect(goodsShareOfTotal(53.5, 3.5, { commissionable: true })).toBe(1);
    expect(goodsShareOfTotal(0, 3.5)).toBe(1);
  });
});
