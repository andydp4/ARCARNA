import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  db: {},
}));

import { isExactCustomerNameMatch } from "../assistant/store";

describe("assistant customer matching", () => {
  it("only treats exact names as safe to auto-bind while saving an order", () => {
    expect(isExactCustomerNameMatch("John Smith", "john smith")).toBe(true);
    expect(isExactCustomerNameMatch(" John Smith ", "john smith")).toBe(true);
    expect(isExactCustomerNameMatch("John Smith", "Smith")).toBe(false);
    expect(isExactCustomerNameMatch("Joann's Cafe", "Ann")).toBe(false);
  });
});
