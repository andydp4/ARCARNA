import { describe, it, expect } from "vitest";
import { generateGiftCardCode, validateGiftCardCode, luhnCheckDigitBase32, maskGiftCardCode } from "./code";
import { applyRedeem, applyVoid, canRedeemAmount, roundMoney } from "./balance";

describe("gift card code", () => {
  it("generates valid 16-char codes", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateGiftCardCode();
      expect(code).toHaveLength(16);
      expect(validateGiftCardCode(code)).toBe(true);
    }
  });
  it("rejects invalid check digit", () => {
    const code = generateGiftCardCode();
    expect(validateGiftCardCode(code.slice(0, -1) + (code.endsWith("A") ? "B" : "A"))).toBe(false);
  });
  it("masks to last 4", () => expect(maskGiftCardCode("ABCDEFGHIJKLMNOP")).toBe("****MNOP"));
  it("deterministic check digit", () => {
    const body = "ABCDEFGHIJKLMNO";
    expect(luhnCheckDigitBase32(body)).toBe(luhnCheckDigitBase32(body));
  });
});

describe("gift card balance", () => {
  it("never goes negative", () => {
    expect(() => applyRedeem(10, 15)).toThrow(/negative/i);
    expect(canRedeemAmount(10, 15, "active", null).ok).toBe(false);
  });
  it("partial redeem", () => {
    const r = applyRedeem(20, 15);
    expect(r).toEqual({ newBalance: 5, status: "active" });
  });
  it("full redeem", () => {
    const r = applyRedeem(15, 15);
    expect(r).toEqual({ newBalance: 0, status: "redeemed" });
  });
  it("void", () => expect(applyVoid()).toEqual({ newBalance: 0, status: "void" }));
  it("rejects void card", () => expect(canRedeemAmount(50, 10, "void", null).ok).toBe(false));
  it("rejects expired", () => {
    expect(canRedeemAmount(50, 10, "active", new Date("2020-01-01"), new Date("2025-01-01")).ok).toBe(false);
  });
  it("idempotent check", () => {
    expect(canRedeemAmount(roundMoney(20), 15, "active", null).ok).toBe(true);
    expect(canRedeemAmount(roundMoney(5), 15, "active", null).ok).toBe(false);
  });
});
