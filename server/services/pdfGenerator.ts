/**
 * PDF Invoice Generator
 *
 * Generates professional PDF invoices using PDFKit, branded per-organisation
 * from the details each business configures in Settings/the setup wizard
 * (name, address, logo, brand colours, tax rate, bank/payment details) —
 * every org's invoices look like their own business, not a shared template.
 *
 * Features:
 * - A4 format with professional layout
 * - Company logo (if the org has one and enabled it for invoices)
 * - The org's own brand colours (Settings → Branding), with a neutral default
 * - Customer billing details
 * - Real line item names
 * - Bank transfer and online payment information (shown only if configured)
 * - VAT at the org's actual configured rate
 *
 * @module server/services/pdfGenerator
 */

import PDFDocument from 'pdfkit';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Issuing organisation's details, as configured in Settings/setup wizard.
 * Sections with no data (e.g. no bank details) are simply omitted from the PDF.
 */
interface InvoiceCompanyInfo {
  name: string;
  address?: string;
  companyNumber?: string;
  vatNumber?: string;
  email?: string;
  /** Logo image bytes, already fetched — pdfGenerator does no network I/O. */
  logo?: Buffer;
  /** The org's own brand colours (organizations.business_colors). Falls back
   *  to a neutral slate/blue pair — the same default the setup wizard seeds
   *  for a new org — when unset or not a valid 6-digit hex. */
  primaryColor?: string;
  accentColor?: string;
  bankName?: string;
  bankSortCode?: string;
  bankAccountNumber?: string;
  paymentLink?: string;
  /** ISO 4217 currency code, e.g. "GBP". Defaults to GBP. */
  currency?: string;
}

/**
 * Invoice data required for PDF generation.
 */
interface InvoiceData {
  /** Unique invoice identifier (e.g., "INV-20231220-ABCD") */
  invoiceNumber: string;
  /** Invoice creation timestamp (ISO 8601) */
  createdAt: string;
  /** Payment due date (YYYY-MM-DD) */
  dueDate: string;
  /** Issuing organisation's details */
  company: InvoiceCompanyInfo;
  /** Customer name for billing section */
  customerName?: string;
  /** Customer email for billing section */
  customerEmail?: string;
  /** Customer phone for billing section */
  customerPhone?: string;
  /** Customer address (multi-line supported) */
  customerAddress?: string;
  /** Line items to display in invoice table */
  items: InvoiceLineItem[];
  /** Subtotal before tax */
  subtotal: number;
  /** Tax amount */
  tax: number;
  /** Grand total */
  total: number;
  /** Invoice status (e.g., "sent", "paid") */
  status: string;
  /** Payment method used (for reference) */
  paymentMethod?: string;
}

/**
 * Individual line item in the invoice.
 */
interface InvoiceLineItem {
  /** Product/service name */
  name: string;
  /** Quantity of items */
  quantity: number;
  /** Price per unit */
  unitPrice: number;
  /** Line total (quantity × unitPrice) */
  total: number;
}

// ============================================================================
// Layout Constants
// ============================================================================

/**
 * PDF layout dimensions and positions.
 * All values in points (72 points = 1 inch).
 */
const LAYOUT: {
  MARGIN: number;
  CONTENT_WIDTH: number;
  TABLE: {
    COL_DESCRIPTION: number;
    COL_QUANTITY: number;
    COL_UNIT_PRICE: number;
    COL_AMOUNT: number;
    ROW_HEIGHT: number;
    HEADER_HEIGHT: number;
  };
  HEADER_Y: number;
  DETAILS_Y: number;
  TABLE_TOP_Y: number;
  PAGE_BREAK_Y: number;
} = {
  /** Page margins */
  MARGIN: 50,
  /** Right edge of the printable area minus the left margin (A4, 50pt margins) */
  CONTENT_WIDTH: 495,
  /** Table column positions */
  TABLE: {
    /** Description column start */
    COL_DESCRIPTION: 50,
    /** Quantity column start */
    COL_QUANTITY: 300,
    /** Unit price column start */
    COL_UNIT_PRICE: 380,
    /** Amount column start */
    COL_AMOUNT: 460,
    /** Table row height */
    ROW_HEIGHT: 20,
    /** Table header height */
    HEADER_HEIGHT: 22,
  },
  /** Company info header position — a floor. The header may run past this if
   *  the address wraps onto more than one line; it never starts earlier. */
  HEADER_Y: 45,
  /** Invoice details start position — a floor; see HEADER_Y. */
  DETAILS_Y: 140,
  /** Table start position — a floor; see HEADER_Y. */
  TABLE_TOP_Y: 230,
  /** Maximum Y before page break */
  PAGE_BREAK_Y: 680,
};

/** Neutral default brand pair — identical to what the setup wizard seeds for
 *  a new org, so an org that never touched Settings → Branding still gets a
 *  deliberate colour rather than an unstyled black-and-white document. */
const DEFAULT_PRIMARY_COLOR = '#1E293B';
const DEFAULT_ACCENT_COLOR = '#1A56DB';
const INK = '#1F2933';
const MUTED = '#5B6472';
const RULE = '#E2E8F0';
const ROW_TINT = '#F8FAFC';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** A configured colour if it is a genuine 6-digit hex, the neutral default otherwise. */
function safeColor(hex: string | undefined, fallback: string): string {
  return hex && HEX_COLOR_RE.test(hex) ? hex : fallback;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Formats a number as currency for the org's configured currency.
 *
 * @param amount - Numeric amount
 * @param currency - ISO 4217 currency code, defaults to GBP
 * @returns Formatted currency string (e.g., "£125.00")
 */
function formatCurrency(amount: number, currency = 'GBP'): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
  } catch {
    return `£${amount.toFixed(2)}`;
  }
}

/**
 * Formats an ISO date string to UK locale format.
 *
 * @param isoDate - Date in ISO 8601 format
 * @returns Formatted date (e.g., "20/12/2023")
 */
function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB');
}

/**
 * Draws one line of a text block and returns the Y position immediately
 * below it, measuring the ACTUAL rendered height rather than assuming a
 * single line.
 *
 * This is the fix for the header overlapping the fields after it: the
 * company address is free text the org typed into Settings, so it can wrap
 * onto two or three lines there and nothing stops it wrapping in the PDF too.
 * The previous version advanced the cursor by one fixed line height per
 * field regardless of how many lines it actually rendered, so a two-line
 * address left the next field's text drawn over the second line of the
 * address instead of below it.
 */
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

// ============================================================================
// PDF Section Renderers
// ============================================================================

/**
 * Renders the company header with logo, brand colour, and contact information.
 *
 * Returns the Y position immediately below the header — including the
 * accent rule — so later sections can start below whatever the header
 * actually rendered, rather than at a fixed offset that assumes a short,
 * single-line address.
 */
function renderHeader(doc: PDFKit.PDFDocument, company: InvoiceCompanyInfo, title: string): number {
  const primary = safeColor(company.primaryColor, DEFAULT_PRIMARY_COLOR);
  const accent = safeColor(company.accentColor, DEFAULT_ACCENT_COLOR);
  const textX = 140;
  const textWidth = 250;

  // Company logo (left side), if the org has one and enabled it for invoices.
  // Approximated as an 80×80 box for the purpose of clearing the header: most
  // uploaded marks are roughly square, and a slight underestimate for a very
  // tall, narrow logo is a smaller risk than the network call an exact
  // measurement would otherwise avoid needing.
  let logoBottom = LAYOUT.HEADER_Y;
  if (company.logo) {
    try {
      doc.image(company.logo, 50, 40, { width: 80 });
      logoBottom = 40 + 80;
    } catch {
      // Malformed/unsupported image — skip rather than fail the whole invoice.
    }
  }

  // Title (right side), in the org's own accent colour.
  doc.font('Helvetica-Bold').fontSize(22).fillColor(primary);
  doc.text(title, 50, 48, { width: LAYOUT.CONTENT_WIDTH, align: 'right' });

  // Company details (next to logo). The name reads as a masthead — bold and a
  // size up from the contact lines beneath it — so the document has a clear
  // identity even for an org with no logo configured.
  let y = LAYOUT.HEADER_Y;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(primary);
  y = drawLine(doc, company.name, textX, y, { width: textWidth, gap: 5 });

  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  if (company.address) {
    y = drawLine(doc, company.address, textX, y, { width: textWidth });
  }
  if (company.companyNumber) {
    y = drawLine(doc, `Company No: ${company.companyNumber}`, textX, y, { width: textWidth });
  }
  if (company.vatNumber) {
    y = drawLine(doc, `VAT No: ${company.vatNumber}`, textX, y, { width: textWidth });
  }
  if (company.email) {
    y = drawLine(doc, company.email, textX, y, { width: textWidth });
  }

  const headerBottom = Math.max(y, logoBottom, 48 + 26);
  const ruleY = headerBottom + 6;
  doc.moveTo(50, ruleY).lineTo(50 + LAYOUT.CONTENT_WIDTH, ruleY).lineWidth(1.5).strokeColor(accent).stroke();
  return ruleY + 16;
}

/**
 * Renders invoice metadata and customer billing information.
 *
 * @param doc - PDFKit document instance
 * @param data - Invoice data
 * @param startY - Y position to start rendering at — the header's actual
 *   bottom edge, never earlier than LAYOUT.DETAILS_Y
 * @returns Y position immediately below whichever column ran longer
 */
function renderInvoiceDetails(doc: PDFKit.PDFDocument, data: InvoiceData, startY: number): number {
  const y = Math.max(startY, LAYOUT.DETAILS_Y);
  const labelX = 50;
  const valueX = 150;
  const rowHeight = 16;

  // Left column: Invoice details
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text('Invoice Number:', labelX, y);
  doc.text('Date:', labelX, y + rowHeight);
  doc.text('Due Date:', labelX, y + rowHeight * 2);
  doc.text('Status:', labelX, y + rowHeight * 3);

  doc.fillColor(INK);
  doc.text(data.invoiceNumber, valueX, y);
  doc.text(formatDate(data.createdAt), valueX, y + rowHeight);
  doc.text(data.dueDate, valueX, y + rowHeight * 2);
  doc.text(data.status.toUpperCase(), valueX, y + rowHeight * 3);
  let leftBottom = y + rowHeight * 3 + 14;

  // Right column: Customer billing address
  let rightBottom = y;
  if (data.customerName || data.customerEmail) {
    const billX = 350;
    const billWidth = 195;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
    doc.text('Bill To', billX, y);
    let billY = y + 16;

    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    if (data.customerName) {
      billY = drawLine(doc, data.customerName, billX, billY, { width: billWidth, gap: 2 });
    }
    if (data.customerEmail) {
      billY = drawLine(doc, data.customerEmail, billX, billY, { width: billWidth, gap: 2 });
    }
    if (data.customerPhone) {
      billY = drawLine(doc, data.customerPhone, billX, billY, { width: billWidth, gap: 2 });
    }
    if (data.customerAddress) {
      billY = drawLine(doc, data.customerAddress, billX, billY, { width: billWidth, gap: 2 });
    }
    rightBottom = billY;
  }

  return Math.max(leftBottom, rightBottom);
}

/**
 * Renders the line items table with header and rows.
 * Handles page breaks for long item lists.
 *
 * @param doc - PDFKit document instance
 * @param items - Array of invoice line items
 * @param currency - ISO currency code
 * @param startY - Y position to start rendering at — the details block's
 *   actual bottom edge, never earlier than LAYOUT.TABLE_TOP_Y
 * @returns Y position after table for following sections
 */
function renderItemsTable(
  doc: PDFKit.PDFDocument,
  items: InvoiceLineItem[],
  currency: string,
  startY: number,
  primaryColor: string,
): number {
  const { COL_DESCRIPTION, COL_QUANTITY, COL_UNIT_PRICE, COL_AMOUNT, ROW_HEIGHT, HEADER_HEIGHT } = LAYOUT.TABLE;

  const drawTableHeader = (headerY: number): number => {
    doc.fillColor(primaryColor).rect(COL_DESCRIPTION, headerY, LAYOUT.CONTENT_WIDTH, HEADER_HEIGHT).fill();
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
    doc.text('Description', COL_DESCRIPTION + 8, headerY + 6);
    doc.text('Qty', COL_QUANTITY, headerY + 6);
    doc.text('Unit Price', COL_UNIT_PRICE, headerY + 6);
    doc.text('Amount', COL_AMOUNT, headerY + 6);
    return headerY + HEADER_HEIGHT;
  };

  let y = Math.max(startY, LAYOUT.TABLE_TOP_Y);
  y = drawTableHeader(y);

  doc.font('Helvetica');
  items.forEach((item, index) => {
    // Page break if needed. The header re-draws on the new page so a long
    // order doesn't leave the reader guessing which column is which.
    if (y > LAYOUT.PAGE_BREAK_Y) {
      doc.addPage();
      y = drawTableHeader(50);
    }

    // Alternating row tint — the one change here that costs nothing and does
    // the most to stop a long items list reading as a wall of grey text.
    if (index % 2 === 1) {
      doc.fillColor(ROW_TINT).rect(COL_DESCRIPTION, y - 3, LAYOUT.CONTENT_WIDTH, ROW_HEIGHT).fill();
    }

    doc.fillColor(INK).fontSize(9);
    doc.text(item.name, COL_DESCRIPTION + 8, y, { width: 235 });
    doc.text(String(item.quantity), COL_QUANTITY, y);
    doc.text(formatCurrency(item.unitPrice, currency), COL_UNIT_PRICE, y);
    doc.text(formatCurrency(item.total, currency), COL_AMOUNT, y);
    y += ROW_HEIGHT;
  });

  doc.moveTo(COL_DESCRIPTION, y).lineTo(COL_DESCRIPTION + LAYOUT.CONTENT_WIDTH, y).strokeColor(RULE).lineWidth(1).stroke();

  return y;
}

/**
 * Renders the invoice totals section, with VAT at the org's actual rate.
 * The grand total sits in a tinted box in the org's own primary colour, so
 * it reads as the one figure that matters rather than one more line among
 * several of equal weight.
 *
 * @param doc - PDFKit document instance
 * @param data - Invoice data with totals
 * @param startY - Y position to start rendering
 * @returns Y position after totals
 */
function renderTotals(doc: PDFKit.PDFDocument, data: InvoiceData, startY: number, primaryColor: string): number {
  const labelX = 350;
  const valueWidth = 65;
  const valueX = 545 - valueWidth;
  let y = startY + 15;
  const currency = data.company.currency || 'GBP';

  // Subtotal
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text('Subtotal:', labelX, y);
  doc.fillColor(INK).text(formatCurrency(data.subtotal, currency), valueX, y, { align: 'right', width: valueWidth });
  y += 18;

  // VAT at the org's actual rate
  const vatRate = data.subtotal > 0 ? Math.round((data.tax / data.subtotal) * 1000) / 10 : 0;
  doc.fillColor(MUTED).text(`VAT (${vatRate}%):`, labelX, y);
  doc.fillColor(INK).text(formatCurrency(data.tax, currency), valueX, y, { align: 'right', width: valueWidth });
  y += 22;

  // Grand total — a tinted band the width of the totals column, in the org's
  // own brand colour, with the figure in white so it cannot be mistaken for
  // another line item.
  const boxHeight = 28;
  doc.fillColor(primaryColor).rect(labelX, y, 545 - labelX, boxHeight).fill();
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(12);
  doc.text('Total:', labelX + 10, y + 8);
  doc.text(formatCurrency(data.total, currency), valueX - 5, y + 8, { align: 'right', width: valueWidth + 5 });

  return y + boxHeight;
}

/**
 * Renders the payment information section with bank details and/or an online
 * payment link — only if the org has configured at least one of them.
 *
 * @param doc - PDFKit document instance
 * @param company - Issuing org's details
 * @param startY - Y position to start rendering
 */
function renderPaymentInfo(doc: PDFKit.PDFDocument, company: InvoiceCompanyInfo, startY: number, primaryColor: string): void {
  const hasBankDetails = company.bankName || company.bankSortCode || company.bankAccountNumber;
  if (!hasBankDetails && !company.paymentLink) return;

  let y = startY + 30;

  // Section header
  doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor);
  doc.text('Payment Information', 50, y);
  y += 6;
  doc.moveTo(50, y + 12).lineTo(200, y + 12).strokeColor(RULE).lineWidth(1).stroke();
  y += 20;

  doc.font('Helvetica').fontSize(9).fillColor(MUTED);

  if (company.bankName) {
    doc.text('Bank Details:', 50, y);
    doc.fillColor(INK).text(company.bankName, 150, y);
    doc.fillColor(MUTED);
    y += 14;
  }
  if (company.bankSortCode) {
    doc.text('Sort Code:', 50, y);
    doc.fillColor(INK).text(company.bankSortCode, 150, y);
    doc.fillColor(MUTED);
    y += 14;
  }
  if (company.bankAccountNumber) {
    doc.text('Account No:', 50, y);
    doc.fillColor(INK).text(company.bankAccountNumber, 150, y);
    doc.fillColor(MUTED);
    y += 14;
  }
  if (company.paymentLink) {
    doc.fillColor(MUTED).text('Pay Online:', 50, y);
    doc.fillColor('#0066CC').text(company.paymentLink, 150, y, {
      link: company.paymentLink,
      underline: true,
    });
  }
}

/**
 * Renders the footer with thank you message and company contact.
 *
 * @param doc - PDFKit document instance
 * @param company - Issuing org's details
 */
function renderFooter(doc: PDFKit.PDFDocument, company: InvoiceCompanyInfo): void {
  const footerY = doc.page.height - 55;
  const pageWidth = doc.page.width - 100;

  doc.moveTo(50, footerY - 10).lineTo(50 + pageWidth, footerY - 10).strokeColor(RULE).lineWidth(1).stroke();

  doc.font('Helvetica').fontSize(8).fillColor('#94A3B8');
  doc.text('Thank you for your business!', 50, footerY, {
    align: 'center',
    width: pageWidth,
  });
  doc.text(
    [company.name, company.email].filter(Boolean).join(' | '),
    50,
    footerY + 12,
    { align: 'center', width: pageWidth }
  );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Customer receipt for a completed order.
 *
 * Distinct from an invoice: a receipt evidences payment already taken, so it
 * carries no due date, no bank/payment instructions, and no VAT breakdown
 * beyond the tax actually charged. Branding (logo, trading name, contact
 * block, brand colours) is the same as the invoice so both documents read as
 * the same business.
 */
export interface ReceiptData {
  /** Human-facing reference, e.g. the order number or short id. */
  receiptNumber: string;
  /** ISO 8601 timestamp of the sale. */
  createdAt: string;
  company: InvoiceCompanyInfo;
  items: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod?: string;
  customerName?: string;
  /** Free-text footer configured per org (organizations.receipt_footer). */
  footerNote?: string;
}

/**
 * Branded header for a receipt — same company block as an invoice, different
 * title. Shares `renderHeader`'s dynamic-height layout, for the same reason:
 * the address is free text typed into Settings and can wrap onto more than
 * one line.
 */
function renderReceiptHeader(doc: PDFKit.PDFDocument, company: InvoiceCompanyInfo): number {
  return renderHeader(doc, company, 'RECEIPT');
}

export async function generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: LAYOUT.MARGIN, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const currency = data.company.currency || 'GBP';
      const primary = safeColor(data.company.primaryColor, DEFAULT_PRIMARY_COLOR);

      const headerBottom = renderReceiptHeader(doc, data.company);

      // Sale details block
      let y = Math.max(headerBottom, LAYOUT.DETAILS_Y);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK);
      doc.text(`Receipt: ${data.receiptNumber}`, LAYOUT.MARGIN, y);
      y += 18;
      doc.font('Helvetica').fillColor(MUTED).fontSize(9);
      doc.text(`Date: ${formatDate(data.createdAt)}`, LAYOUT.MARGIN, y);
      y += 13;
      if (data.paymentMethod) {
        doc.text(`Paid by: ${data.paymentMethod}`, LAYOUT.MARGIN, y);
        y += 13;
      }
      if (data.customerName) {
        doc.text(`Customer: ${data.customerName}`, LAYOUT.MARGIN, y);
        y += 13;
      }

      const tableEndY = renderItemsTable(doc, data.items, currency, y + 12, primary);

      // Totals — no payment instructions, the money is already taken.
      let totalsY = tableEndY + 15;
      const labelX = 350;
      const valueX = 450;
      doc.font('Helvetica').fontSize(10).fillColor(MUTED);
      doc.text('Subtotal', labelX, totalsY);
      doc.fillColor(INK).text(formatCurrency(data.subtotal, currency), valueX, totalsY, { align: 'right', width: 95 });
      totalsY += 15;
      if (data.tax > 0) {
        doc.fillColor(MUTED).text('Tax', labelX, totalsY);
        doc.fillColor(INK).text(formatCurrency(data.tax, currency), valueX, totalsY, { align: 'right', width: 95 });
        totalsY += 15;
      }
      doc.font('Helvetica-Bold').fontSize(12).fillColor(primary);
      doc.text('Total paid', labelX, totalsY);
      doc.text(formatCurrency(data.total, currency), valueX, totalsY, { align: 'right', width: 95 });
      totalsY += 24;

      if (data.footerNote) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(data.footerNote, LAYOUT.MARGIN, totalsY, {
          width: 495,
          align: 'center',
        });
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generates a complete PDF invoice document, branded for the issuing org.
 *
 * The PDF includes:
 * - Company header with logo (if configured) and the org's own brand colours
 * - Invoice metadata (number, dates, status)
 * - Customer billing address
 * - Line items table with real product/service names
 * - Totals with VAT at the org's actual rate
 * - Payment information (bank transfer and/or online), if configured
 * - Footer with thank you message
 *
 * Every section's Y position flows from the one before it, measured from the
 * actual rendered height rather than assumed — see `drawLine` — so a long
 * address, a long customer name, or a long items list never overlaps the
 * section after it.
 *
 * @param data - Invoice data for PDF generation
 * @returns Promise resolving to PDF buffer
 * @throws Error if PDF generation fails
 *
 * @example
 * const pdfBuffer = await generateInvoicePdf({
 *   invoiceNumber: 'INV-20231220-ABCD',
 *   createdAt: new Date().toISOString(),
 *   dueDate: '2024-01-19',
 *   company: { name: 'Acme Coffee Ltd' },
 *   customerName: 'John Smith',
 *   items: [{ name: 'Cappuccino', quantity: 1, unitPrice: 3.5, total: 3.5 }],
 *   subtotal: 3.5,
 *   tax: 0.7,
 *   total: 4.2,
 *   status: 'sent',
 * });
 */
export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Initialize A4 document
      const doc = new PDFDocument({ margin: LAYOUT.MARGIN, size: 'A4' });
      const chunks: Buffer[] = [];

      // Collect output chunks
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const primary = safeColor(data.company.primaryColor, DEFAULT_PRIMARY_COLOR);

      // Render document sections, each starting where the previous one
      // actually ended.
      const headerBottom = renderHeader(doc, data.company, 'INVOICE');
      const detailsBottom = renderInvoiceDetails(doc, data, headerBottom);
      const tableEndY = renderItemsTable(doc, data.items, data.company.currency || 'GBP', detailsBottom + 20, primary);
      const totalsEndY = renderTotals(doc, data, tableEndY, primary);
      renderPaymentInfo(doc, data.company, totalsEndY, primary);
      renderFooter(doc, data.company);

      // Finalize document
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
