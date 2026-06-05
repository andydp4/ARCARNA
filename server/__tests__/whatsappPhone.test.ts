import { describe, it, expect } from "vitest";
import { toWhatsappNumber, toDisplayPhone, phonesMatch } from "../whatsapp/phone";

describe("toWhatsappNumber", () => {
  it("converts a UK local number to international digits", () => {
    expect(toWhatsappNumber("07805597760", "44")).toBe("447805597760");
  });

  it("strips spaces, dashes and brackets", () => {
    expect(toWhatsappNumber("(07805) 597 760", "44")).toBe("447805597760");
  });

  it("keeps an explicit + international number", () => {
    expect(toWhatsappNumber("+447805597760", "44")).toBe("447805597760");
  });

  it("leaves a number already starting with the country code", () => {
    expect(toWhatsappNumber("447805597760", "44")).toBe("447805597760");
  });

  it("prepends country code to a bare national number", () => {
    expect(toWhatsappNumber("7805597760", "44")).toBe("447805597760");
  });

  it("returns empty for empty input", () => {
    expect(toWhatsappNumber("", "44")).toBe("");
  });
});

describe("toDisplayPhone", () => {
  it("adds a leading +", () => {
    expect(toDisplayPhone("447805597760")).toBe("+447805597760");
  });
});

describe("phonesMatch (customer auto-match)", () => {
  it("matches a stored UK local number against an inbound wa_id", () => {
    expect(phonesMatch("447805597760", "07805597760")).toBe(true);
  });

  it("matches with formatting differences", () => {
    expect(phonesMatch("+44 7805 597760", "07805 597760")).toBe(true);
  });

  it("does not match different numbers", () => {
    expect(phonesMatch("447805597760", "447700900999")).toBe(false);
  });
});
