import { describe, expect, it } from "vitest";
import {
  addProductToOrderLines,
  makeLine,
  selectProductForOrderLine,
  type PosOrderLine,
} from "../posOrderLines";
import type { PosProduct } from "@/components/pos-product-card";

function product(id: string, price = "10.00"): PosProduct {
  return {
    id,
    name: `Product ${id}`,
    productId: id,
    defaultSalePrice: price,
    stock: 100,
    stockLimit: 10,
  };
}

function line(productId: string, quantity: number, price = "10.00"): PosOrderLine {
  const base = makeLine(product(productId, price));
  return {
    ...base,
    quantity,
    subtotal: quantity * base.customPrice,
  };
}

describe("POS order-line product selection", () => {
  it("increments quantity instead of adding a duplicate from the blank row", () => {
    const existing = [line("A", 2)];
    const next = addProductToOrderLines(existing, product("A"));

    expect(next).toHaveLength(1);
    expect(next[0].product.id).toBe("A");
    expect(next[0].quantity).toBe(3);
    expect(next[0].subtotal).toBe(30);
  });

  it("replaces a line with a distinct product and resets the default price", () => {
    const next = selectProductForOrderLine([line("A", 2, "12.00")], 0, product("B", "7.50"));

    expect(next).toHaveLength(1);
    expect(next[0].product.id).toBe("B");
    expect(next[0].quantity).toBe(2);
    expect(next[0].customPrice).toBe(7.5);
    expect(next[0].subtotal).toBe(15);
  });

  it("merges quantity when a line is changed to an existing product", () => {
    const next = selectProductForOrderLine([line("A", 4), line("B", 3)], 0, product("B"));

    expect(next).toHaveLength(1);
    expect(next[0].product.id).toBe("B");
    expect(next[0].quantity).toBe(7);
    expect(next[0].subtotal).toBe(70);
  });
});
