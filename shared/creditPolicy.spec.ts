import { describe, expect, it } from "vitest";
import {
  checkClearWholeTab,
  checkCreditPaidOn,
  creditPaymentNeedsSignal,
  parseCreditPaymentMethod,
  requireCreditPaymentMethod,
} from "./creditPolicy";
import { checkTemplateConsent, isMarketingTemplate } from "./marketingConsent";

describe("credit payment method (FIX-12)", () => {
  it("accepts cash, card and transfer, in any case; nothing sent is cash", () => {
    expect(parseCreditPaymentMethod(undefined)).toEqual({ ok: true, method: "cash" });
    expect(parseCreditPaymentMethod("Card")).toEqual({ ok: true, method: "card" });
    expect(parseCreditPaymentMethod(" transfer ")).toEqual({ ok: true, method: "transfer" });
  });

  it("refuses anything else rather than storing it", () => {
    for (const bad of ["tick", "gift_card", "bitcoin", "<script>", 12]) {
      const verdict = parseCreditPaymentMethod(bad);
      expect(verdict.ok, String(bad)).toBe(false);
    }
  });

  it("card and transfer recorded below admin raise a Signal; cash and admins do not", () => {
    expect(creditPaymentNeedsSignal("card", "MANAGER")).toBe(true);
    expect(creditPaymentNeedsSignal("transfer", "CASHIER")).toBe(true);
    expect(creditPaymentNeedsSignal("cash", "MANAGER")).toBe(false);
    expect(creditPaymentNeedsSignal("card", "ADMIN")).toBe(false);
    expect(creditPaymentNeedsSignal("card", "SUPER_ADMIN")).toBe(false);
  });
});

describe("backdating a credit payment", () => {
  const today = "2026-09-23";

  it("today, or nothing, is today", () => {
    expect(checkCreditPaidOn(undefined, today, "CASHIER")).toEqual({ ok: true, paidOn: null });
    expect(checkCreditPaidOn(today, today, "CASHIER")).toEqual({ ok: true, paidOn: null });
  });

  it("a manager may backdate within the order window (7 days)", () => {
    expect(checkCreditPaidOn("2026-09-16", today, "MANAGER")).toEqual({ ok: true, paidOn: "2026-09-16" });
    expect(checkCreditPaidOn("2026-09-20", today, "ADMIN")).toEqual({ ok: true, paidOn: "2026-09-20" });
  });

  it("refuses a cashier, the future, too far back and a non-date", () => {
    expect(checkCreditPaidOn("2026-09-20", today, "CASHIER")).toMatchObject({ ok: false, status: 403 });
    expect(checkCreditPaidOn("2026-09-24", today, "SUPER_ADMIN")).toMatchObject({ ok: false, code: "CREDIT_DATE_FUTURE" });
    expect(checkCreditPaidOn("2026-09-15", today, "SUPER_ADMIN")).toMatchObject({ ok: false, code: "CREDIT_DATE_OUT_OF_RANGE" });
    expect(checkCreditPaidOn("23/09/2026", today, "MANAGER")).toMatchObject({ ok: false, code: "CREDIT_DATE_INVALID" });
    expect(checkCreditPaidOn("2026-02-30", today, "MANAGER")).toMatchObject({ ok: false, code: "CREDIT_DATE_INVALID" });
  });
});

describe("clearing a whole tab", () => {
  it("needs the exact balance", () => {
    expect(checkClearWholeTab(125.5, 125.5)).toEqual({ ok: true });
    expect(checkClearWholeTab("125.50", 125.5)).toEqual({ ok: true });
    expect(checkClearWholeTab(undefined, 125.5)).toMatchObject({ ok: false, status: 400 });
    expect(checkClearWholeTab(100, 125.5)).toMatchObject({ ok: false, status: 409, code: "CREDIT_BALANCE_CHANGED" });
  });
});

describe("marketing WhatsApp templates (PRV-14)", () => {
  it("marketing, and unknown category, count as marketing", () => {
    expect(isMarketingTemplate({ category: "MARKETING" })).toBe(true);
    expect(isMarketingTemplate({ category: "marketing" })).toBe(true);
    expect(isMarketingTemplate({ category: null })).toBe(true);
    expect(isMarketingTemplate(null)).toBe(true);
    expect(isMarketingTemplate({ category: "UTILITY" })).toBe(false);
  });

  it("is blocked until consent is recorded; utility is not", () => {
    expect(checkTemplateConsent({ category: "MARKETING" }, null)).toMatchObject({
      ok: false,
      code: "marketing_consent_required",
    });
    expect(checkTemplateConsent({ category: "MARKETING" }, { consentRecordedAt: null }).ok).toBe(false);
    expect(checkTemplateConsent({ category: "MARKETING" }, { consentRecordedAt: "2026-09-01" }).ok).toBe(true);
    expect(checkTemplateConsent({ category: "UTILITY" }, null).ok).toBe(true);
  });
});

describe("Clear account needs Paid by (v1.2 Phase 1C)", () => {
  it("refuses a clear with no method, rather than assuming cash", () => {
    for (const missing of [undefined, null, "", "  "]) {
      const verdict = requireCreditPaymentMethod(missing);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe("CREDIT_METHOD_REQUIRED");
    }
  });

  it("accepts cash, card or transfer and still refuses anything else", () => {
    expect(requireCreditPaymentMethod("Cash")).toEqual({ ok: true, method: "cash" });
    expect(requireCreditPaymentMethod("transfer")).toEqual({ ok: true, method: "transfer" });
    expect(requireCreditPaymentMethod("tick").ok).toBe(false);
  });
});
