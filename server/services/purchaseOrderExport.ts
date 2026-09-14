/**
 * PDF Purchase Order Generator
 *
 * ARC-019: approving a purchase draft previously produced nothing a supplier
 * could actually be shown — only a bare CSV of SKU/qty/cost with no supplier
 * identity, and UI copy that said outright drafts are "not sent to
 * suppliers." This renders the same draft as a real purchase-order document —
 * supplier name and contact details, a PO reference, the line items, and the
 * relevant dates — that can be printed or emailed to the supplier by hand.
 *
 * Deliberately out of scope (see ARC-019's fix note): this does not send
 * anything anywhere. It only produces the document; a human still decides
 * when and how to get it to the supplier.
 *
 * Follows the same PDFKit structure as `pdfGenerator.ts` (A4, a
 * measured-height header, a paginating items table) rather than inventing a
 * second layout style for documents leaving this system.
 */
import PDFDocument from 'pdfkit';
import type { CompanyInfo } from './companyBranding';

export interface PurchaseOrderLineItem {
  sku: string;
  productName: string;
  quantity: number;
  /** Unit cost, when the draft line recorded one. Not every line has an
   *  estimated cost — replenishment can raise a line with quantity only. */
  unitCost: number | null;
  supplierSku?: string | null;
}

export interface PurchaseOrderSupplier {
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface PurchaseOrderDeliverTo {
  name: string;
  address?: string | null;
}

export interface PurchaseOrderData {
  /** Human-facing reference, e.g. "PO-A1B2C3D4" — the draft's own short id,
   *  formatted the same way orders/receipts already format theirs. */
  poNumber: string;
  status: string;
  /** ISO 8601 timestamp the draft was created. */
  createdAt: string;
  /** ISO 8601 date, when a delivery estimate could be derived from the
   *  supplier's lead time. Clearly labelled as an estimate in the PDF — it is
   *  never a promise the supplier made. */
  estimatedDeliveryDate?: string | null;
  /** The org raising the order — same shape invoices/receipts use, so it
   *  reads as the same business. */
  buyer: CompanyInfo;
  supplier: PurchaseOrderSupplier;
  deliverTo: PurchaseOrderDeliverTo;
  items: PurchaseOrderLineItem[];
}

const LAYOUT = {
  MARGIN: 50,
  CONTENT_WIDTH: 495,
  TABLE: {
    COL_PRODUCT: 50,
    COL_SKU: 250,
    COL_QTY: 340,
    COL_UNIT_COST: 400,
    COL_LINE_TOTAL: 465,
    ROW_HEIGHT: 20,
    HEADER_HEIGHT: 22,
  },
  TABLE_TOP_Y: 260,
  PAGE_BREAK_Y: 700,
};

const DEFAULT_PRIMARY_COLOR = '#1E293B';
const DEFAULT_ACCENT_COLOR = '#1A56DB';
const INK = '#1F2933';
const MUTED = '#5B6472';
const RULE = '#E2E8F0';
const ROW_TINT = '#F8FAFC';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function safeColor(hex: string | undefined, fallback: string): string {
  return hex && HEX_COLOR_RE.test(hex) ? hex : fallback;
}

function formatCurrency(amount: number, currency = 'GBP'): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
  } catch {
    return `£${amount.toFixed(2)}`;
  }
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB');
}

/** Draws one (possibly wrapping) line and returns the Y position immediately
 *  below its actual rendered height — see pdfGenerator.ts's `drawLine` for
 *  why this matters: a free-text field (a supplier's address, contact name)
 *  can wrap onto more than one line and a fixed-height advance overlaps it. */
function drawLine(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: { width: number; gap?: number },
): number {
  doc.text(text, x, y, { width: options.width });
  return y + doc.heightOfString(text, { width: options.width }) + (options.gap ?? 3);
}

function renderHeader(doc: PDFKit.PDFDocument, data: PurchaseOrderData): number {
  const primary = safeColor(data.buyer.primaryColor, DEFAULT_PRIMARY_COLOR);
  const accent = safeColor(data.buyer.accentColor, DEFAULT_ACCENT_COLOR);
  const textX = 140;
  const textWidth = 250;

  let logoBottom = 45;
  if (data.buyer.logo) {
    try {
      doc.image(data.buyer.logo, 50, 40, { width: 80 });
      logoBottom = 40 + 80;
    } catch {
      // Malformed/unsupported image — skip rather than fail the whole PO.
    }
  }

  doc.font('Helvetica-Bold').fontSize(20).fillColor(primary);
  doc.text('PURCHASE ORDER', 50, 48, { width: LAYOUT.CONTENT_WIDTH, align: 'right' });

  let y = 45;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(primary);
  y = drawLine(doc, data.buyer.name, textX, y, { width: textWidth, gap: 5 });

  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  if (data.buyer.address) y = drawLine(doc, data.buyer.address, textX, y, { width: textWidth });
  if (data.buyer.email) y = drawLine(doc, data.buyer.email, textX, y, { width: textWidth });

  const headerBottom = Math.max(y, logoBottom, 48 + 24);
  const ruleY = headerBottom + 6;
  doc.moveTo(50, ruleY).lineTo(50 + LAYOUT.CONTENT_WIDTH, ruleY).lineWidth(1.5).strokeColor(accent).stroke();
  return ruleY + 16;
}

/**
 * PO metadata (left column) and the supplier block (right column) — the two
 * things ARC-019 called out as missing entirely: a reference the supplier
 * and buyer can both quote, and the supplier's own contact details rather
 * than just its name.
 */
function renderMetaAndSupplier(doc: PDFKit.PDFDocument, data: PurchaseOrderData, startY: number): number {
  const y = Math.max(startY, 140);
  const labelX = 50;
  const valueX = 150;
  const rowHeight = 16;

  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text('PO Number:', labelX, y);
  doc.text('Date raised:', labelX, y + rowHeight);
  doc.text('Status:', labelX, y + rowHeight * 2);
  let leftBottom = y + rowHeight * 2;
  doc.fillColor(INK);
  doc.text(data.poNumber, valueX, y);
  doc.text(formatDate(data.createdAt), valueX, y + rowHeight);
  doc.text(data.status.replace(/_/g, ' ').toUpperCase(), valueX, y + rowHeight * 2);

  if (data.estimatedDeliveryDate) {
    doc.fillColor(MUTED).text('Est. delivery:', labelX, y + rowHeight * 3);
    doc.fillColor(INK).text(formatDate(data.estimatedDeliveryDate), valueX, y + rowHeight * 3);
    leftBottom = y + rowHeight * 3;
  }
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  leftBottom = drawLine(
    doc,
    `Deliver to: ${data.deliverTo.name}${data.deliverTo.address ? ` — ${data.deliverTo.address}` : ''}`,
    labelX,
    leftBottom + rowHeight,
    { width: 280, gap: 2 },
  );

  const billX = 350;
  const billWidth = 195;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
  doc.text('Supplier', billX, y);
  let billY = y + 16;
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  billY = drawLine(doc, data.supplier.name, billX, billY, { width: billWidth, gap: 2 });
  if (data.supplier.contactName) {
    billY = drawLine(doc, data.supplier.contactName, billX, billY, { width: billWidth, gap: 2 });
  }
  if (data.supplier.email) {
    billY = drawLine(doc, data.supplier.email, billX, billY, { width: billWidth, gap: 2 });
  }
  if (data.supplier.phone) {
    billY = drawLine(doc, data.supplier.phone, billX, billY, { width: billWidth, gap: 2 });
  }

  return Math.max(leftBottom, billY);
}

function renderItemsTable(
  doc: PDFKit.PDFDocument,
  items: PurchaseOrderLineItem[],
  currency: string,
  startY: number,
  primaryColor: string,
): { bottom: number; total: number } {
  const { COL_PRODUCT, COL_SKU, COL_QTY, COL_UNIT_COST, COL_LINE_TOTAL, ROW_HEIGHT, HEADER_HEIGHT } = LAYOUT.TABLE;

  const drawTableHeader = (headerY: number): number => {
    doc.fillColor(primaryColor).rect(COL_PRODUCT, headerY, LAYOUT.CONTENT_WIDTH, HEADER_HEIGHT).fill();
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
    doc.text('Product', COL_PRODUCT + 8, headerY + 6);
    doc.text('SKU', COL_SKU, headerY + 6);
    doc.text('Qty', COL_QTY, headerY + 6);
    doc.text('Unit cost', COL_UNIT_COST, headerY + 6);
    doc.text('Line total', COL_LINE_TOTAL, headerY + 6);
    return headerY + HEADER_HEIGHT;
  };

  let y = Math.max(startY, LAYOUT.TABLE_TOP_Y);
  y = drawTableHeader(y);

  let total = 0;
  doc.font('Helvetica');
  items.forEach((item, index) => {
    if (y > LAYOUT.PAGE_BREAK_Y) {
      doc.addPage();
      y = drawTableHeader(50);
    }
    if (index % 2 === 1) {
      doc.fillColor(ROW_TINT).rect(COL_PRODUCT, y - 3, LAYOUT.CONTENT_WIDTH, ROW_HEIGHT).fill();
    }

    const lineTotal = item.unitCost != null ? item.unitCost * item.quantity : null;
    if (lineTotal != null) total += lineTotal;

    doc.fillColor(INK).fontSize(9);
    doc.text(item.productName, COL_PRODUCT + 8, y, { width: 190 });
    doc.text(item.supplierSku || item.sku, COL_SKU, y, { width: 85 });
    doc.text(String(item.quantity), COL_QTY, y);
    doc.text(item.unitCost != null ? formatCurrency(item.unitCost, currency) : '—', COL_UNIT_COST, y);
    doc.text(lineTotal != null ? formatCurrency(lineTotal, currency) : '—', COL_LINE_TOTAL, y);
    y += ROW_HEIGHT;
  });

  doc.moveTo(COL_PRODUCT, y).lineTo(COL_PRODUCT + LAYOUT.CONTENT_WIDTH, y).strokeColor(RULE).lineWidth(1).stroke();

  return { bottom: y, total };
}

function renderTotalAndFooter(
  doc: PDFKit.PDFDocument,
  data: PurchaseOrderData,
  startY: number,
  total: number,
  primaryColor: string,
): void {
  const labelX = 350;
  const valueWidth = 95;
  const valueX = 545 - valueWidth;
  let y = startY + 15;
  const currency = data.buyer.currency || 'GBP';

  doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor);
  doc.text('Estimated total:', labelX, y);
  doc.text(formatCurrency(total, currency), valueX, y, { align: 'right', width: valueWidth });
  y += 30;

  doc.font('Helvetica').fontSize(8).fillColor('#94A3B8');
  doc.text(
    'This is an internal purchase order generated for reference — it is not an order confirmation from the supplier, and no payment has been made. Confirm pricing, availability and delivery directly with the supplier.',
    LAYOUT.MARGIN,
    y,
    { width: LAYOUT.CONTENT_WIDTH },
  );
}

/**
 * Renders a printable/shareable purchase-order PDF for an approved purchase
 * draft. Intended to be handed or emailed to the supplier by a human — this
 * function does no sending of its own.
 */
export async function generatePurchaseOrderPdf(data: PurchaseOrderData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: LAYOUT.MARGIN, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const primary = safeColor(data.buyer.primaryColor, DEFAULT_PRIMARY_COLOR);
      const currency = data.buyer.currency || 'GBP';

      const headerBottom = renderHeader(doc, data);
      const metaBottom = renderMetaAndSupplier(doc, data, headerBottom);
      const { bottom: tableBottom, total } = renderItemsTable(
        doc,
        data.items,
        currency,
        metaBottom + 20,
        primary,
      );
      renderTotalAndFooter(doc, data, tableBottom, total, primary);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
