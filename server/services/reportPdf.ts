/**
 * Real PDF generation for the Insights exports.
 *
 * Replaces the previous `generatePDFReport`, which returned CSV bytes under a
 * `.pdf` filename and `application/pdf` content type — producing a file that
 * would not open. Uses pdfkit (already a dependency) and the ARC-RPT-SPEC-001
 * brand palette so these exports match the branded /reports pages.
 */
import PDFDocument from "pdfkit";

/** Spec palette (ARC-RPT-SPEC-001). Kept local so this file has no client deps. */
const BRAND = {
  truthBlue: "#1A56DB",
  truthBlueDark: "#1E3A8A",
  midnightBlack: "#0D1117",
  steelGrey: "#374151",
  smoke: "#6B7280",
  zebra: "#F9FAFB",
} as const;

const PAGE_MARGIN = 40;

export interface PdfTable {
  heading?: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportPdfInput {
  title: string;
  subtitle?: string;
  /** Headline figures rendered as a KPI strip. */
  kpis?: { label: string; value: string }[];
  tables: PdfTable[];
}

function money(n: unknown): string {
  const v = typeof n === "number" ? n : parseFloat(String(n ?? 0));
  return `£${(isFinite(v) ? v : 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Render a branded PDF and resolve the finished buffer. */
export function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width - PAGE_MARGIN * 2;

      // ── Banner (Midnight Black + Truth Blue rule) ──────────────────────────
      doc.rect(0, 0, doc.page.width, 78).fill(BRAND.midnightBlack);
      doc.rect(0, 0, 6, 78).fill(BRAND.truthBlueDark);
      doc.fillColor("#FFFFFF").fontSize(18).font("Helvetica-Bold");
      doc.text(input.title, PAGE_MARGIN, 24, { width: pageWidth - 120 });
      if (input.subtitle) {
        doc.fillColor(BRAND.smoke).fontSize(9).font("Helvetica");
        doc.text(input.subtitle, PAGE_MARGIN, 50, { width: pageWidth - 120 });
      }
      doc.fillColor("#FFFFFF").fontSize(11).font("Helvetica-Bold");
      doc.text("ARCARNA", doc.page.width - PAGE_MARGIN - 100, 26, { width: 100, align: "right" });
      doc.fillColor(BRAND.smoke).fontSize(7).font("Helvetica");
      doc.text("WM SUPPLIES", doc.page.width - PAGE_MARGIN - 100, 42, { width: 100, align: "right" });

      let y = 100;

      // ── KPI strip ──────────────────────────────────────────────────────────
      if (input.kpis?.length) {
        const per = pageWidth / Math.min(input.kpis.length, 4);
        input.kpis.slice(0, 4).forEach((k, i) => {
          const x = PAGE_MARGIN + i * per;
          doc.fillColor(BRAND.smoke).fontSize(7).font("Helvetica");
          doc.text(k.label.toUpperCase(), x, y, { width: per - 8 });
          doc.fillColor(BRAND.truthBlue).fontSize(14).font("Helvetica-Bold");
          doc.text(k.value, x, y + 11, { width: per - 8 });
        });
        y += 42;
      }

      // ── Tables ─────────────────────────────────────────────────────────────
      for (const table of input.tables) {
        if (y > doc.page.height - 120) {
          doc.addPage();
          y = PAGE_MARGIN;
        }
        if (table.heading) {
          doc.fillColor(BRAND.truthBlueDark).fontSize(11).font("Helvetica-Bold");
          doc.text(table.heading, PAGE_MARGIN, y);
          y += 18;
        }

        const colWidth = pageWidth / Math.max(table.columns.length, 1);

        // Header row — Truth Blue Dark.
        doc.rect(PAGE_MARGIN, y, pageWidth, 20).fill(BRAND.truthBlueDark);
        doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold");
        table.columns.forEach((c, i) => {
          doc.text(String(c), PAGE_MARGIN + 4 + i * colWidth, y + 6, {
            width: colWidth - 8,
            align: i === 0 ? "left" : "right",
            lineBreak: false,
          });
        });
        y += 20;

        // Body rows, zebra-striped.
        doc.font("Helvetica").fontSize(8);
        for (const [ri, row] of table.rows.entries()) {
          if (y > doc.page.height - 60) {
            doc.addPage();
            y = PAGE_MARGIN;
          }
          if (ri % 2) {
            doc.rect(PAGE_MARGIN, y, pageWidth, 16).fill(BRAND.zebra);
          }
          doc.fillColor(BRAND.steelGrey);
          row.forEach((cell, i) => {
            const text = cell === null || cell === undefined || cell === "" ? "—" : String(cell);
            doc.text(text, PAGE_MARGIN + 4 + i * colWidth, y + 4, {
              width: colWidth - 8,
              align: i === 0 ? "left" : "right",
              lineBreak: false,
            });
          });
          y += 16;
        }
        y += 16;
      }

      // ── Footer ─────────────────────────────────────────────────────────────
      // Draw in-place: writing near the bottom margin would otherwise let
      // pdfkit's auto-flow spill onto a trailing blank page.
      doc.fillColor(BRAND.smoke).fontSize(7).font("Helvetica");
      doc.text(
        `Generated ${new Date().toLocaleString("en-GB")} · Arcarna`,
        PAGE_MARGIN,
        doc.page.height - PAGE_MARGIN - 10,
        { width: pageWidth, align: "center", lineBreak: false },
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Map the Insights report payload + type into a branded PDF. */
export function buildInsightsPdf(data: any, type: string, period?: string): Promise<Buffer> {
  const titles: Record<string, string> = {
    revenue: "Revenue Report",
    orders: "Orders Report",
    customers: "Customers Report",
    inventory: "Inventory Report",
    full: "Full Business Report",
  };
  const tables: PdfTable[] = [];
  const kpis: { label: string; value: string }[] = [];

  if (type === "revenue" || type === "full") {
    kpis.push({ label: "Total Revenue", value: money(data?.revenue?.total) });
    tables.push({
      heading: "Daily Revenue",
      columns: ["Date", "Revenue", "Orders"],
      rows: (data?.revenue?.byDay ?? []).map((d: any) => [d.date, money(d.revenue), d.orders]),
    });
  }
  if (type === "orders" || type === "full") {
    if (data?.orders?.total != null) kpis.push({ label: "Total Orders", value: String(data.orders.total) });
    if (data?.orders?.average != null) kpis.push({ label: "Avg Order", value: money(data.orders.average) });
    tables.push({
      heading: "Top Products",
      columns: ["Product", "Quantity", "Revenue"],
      rows: (data?.orders?.topProducts ?? []).map((p: any) => [p.name, p.quantity, money(p.revenue)]),
    });
  }
  if (type === "customers" || type === "full") {
    tables.push({
      heading: "Top Customers",
      columns: ["Customer", "Orders", "Revenue", "Points"],
      rows: (data?.customers?.topCustomers ?? []).map((c: any) => [
        c.name,
        c.orders,
        money(c.revenue),
        c.loyalty ?? 0,
      ]),
    });
  }
  if (type === "inventory" || type === "full") {
    tables.push({
      heading: "Stock Movement",
      columns: ["Product", "Sold", "Remaining"],
      rows: (data?.inventory?.topMoving ?? []).map((i: any) => [i.product, i.sold, i.remaining]),
    });
  }

  return renderReportPdf({
    title: titles[type] ?? "Report",
    subtitle: period,
    kpis,
    tables,
  });
}
