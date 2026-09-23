import { describe, expect, it } from "vitest";
import { stockLevelStatus, toStockLevelRow } from "./stockLevels";

describe("toStockLevelRow", () => {
  it("keeps only the allow-listed fields — no cost, margin or price", () => {
    const row = toStockLevelRow({
      id: "p1",
      name: "Cola",
      productId: "COLA-1",
      barcode: "501",
      stock: 4,
      stockLimit: 20,
      costPrice: "13.37",
      defaultSalePrice: "2.00",
      margin: 50,
    } as never);
    expect(Object.keys(row).sort()).toEqual(["barcode", "id", "name", "sku", "status", "stock", "stockLimit"]);
    expect(JSON.stringify(row)).not.toContain("13.37");
  });
});

describe("stockLevelStatus", () => {
  it("uses the shared 30% low-stock line", () => {
    expect(stockLevelStatus(0, 20)).toBe("out");
    expect(stockLevelStatus(6, 20)).toBe("low");
    expect(stockLevelStatus(7, 20)).toBe("ok");
    expect(stockLevelStatus(3, 0)).toBe("ok");
  });
});
