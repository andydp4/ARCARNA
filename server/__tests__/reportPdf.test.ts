/**
 * Regression test for the fake-PDF export.
 *
 * `generatePDFReport` previously returned CSV bytes under a `.pdf` filename and
 * an `application/pdf` content type, so the downloaded file would not open.
 * These assertions fail if anyone reverts to emitting non-PDF bytes.
 */
import { describe, expect, it } from "vitest";
import { buildInsightsPdf, renderReportPdf } from "../services/reportPdf";

const sample = {
  revenue: {
    total: 1234.56,
    byDay: [
      { date: "2026-07-01", revenue: 500, orders: 12 },
      { date: "2026-07-02", revenue: 734.56, orders: 15 },
    ],
  },
  orders: { total: 27, average: 45.72, topProducts: [{ name: "Whey Protein", quantity: 40, revenue: 900 }] },
  customers: { topCustomers: [{ name: "Jane Doe", orders: 9, revenue: 410.5, loyalty: 120 }] },
  inventory: { topMoving: [{ product: "Creatine", sold: 30, remaining: 12 }] },
};

/** A real PDF starts with the %PDF- magic and ends with an EOF marker. */
function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString() === "%PDF-" && buf.toString("latin1").includes("%%EOF");
}

describe("insights PDF export produces a real PDF", () => {
  for (const type of ["revenue", "orders", "customers", "inventory", "full"]) {
    it(`emits valid PDF bytes for "${type}"`, async () => {
      const buf = await buildInsightsPdf(sample, type, "2026-07-01 to 2026-07-31");
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(isPdf(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(500);
    });
  }

  it("is NOT csv masquerading as a pdf (the original bug)", async () => {
    const buf = await buildInsightsPdf(sample, "revenue");
    const head = buf.subarray(0, 40).toString();
    expect(head).not.toMatch(/^Date,Revenue,Orders/);
    expect(head.startsWith("%PDF-")).toBe(true);
  });

  it("renders without rows (empty period) instead of throwing", async () => {
    const buf = await renderReportPdf({
      title: "Empty Report",
      tables: [{ heading: "Nothing", columns: ["A", "B"], rows: [] }],
    });
    expect(isPdf(buf)).toBe(true);
  });
});
