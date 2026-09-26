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

describe("receipt privacy notice (PRV-15)", () => {
  it("adds nothing until the owner fills the fields in", () => {
    const ctx = buildSampleReceiptContext("https://example.com/unsub");
    const html = renderReceiptTemplate(DEFAULT_RECEIPT_TEMPLATE, { ...ctx, privacy: { noticeUrl: null } });
    expect(html).not.toContain("privacy notice");
    expect(html).not.toContain("{{privacy}}");
  });

  it("links the notice and the complaints contact, escaped", () => {
    const ctx = buildSampleReceiptContext("https://example.com/unsub");
    const html = renderReceiptTemplate(DEFAULT_RECEIPT_TEMPLATE, {
      ...ctx,
      privacy: { noticeUrl: "https://shop.example/privacy", complaintsName: "Sam <Owner>", complaintsEmail: "dpo@shop.example" },
    });
    expect(html).toContain('href="https://shop.example/privacy"');
    expect(html).toContain("Sam &lt;Owner&gt;");
    expect(html).toContain('href="mailto:dpo@shop.example"');
  });

  it("still appears on a custom template with no placeholder", () => {
    const ctx = buildSampleReceiptContext("https://example.com/unsub");
    const html = renderReceiptTemplate("<html><body><p>{{org.name}}</p></body></html>", {
      ...ctx,
      privacy: { complaintsEmail: "dpo@shop.example" },
    });
    expect(html).toMatch(/dpo@shop\.example<\/a>\.<\/p><\/body>/);
  });

  it("never links a non-web address", () => {
    const ctx = buildSampleReceiptContext("https://example.com/unsub");
    const html = renderReceiptTemplate(DEFAULT_RECEIPT_TEMPLATE, { ...ctx, privacy: { noticeUrl: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
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
