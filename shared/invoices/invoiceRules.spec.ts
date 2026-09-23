import { describe, expect, it } from "vitest";
import {
  dueDateFromTerms,
  formatInvoiceNumber,
  invoiceAmountDue,
  invoiceAmounts,
  invoiceStatus,
  nextInvoiceSequence,
  paymentDaysFromTerms,
  showsVatLine,
} from "./invoiceRules";

const today = "2026-09-23";
const tab = (status: string, given: number, outstanding: number) => ({ status, amountGiven: given, amountOutstanding: outstanding });

describe("invoice status: one rule (v1.2 Phase 1C)", () => {
  it("a tab sale nobody has paid is owed, even though the order is completed", () => {
    expect(
      invoiceStatus({ orderStatus: "completed", orderTotal: 40, credit: tab("outstanding", 40, 40), dueDate: "2026-10-23", today }),
    ).toBe("owed");
  });

  it("part of it paid is part-paid; all of it paid is paid", () => {
    expect(
      invoiceStatus({ orderStatus: "completed", orderTotal: 40, credit: tab("partial", 40, 15), dueDate: "2026-10-23", today }),
    ).toBe("part-paid");
    expect(
      invoiceStatus({ orderStatus: "completed", orderTotal: 40, credit: tab("settled", 40, 0), dueDate: "2026-09-01", today }),
    ).toBe("paid");
  });

  it("past the due date with money outstanding is overdue, part-paid or not", () => {
    expect(
      invoiceStatus({ orderStatus: "completed", orderTotal: 40, credit: tab("outstanding", 40, 40), dueDate: "2026-09-22", today }),
    ).toBe("overdue");
    expect(
      invoiceStatus({ orderStatus: "completed", orderTotal: 40, credit: tab("partial", 40, 10), dueDate: "2026-09-22", today }),
    ).toBe("overdue");
    // The due date itself is still in time.
    expect(
      invoiceStatus({ orderStatus: "completed", orderTotal: 40, credit: tab("outstanding", 40, 40), dueDate: today, today }),
    ).toBe("owed");
  });

  it("a voided or written-off tab, or a cancelled order, is void", () => {
    expect(invoiceStatus({ orderStatus: "completed", orderTotal: 40, credit: tab("voided", 40, 0), dueDate: null, today })).toBe("void");
    expect(invoiceStatus({ orderStatus: "completed", orderTotal: 40, credit: tab("written_off", 40, 0), dueDate: null, today })).toBe("void");
    expect(invoiceStatus({ orderStatus: "cancelled", orderTotal: 40, credit: null, dueDate: null, today })).toBe("void");
  });

  it("without a tab, a completed sale was paid at the till; one not yet completed is owed", () => {
    expect(invoiceStatus({ orderStatus: "completed", orderTotal: 12, credit: null, dueDate: "2026-01-01", today })).toBe("paid");
    expect(invoiceStatus({ orderStatus: "pending", orderTotal: 12, credit: null, dueDate: "2026-10-01", today })).toBe("owed");
    expect(invoiceStatus({ orderStatus: "pending", orderTotal: 12, credit: null, dueDate: "2026-09-01", today })).toBe("overdue");
  });

  it("a till sale paid at the till is paid while still pending, whatever its terms", () => {
    // Every till sale is pending until completed on the board; its legs say it was paid.
    expect(invoiceStatus({ orderStatus: "pending", orderTotal: 40, credit: null, paidAtTill: 40, dueDate: "2026-09-01", today })).toBe(
      "paid",
    );
    expect(invoiceAmountDue({ orderStatus: "pending", orderTotal: 40, credit: null, paidAtTill: 40, dueDate: null, today })).toBe(0);
    // A tab leg is not money taken: a pending tick sale is owed.
    expect(invoiceStatus({ orderStatus: "pending", orderTotal: 40, credit: null, paidAtTill: 0, dueDate: "2026-10-01", today })).toBe(
      "owed",
    );
    expect(invoiceStatus({ orderStatus: "pending", orderTotal: 40, credit: null, paidAtTill: 15, dueDate: "2026-10-01", today })).toBe(
      "part-paid",
    );
    expect(invoiceAmountDue({ orderStatus: "pending", orderTotal: 40, credit: null, paidAtTill: 15, dueDate: null, today })).toBe(25);
  });

  it("amount due follows the same rule", () => {
    expect(invoiceAmountDue({ orderStatus: "completed", orderTotal: 40, credit: tab("partial", 40, 15), dueDate: null, today })).toBe(15);
    expect(invoiceAmountDue({ orderStatus: "completed", orderTotal: 40, credit: tab("voided", 40, 0), dueDate: null, today })).toBe(0);
    expect(invoiceAmountDue({ orderStatus: "completed", orderTotal: 40, credit: null, dueDate: null, today })).toBe(0);
  });
});

describe("payment terms", () => {
  it("reads the usual forms and falls back to 30 days", () => {
    expect(paymentDaysFromTerms("Net 30")).toBe(30);
    expect(paymentDaysFromTerms("14 days")).toBe(14);
    expect(paymentDaysFromTerms("Due on receipt")).toBe(0);
    expect(paymentDaysFromTerms("")).toBe(30);
    expect(paymentDaysFromTerms(null)).toBe(30);
    expect(paymentDaysFromTerms("end of month")).toBe(30);
    expect(paymentDaysFromTerms("Net 999")).toBe(365);
  });

  it("dates the invoice from the day it is issued", () => {
    expect(dueDateFromTerms("2026-09-23", "Net 14")).toBe("2026-10-07");
    expect(dueDateFromTerms("2026-09-23", "Due on receipt")).toBe("2026-09-23");
  });
});

describe("invoice numbers", () => {
  it("start at the org's start number and go up by one", () => {
    expect(nextInvoiceSequence(null, 1000)).toBe(1000);
    expect(nextInvoiceSequence(1000, 1000)).toBe(1001);
    expect(formatInvoiceNumber("INV", 1001)).toBe("INV-1001");
    expect(formatInvoiceNumber("  ", 7)).toBe("INV-7");
  });

  it("jump to a raised start number, and never reuse one when it is lowered", () => {
    expect(nextInvoiceSequence(1004, 2000)).toBe(2000);
    expect(nextInvoiceSequence(2003, 1000)).toBe(2004);
  });
});

describe("invoice amounts and the VAT line", () => {
  it("at 0% there is no VAT and no VAT line", () => {
    const amounts = invoiceAmounts({ total: 45, orgVatRate: 0 });
    expect(amounts).toEqual({ subtotal: 45, discount: 0, tax: 0, vatRate: 0, pointsDiscount: 0 });
    expect(showsVatLine(amounts.tax, amounts.vatRate)).toBe(false);
  });

  it("uses the VAT the sale recorded when it has one", () => {
    expect(invoiceAmounts({ total: 60, vatAmount: 10, vatRate: 20, orgVatRate: 0 })).toEqual({
      subtotal: 50,
      discount: 0,
      tax: 10,
      vatRate: 20,
      pointsDiscount: 0,
    });
  });

  it("splits an older sale at the org's rate", () => {
    const amounts = invoiceAmounts({ total: 60, orgVatRate: 20 });
    expect(amounts).toEqual({ subtotal: 50, discount: 0, tax: 10, vatRate: 20, pointsDiscount: 0 });
    expect(showsVatLine(amounts.tax, amounts.vatRate)).toBe(true);
  });

  it("shows the discounts, so the lines, subtotal, VAT and total add up", () => {
    // 10% tier at 0% VAT: £100 of lines, £90 charged.
    expect(invoiceAmounts({ total: 90, subtotal: 100, tierDiscount: 10, vatAmount: 0, vatRate: 0, orgVatRate: 0 })).toEqual({
      subtotal: 100,
      discount: 10,
      tax: 0,
      vatRate: 0,
      pointsDiscount: 0,
    });
    // 20% VAT and £5 of points after VAT: VAT is 20% of the net, not of total − VAT.
    expect(
      invoiceAmounts({ total: 115, subtotal: 100, pointsDiscount: 5, vatAmount: 20, vatRate: 20, orgVatRate: 20 }),
    ).toEqual({ subtotal: 100, discount: 0, tax: 20, vatRate: 20, pointsDiscount: 5 });
  });

  it("falls back to total − VAT when a recorded breakdown does not reach the total", () => {
    expect(invoiceAmounts({ total: 50, subtotal: 70, vatAmount: 0, vatRate: 0, orgVatRate: 0 })).toEqual({
      subtotal: 50,
      discount: 0,
      tax: 0,
      vatRate: 0,
      pointsDiscount: 0,
    });
  });
});
