import { describe, expect, it } from "vitest";
import { productHref, productIdFromSearch } from "../productLink";

describe("product links", () => {
  it("round-trips a product id through the Products page URL", () => {
    const id = "prod 1/å";
    const href = productHref(id);
    expect(href.startsWith("/products?product=")).toBe(true);
    expect(productIdFromSearch(href.split("?")[1])).toBe(id);
    expect(productIdFromSearch(`?${href.split("?")[1]}`)).toBe(id);
  });

  it("finds nothing when no product is asked for", () => {
    expect(productIdFromSearch("")).toBeUndefined();
    expect(productIdFromSearch("?tab=all&product=")).toBeUndefined();
  });
});
