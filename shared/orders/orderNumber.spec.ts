import { describe, expect, it } from "vitest";
import { INVOICE_NUMBER_START, ORDER_NUMBER_START, displayOrderNumber, nextIssuedNumber } from "./orderNumber";

describe("shop order and invoice numbers", () => {
  it("starts at the floor when nothing has been issued", () => {
    expect(nextIssuedNumber(null, 1000, ORDER_NUMBER_START)).toBe(ORDER_NUMBER_START);
    expect(nextIssuedNumber(null, null, INVOICE_NUMBER_START)).toBe(INVOICE_NUMBER_START);
  });

  it("continues past a number already used, including one above the floor", () => {
    expect(nextIssuedNumber(ORDER_NUMBER_START, 1000, ORDER_NUMBER_START)).toBe(ORDER_NUMBER_START + 1);
    expect(nextIssuedNumber(440_000_050, 1000, INVOICE_NUMBER_START)).toBe(440_000_051);
  });

  it("does not go backwards when the start number is lowered", () => {
    expect(nextIssuedNumber(440_400_010, 1000, ORDER_NUMBER_START)).toBe(440_400_011);
  });

  it("jumps up when the start number is raised past the floor", () => {
    expect(nextIssuedNumber(ORDER_NUMBER_START, 500_000_000, ORDER_NUMBER_START)).toBe(500_000_000);
  });

  it("shows the issued number, and the start of the old reference when there is none", () => {
    expect(displayOrderNumber("abcdef12-3456-7890-abcd-ef1234567890", 440_400_001)).toBe("440400001");
    expect(displayOrderNumber("abcdef12-3456-7890-abcd-ef1234567890", null)).toBe("abcdef12");
  });
});
