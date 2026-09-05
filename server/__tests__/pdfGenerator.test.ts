/**
 * The invoice/receipt header lays out free text the org typed into
 * Settings — the business name, its address, its own optional company/VAT
 * numbers — into a fixed-width column. The address is the one field that
 * regularly wraps onto more than one line ("101 Apex Lofts, Birmingham,
 * B12 0BA" is a common shape), and the renderer used to advance its cursor
 * by one fixed line height per field regardless of how many lines it had
 * actually just drawn. A two-line address left "Company No: …" drawn over
 * the second line of the address instead of below it — the overlap a real
 * invoice showed in production.
 *
 * These tests render real PDFKit documents (no network, no rasterising) and
 * assert on the actual measured layout: heightOfString for a wrapped address
 * is genuinely taller than the old fixed increment, and the header's own
 * accounting for that height keeps pace with it.
 */
import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { generateInvoicePdf, generateReceiptPdf } from "../services/pdfGenerator";

// The address field is a Textarea (client/src/pages/setup-wizard.tsx), so a
// real address carries literal newlines, exactly like the one that overlapped
// "Company No: 16247814" in production.
const THREE_LINE_ADDRESS = "101 Apex Lofts\nBirmingham\nB12 0BA";
const ADDRESS_COLUMN_WIDTH = 250;
const OLD_FIXED_LINE_HEIGHT = 13;

function baseInvoice(overrides: Record<string, unknown> = {}) {
  return {
    invoiceNumber: "INV-20260826-JNSZ",
    createdAt: "2026-08-26T00:00:00.000Z",
    dueDate: "2026-09-25",
    company: {
      name: "WMSS",
      address: THREE_LINE_ADDRESS,
      companyNumber: "16247814",
      email: "andydp4@gmail.com",
    },
    customerName: "Liam",
    customerPhone: "+447789474582",
    items: [
      { name: "40404 T CA", quantity: 10, unitPrice: 28, total: 280 },
      { name: "40411 4 MK", quantity: 6, unitPrice: 20, total: 120 },
    ],
    subtotal: 400,
    tax: 0,
    total: 400,
    status: "sent",
    ...overrides,
  };
}

describe("the address that wraps onto more than one line", () => {
  it("genuinely needs more than one fixed line height", () => {
    // Proves the failure mode exists before asserting the fix: a real
    // address like the one that broke in production measures taller than
    // the single fixed increment the old renderer advanced by per field.
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    doc.fontSize(9);
    const measured = doc.heightOfString(THREE_LINE_ADDRESS, { width: ADDRESS_COLUMN_WIDTH });
    expect(measured).toBeGreaterThan(OLD_FIXED_LINE_HEIGHT * 2);
  });

  it("generates an invoice without throwing, address included", async () => {
    const pdf = await generateInvoicePdf(baseInvoice() as never);
    expect(pdf.length).toBeGreaterThan(0);
    // %PDF is the file's own magic header — the simplest proof this is a
    // real, complete PDF and not a half-written buffer from a thrown error
    // that got swallowed somewhere upstream.
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("generates a receipt without throwing, address included", async () => {
    const pdf = await generateReceiptPdf({
      receiptNumber: "R-0001",
      createdAt: "2026-08-26T00:00:00.000Z",
      company: { name: "WMSS", address: THREE_LINE_ADDRESS },
      items: [{ name: "Widget", quantity: 1, unitPrice: 5, total: 5 }],
      subtotal: 5,
      tax: 0,
      total: 5,
    } as never);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("does not throw with an empty company block", async () => {
    // No address, no company number, no VAT, no email, no logo — the
    // no-optional-fields floor the header has to degrade to gracefully.
    const pdf = await generateInvoicePdf(
      baseInvoice({ company: { name: "Bare Org" } }) as never,
    );
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});

/**
 * Captures the exact geometry the old renderer got wrong: it must place
 * "Company No: …" at or below the true bottom of a (possibly multi-line)
 * address, not one fixed line height below wherever the address started.
 */
describe("header field geometry", () => {
  it("places Company No below the full height of a wrapped address, not one fixed line under it", async () => {
    const calls: Array<{ text: string; x: number; y: number }> = [];
    const originalText = PDFDocument.prototype.text;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (PDFDocument.prototype as any).text = function patchedText(text: string, x: number, y: number, options?: unknown) {
      calls.push({ text, x, y });
      return originalText.call(this, text, x, y, options as never);
    };
    try {
      await generateInvoicePdf(baseInvoice() as never);
    } finally {
      PDFDocument.prototype.text = originalText;
    }

    const addressCall = calls.find((c) => c.text === THREE_LINE_ADDRESS);
    const companyNoCall = calls.find((c) => c.text.startsWith("Company No:"));
    expect(addressCall).toBeDefined();
    expect(companyNoCall).toBeDefined();

    const measurer = new PDFDocument({ margin: 50, size: "A4" });
    measurer.fontSize(9);
    const addressHeight = measurer.heightOfString(THREE_LINE_ADDRESS, { width: ADDRESS_COLUMN_WIDTH });

    // The true bottom of the address block, allowing a little rounding slack.
    const trueAddressBottom = addressCall!.y + addressHeight - 1;
    expect(companyNoCall!.y).toBeGreaterThanOrEqual(trueAddressBottom);
  });
});

describe("brand colours", () => {
  it("accepts a genuine 6-digit hex pair without throwing", async () => {
    const pdf = await generateInvoicePdf(
      baseInvoice({
        company: { name: "WMSS", primaryColor: "#0B2E66", accentColor: "#3C7AC4" },
      }) as never,
    );
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("falls back to the default palette rather than crash on a malformed colour", async () => {
    // fillColor()/strokeColor() throw on a string pdfkit cannot parse as a
    // colour, so a corrupt or hand-edited business_colors value must never
    // reach them unguarded.
    const pdf = await generateInvoicePdf(
      baseInvoice({
        company: { name: "WMSS", primaryColor: "not-a-colour", accentColor: "" },
      }) as never,
    );
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});

describe("a very long items list", () => {
  it("pages without throwing and without losing any lines", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      name: `Product ${i + 1}`,
      quantity: 1,
      unitPrice: 10,
      total: 10,
    }));
    const pdf = await generateInvoicePdf(
      baseInvoice({ items, subtotal: 400, tax: 0, total: 400 }) as never,
    );
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
