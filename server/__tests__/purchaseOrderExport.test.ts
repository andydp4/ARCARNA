/**
 * ARC-019: approving a purchase draft previously produced nothing a supplier
 * could actually be handed — only a bare CSV with no supplier identity, PO
 * reference, or dates on it. These tests render a real PDFKit document (no
 * network, no rasterising — same approach as pdfGenerator.test.ts) and assert
 * the supplier's identity, the PO reference, the line items and the dates
 * actually appear in the drawn text, not just that a PDF came out the other
 * end.
 */
import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { generatePurchaseOrderPdf, type PurchaseOrderData } from "../services/purchaseOrderExport";

function baseData(overrides: Partial<PurchaseOrderData> = {}): PurchaseOrderData {
  return {
    poNumber: "PO-A1B2C3D4",
    status: "approved",
    createdAt: "2026-09-01T00:00:00.000Z",
    estimatedDeliveryDate: "2026-09-08T00:00:00.000Z",
    buyer: { name: "Corner Shop Ltd", address: "1 High Street", email: "orders@cornershop.test" },
    supplier: {
      name: "Acme Wholesale",
      contactName: "Jane Buyer",
      email: "jane@acmewholesale.test",
      phone: "01234 567890",
    },
    deliverTo: { name: "HQ", address: "1 High Street, London, SW1A 1AA" },
    items: [
      { sku: "SKU-001", productName: "Cola 330ml", quantity: 24, unitCost: 0.4, supplierSku: "ACME-COLA" },
      { sku: "SKU-002", productName: "Crisps 40g", quantity: 48, unitCost: 0.25, supplierSku: null },
    ],
    ...overrides,
  };
}

/** Captures every string PDFKit actually drew, so assertions check the real
 *  rendered content rather than just the input object echoed back. */
async function renderAndCapture(data: PurchaseOrderData): Promise<{ pdf: Buffer; drawn: string[] }> {
  const drawn: string[] = [];
  const originalText = PDFDocument.prototype.text;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (PDFDocument.prototype as any).text = function patchedText(text: string, ...rest: unknown[]) {
    drawn.push(text);
    return originalText.apply(this, [text, ...rest] as never);
  };
  try {
    const pdf = await generatePurchaseOrderPdf(data);
    return { pdf, drawn };
  } finally {
    PDFDocument.prototype.text = originalText;
  }
}

describe("generatePurchaseOrderPdf", () => {
  it("produces a real, complete PDF", async () => {
    const { pdf } = await renderAndCapture(baseData());
    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("carries the right supplier identity", async () => {
    const { drawn } = await renderAndCapture(baseData());
    expect(drawn).toContain("Acme Wholesale");
    expect(drawn).toContain("Jane Buyer");
    expect(drawn).toContain("jane@acmewholesale.test");
    expect(drawn).toContain("01234 567890");
  });

  it("carries the right PO reference", async () => {
    const { drawn } = await renderAndCapture(baseData());
    expect(drawn).toContain("PO-A1B2C3D4");
  });

  it("carries every line item, with quantity and supplier SKU where given", async () => {
    const { drawn } = await renderAndCapture(baseData());
    expect(drawn).toContain("Cola 330ml");
    expect(drawn).toContain("24");
    expect(drawn).toContain("ACME-COLA");
    expect(drawn).toContain("Crisps 40g");
    expect(drawn).toContain("48");
    // No supplier SKU recorded for this line — falls back to the internal SKU
    // rather than rendering "null" or leaving the column blank.
    expect(drawn).toContain("SKU-002");
  });

  it("computes the estimated total only from lines that actually have a unit cost", async () => {
    const { drawn } = await renderAndCapture(
      baseData({
        items: [
          { sku: "A", productName: "Has cost", quantity: 10, unitCost: 2 },
          { sku: "B", productName: "No cost yet", quantity: 5, unitCost: null },
        ],
      }),
    );
    // 10 * 2 = £20.00, and the no-cost line must not silently count as £0.
    expect(drawn.some((t) => t.includes("20.00"))).toBe(true);
    expect(drawn).toContain("—");
  });

  it("shows the created date and a clearly-derived delivery estimate", async () => {
    const { drawn } = await renderAndCapture(baseData());
    expect(drawn).toContain("01/09/2026");
    expect(drawn).toContain("08/09/2026");
  });

  it("omits the delivery estimate line when the supplier has no lead time to derive one from", async () => {
    const { drawn } = await renderAndCapture(baseData({ estimatedDeliveryDate: null }));
    expect(drawn).not.toContain("08/09/2026");
  });

  it("does not throw when optional supplier contact fields are absent", async () => {
    const { pdf } = await renderAndCapture(
      baseData({ supplier: { name: "Bare Supplier Ltd" } }),
    );
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("pages a long items list without losing any line", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      sku: `SKU-${i}`,
      productName: `Product ${i + 1}`,
      quantity: 1,
      unitCost: 1,
    }));
    const { drawn, pdf } = await renderAndCapture(baseData({ items }));
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(drawn).toContain("Product 1");
    expect(drawn).toContain("Product 40");
  });
});
