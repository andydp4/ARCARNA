import { describe, expect, it } from "vitest";
import {
  MIN_PRICE_CLEAR_TOKEN,
  checkMinPrice,
  effectiveFloor,
  minPriceBelowCost,
  parseMinPriceCell,
  priceChanges,
  storedMinPrice,
} from "./floor";
import { previewProductImportFromMappedRows } from "../productImport";

describe("effectiveFloor", () => {
  it("follows the sale price when no minimum is stored, and moves with it", () => {
    const a = effectiveFloor({ minPrice: null, defaultSalePrice: "4.50" });
    expect(a).toMatchObject({ floor: 4.5, minimum: 4.5, followsSalePrice: true, source: "sale_price" });
    const b = effectiveFloor({ minPrice: null, defaultSalePrice: "3.99" });
    expect(b.floor).toBe(3.99);
    expect(effectiveFloor({ minPrice: "", salePrice: 2 }).floor).toBe(2);
  });

  it("uses a stored minimum, including a real £0 minimum", () => {
    expect(effectiveFloor({ minPrice: "3.00", defaultSalePrice: "4.50" })).toMatchObject({
      floor: 3,
      followsSalePrice: false,
      source: "minimum",
    });
    expect(effectiveFloor({ minPrice: 0, defaultSalePrice: "4.50" }).floor).toBe(0);
  });

  it("takes the higher of the minimum and the known cost", () => {
    expect(effectiveFloor({ minPrice: "3.00", defaultSalePrice: "4.50", costPrice: "3.20" })).toMatchObject({
      floor: 3.2,
      cost: 3.2,
      source: "cost",
    });
    expect(effectiveFloor({ minPrice: "3.00", defaultSalePrice: "4.50", costPrice: "2.00" }).floor).toBe(3);
  });

  it("treats a £0 or blank cost as unknown (usableCost rule)", () => {
    expect(effectiveFloor({ minPrice: "1.00", defaultSalePrice: "4.50", costPrice: "0.00" })).toMatchObject({
      floor: 1,
      cost: null,
    });
    expect(effectiveFloor({ minPrice: "1.00", defaultSalePrice: "4.50", costPrice: null }).cost).toBeNull();
  });

  it("gives the till a minimum-only floor that never carries cost", () => {
    const till = effectiveFloor({ minPrice: "1.00", defaultSalePrice: "4.50", costPrice: "3.00" }, { includeCost: false });
    expect(till).toMatchObject({ floor: 1, cost: null, source: "minimum" });
  });
});

describe("minimum price rules", () => {
  it("refuses a minimum above the sale price and allows one at or below it", () => {
    expect(checkMinPrice("5.00", "4.50")?.code).toBe("MIN_ABOVE_SALE");
    expect(checkMinPrice("4.50", "4.50")).toBeNull();
    expect(checkMinPrice(null, "4.50")).toBeNull();
    expect(checkMinPrice("", "4.50")).toBeNull();
  });

  it("warns (only) when the minimum is below the known cost", () => {
    expect(minPriceBelowCost("2.00", "3.00")).toBe(true);
    expect(minPriceBelowCost("3.00", "3.00")).toBe(false);
    expect(minPriceBelowCost("2.00", "0")).toBe(false);
    expect(minPriceBelowCost("", "3.00")).toBe(false);
  });

  it("reads a stored minimum as null when empty", () => {
    expect(storedMinPrice(null)).toBeNull();
    expect(storedMinPrice("")).toBeNull();
    expect(storedMinPrice("2.50")).toBe(2.5);
    expect(storedMinPrice(-1)).toBeNull();
  });
});

describe("parseMinPriceCell (import)", () => {
  it("keeps on blank, clears on the token, sets on a number, refuses junk", () => {
    expect(parseMinPriceCell(undefined)).toBeUndefined();
    expect(parseMinPriceCell("")).toBeUndefined();
    expect(parseMinPriceCell("  ")).toBeUndefined();
    expect(parseMinPriceCell(MIN_PRICE_CLEAR_TOKEN)).toBeNull();
    expect(parseMinPriceCell("clear")).toBeNull();
    expect(parseMinPriceCell(null)).toBeNull();
    expect(parseMinPriceCell("£3.50")).toBe(3.5);
    expect(parseMinPriceCell(2)).toBe(2);
    expect(parseMinPriceCell("abc")).toBe("invalid");
    expect(parseMinPriceCell("-1")).toBe("invalid");
  });

  it("flows through the import preview", () => {
    const preview = previewProductImportFromMappedRows([
      { name: "Keep", "Sale Price": "4.50", "Min Price": "" },
      { name: "Set", "Sale Price": "4.50", "Min Price": "4.00" },
      { name: "Clear", "Sale Price": "4.50", "Minimum Price": "CLEAR" },
      { name: "Above", "Sale Price": "4.50", "Min Price": "5.00" },
      { name: "Junk", "Sale Price": "4.50", "Min Price": "cheap" },
    ]);
    const [keep, set, clear, above, junk] = preview.rows;
    expect(keep.errors).toEqual([]);
    // undefined, so it never reaches the server: JSON drops the key and the stored minimum is kept.
    expect(JSON.parse(JSON.stringify(keep.data))).not.toHaveProperty("minPrice");
    expect(set.data.minPrice).toBe(4);
    expect(clear.data.minPrice).toBeNull();
    expect(JSON.parse(JSON.stringify(clear.data))).toHaveProperty("minPrice", null);
    expect(above.errors.join(" ")).toMatch(/above the sale price/);
    expect(junk.errors.join(" ")).toMatch(/Invalid minimum price/);
  });
});

describe("priceChanges (price history)", () => {
  it("lists only the figures that changed, as stored two-decimal strings or null", () => {
    expect(
      priceChanges(
        { defaultSalePrice: "4.50", minPrice: null, costPrice: "2.00" },
        { defaultSalePrice: "4.00", minPrice: "3.50", costPrice: "2.00" },
      ),
    ).toEqual([
      { field: "sale", oldValue: "4.50", newValue: "4.00" },
      { field: "min", oldValue: null, newValue: "3.50" },
    ]);
    expect(priceChanges({ costPrice: "2.00" }, { costPrice: null })).toEqual([
      { field: "cost", oldValue: "2.00", newValue: null },
    ]);
    expect(priceChanges({ defaultSalePrice: "4.5" }, { defaultSalePrice: 4.5 })).toEqual([]);
  });
});
