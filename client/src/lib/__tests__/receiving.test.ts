import { describe, expect, it } from "vitest";
import { buildGoodsReceiptItems } from "../receiving";

describe("buildGoodsReceiptItems", () => {
  it("keeps fractional received and damaged quantities", () => {
    const items = buildGoodsReceiptItems(
      [
        { id: "line-a", productId: "product-a" },
        { id: "line-b", productId: "product-b" },
      ],
      {
        "line-a": { received: "0.4", damaged: "0.1" },
        "line-b": { received: "2", damaged: "0" },
      },
    );

    expect(items).toEqual([
      {
        purchaseDraftItemId: "line-a",
        productId: "product-a",
        quantityReceived: 0.4,
        quantityDamaged: 0.1,
      },
      {
        purchaseDraftItemId: "line-b",
        productId: "product-b",
        quantityReceived: 2,
        quantityDamaged: 0,
      },
    ]);
  });

  it("drops only invalid or empty received quantities", () => {
    const items = buildGoodsReceiptItems(
      [
        { id: "line-empty", productId: "product-empty" },
        { id: "line-zero", productId: "product-zero" },
        { id: "line-valid", productId: "product-valid" },
      ],
      {
        "line-empty": { received: "" },
        "line-zero": { received: "0" },
        "line-valid": { received: "1.25", damaged: "not-a-number" },
      },
    );

    expect(items).toEqual([
      {
        purchaseDraftItemId: "line-valid",
        productId: "product-valid",
        quantityReceived: 1.25,
        quantityDamaged: 0,
      },
    ]);
  });
});
