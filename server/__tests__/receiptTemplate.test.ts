import { describe, it, expect } from "vitest";
import {
  renderReceiptTemplate,
  buildSampleReceiptContext,
  DEFAULT_RECEIPT_TEMPLATE,
} from "../templates/receipt.html.ts";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../services/receiptSigning";

describe("receipt template", () => {
  it("renders line items and totals from sample context", () => {
    const ctx = buildSampleReceiptContext("https://example.com/unsub");
    const html = renderReceiptTemplate(DEFAULT_RECEIPT_TEMPLATE, ctx);
    expect(html).toContain("Espresso Beans 250g");
    expect(html).toContain("£50.00");
    expect(html).toContain("https://example.com/unsub");
    expect(html).not.toContain("{{order.total}}");
  });
});

describe("receipt signing", () => {
  it("round-trips unsubscribe tokens", () => {
    process.env.RECEIPT_SIGNING_SECRET = "test-secret";
    const token = signUnsubscribeToken("cust-1", "user@example.com");
    const parsed = verifyUnsubscribeToken(token);
    expect(parsed).toEqual({ customerId: "cust-1", email: "user@example.com" });
  });

  it("rejects tampered tokens", () => {
    process.env.RECEIPT_SIGNING_SECRET = "test-secret";
    const token = signUnsubscribeToken("cust-1", "user@example.com");
    const parsed = verifyUnsubscribeToken(token + "x");
    expect(parsed).toBeNull();
  });
});
