import { describe, it, expect } from "vitest";
import { parseOrderIntent, type IntentProduct } from "../whatsapp/intent";

const products: IntentProduct[] = [
  { productId: "COKE", name: "Coca Cola", aliases: ["coke", "cola"] },
  { productId: "WATER", name: "Still Water", aliases: ["water"] },
  { productId: "LRG-COKE", name: "Large Coke", aliases: ["large coke"] },
];

describe("parseOrderIntent", () => {
  it("matches a product alias and a numeric quantity", () => {
    const r = parseOrderIntent("Can I get 2 cokes please", products);
    expect(r.isOrderLike).toBe(true);
    const coke = r.items.find((i) => i.productId === "COKE");
    expect(coke?.quantity).toBe(2);
    expect(coke?.matched).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("parses 'x3' quantity syntax", () => {
    const r = parseOrderIntent("water x3", products);
    expect(r.items.find((i) => i.productId === "WATER")?.quantity).toBe(3);
  });

  it("parses number words and 'a' as 1", () => {
    const r = parseOrderIntent("can i have two waters", products);
    expect(r.items.find((i) => i.productId === "WATER")?.quantity).toBe(2);
  });

  it("prefers the longer alias (large coke over coke)", () => {
    const r = parseOrderIntent("I need a large coke", products);
    expect(r.items.some((i) => i.productId === "LRG-COKE")).toBe(true);
    expect(r.items.some((i) => i.productId === "COKE")).toBe(false);
  });

  it("defaults quantity to 1 when none is given", () => {
    const r = parseOrderIntent("send me water", products);
    expect(r.items.find((i) => i.productId === "WATER")?.quantity).toBe(1);
  });

  it("is not order-like for plain chit-chat", () => {
    const r = parseOrderIntent("hi, are you open today?", products);
    expect(r.items).toHaveLength(0);
    expect(r.isOrderLike).toBe(false);
  });

  it("matches by SKU as well as name", () => {
    const r = parseOrderIntent("order COKE please", products);
    expect(r.items.some((i) => i.productId === "COKE")).toBe(true);
  });
});
