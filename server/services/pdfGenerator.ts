/**
 * PDF Invoice Generator
 *
 * Generates professional PDF invoices using PDFKit, branded per-organisation
 * from the details each business configures in Settings/the setup wizard
 * (name, address, logo, tax rate, bank/payment details) — every org's
 * invoices look like their own business, not a shared template.
 *
 * Features:
 * - A4 format with professional layout
 * - Company logo (if the org has one and enabled it for invoices)
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
    ROW_HEIGHT: 18,
    /** Table header height */
    HEADER_HEIGHT: 20,
  },
  /** Company info header position */
  HEADER_Y: 45,
  /** Invoice details start position */
  DETAILS_Y: 140,
  /** Table start position */
  TABLE_TOP_Y: 230,
  /** Maximum Y before page break */
  PAGE_BREAK_Y: 680,
};

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

// ============================================================================
// PDF Section Renderers
// ============================================================================

/**
 * Renders the company header with logo and contact information.
 * 
 * @param doc - PDFKit document instance
 */
function renderHeader(doc: PDFKit.PDFDocument, company: InvoiceCompanyInfo): void {
  // Company logo (left side), if the org has one and enabled it for invoices
  if (company.logo) {
    try {
      doc.image(company.logo, 50, 40, { width: 80 });
    } catch {
      // Malformed/unsupported image — skip rather than fail the whole invoice.
    }
  }

  // INVOICE title (right side)
  doc.fontSize(24).fillColor('#000000').text('INVOICE', 400, 50, { align: 'right' });

  // Company details (next to logo)
  doc.fontSize(9).fillColor('#3E3E3E');
  let y = LAYOUT.HEADER_Y;
  doc.text(company.name, 140, y);
  y += 13;
  if (company.address) {
    doc.text(company.address, 140, y, { width: 250 });
    y += 13;
  }
  if (company.companyNumber) {
    doc.text(`Company No: ${company.companyNumber}`, 140, y);
    y += 13;
  }
  if (company.vatNumber) {
    doc.text(`VAT No: ${company.vatNumber}`, 140, y);
    y += 13;
  }
  if (company.email) {
    doc.text(company.email, 140, y);
  }
}

/**
 * Renders invoice metadata and customer billing information.
 * 
 * @param doc - PDFKit document instance
 * @param data - Invoice data
 */
function renderInvoiceDetails(doc: PDFKit.PDFDocument, data: InvoiceData): void {
  const y = LAYOUT.DETAILS_Y;

  // Left column: Invoice details
  doc.fontSize(10).fillColor('#000000');
  doc.text('Invoice Number:', 50, y);
  doc.text(data.invoiceNumber, 150, y);
  doc.text('Date:', 50, y + 15);
  doc.text(formatDate(data.createdAt), 150, y + 15);
  doc.text('Due Date:', 50, y + 30);
  doc.text(data.dueDate, 150, y + 30);
  doc.text('Status:', 50, y + 45);
  doc.text(data.status.toUpperCase(), 150, y + 45);

  // Right column: Customer billing address
  if (data.customerName || data.customerEmail) {
    doc.fontSize(10).fillColor('#000000');
    doc.text('Bill To:', 350, y, { underline: true });
    let billY = y + 15;
    
    if (data.customerName) {
      doc.text(data.customerName, 350, billY);
      billY += 12;
    }
    if (data.customerEmail) {
      doc.text(data.customerEmail, 350, billY);
      billY += 12;
    }
    if (data.customerPhone) {
      doc.text(data.customerPhone, 350, billY);
      billY += 12;
    }
    if (data.customerAddress) {
      doc.text(data.customerAddress, 350, billY, { width: 180 });
    }
  }
}

/**
 * Renders the line items table with header and rows.
 * Handles page breaks for long item lists.
 * 
 * @param doc - PDFKit document instance
 * @param items - Array of invoice line items
 * @returns Y position after table for following sections
 */
function renderItemsTable(doc: PDFKit.PDFDocument, items: InvoiceLineItem[], currency: string): number {
  const { COL_DESCRIPTION, COL_QUANTITY, COL_UNIT_PRICE, COL_AMOUNT, ROW_HEIGHT, HEADER_HEIGHT } = LAYOUT.TABLE;
  let y = LAYOUT.TABLE_TOP_Y;

  // Table header (black background)
  doc.fillColor('#000000').rect(COL_DESCRIPTION, y, 495, HEADER_HEIGHT).fill();
  doc.fillColor('#FFFFFF').fontSize(10);
  doc.text('Description', COL_DESCRIPTION + 5, y + 5);
  doc.text('Qty', COL_QUANTITY, y + 5);
  doc.text('Unit Price', COL_UNIT_PRICE, y + 5);
  doc.text('Amount', COL_AMOUNT, y + 5);

  // Table rows
  y += 30;
  doc.fillColor('#3E3E3E');

  for (const item of items) {
    // Page break if needed
    if (y > LAYOUT.PAGE_BREAK_Y) {
      doc.addPage();
      y = 50;
    }

    doc.fontSize(9);
    doc.text(item.name, COL_DESCRIPTION, y, { width: 240 });
    doc.text(String(item.quantity), COL_QUANTITY, y);
    doc.text(formatCurrency(item.unitPrice, currency), COL_UNIT_PRICE, y);
    doc.text(formatCurrency(item.total, currency), COL_AMOUNT, y);
    y += ROW_HEIGHT;
  }

  return y;
}

/**
 * Renders the invoice totals section, with VAT at the org's actual rate.
 *
 * @param doc - PDFKit document instance
 * @param data - Invoice data with totals
 * @param startY - Y position to start rendering
 * @returns Y position after totals
 */
function renderTotals(doc: PDFKit.PDFDocument, data: InvoiceData, startY: number): number {
  let y = startY + 15;
  const currency = data.company.currency || 'GBP';

  // Separator line
  doc.moveTo(350, y).lineTo(545, y).stroke('#E2E8F0');
  y += 10;

  // Subtotal
  doc.fontSize(10).fillColor('#3E3E3E');
  doc.text('Subtotal:', 380, y);
  doc.text(formatCurrency(data.subtotal, currency), 480, y, { align: 'right', width: 65 });
  y += 18;

  // VAT at the org's actual rate
  const vatRate = data.subtotal > 0 ? Math.round((data.tax / data.subtotal) * 1000) / 10 : 0;
  doc.text(`VAT (${vatRate}%):`, 380, y);
  doc.text(formatCurrency(data.tax, currency), 480, y, { align: 'right', width: 65 });
  y += 18;

  // Total separator
  doc.moveTo(350, y).lineTo(545, y).stroke('#000000');
  y += 8;

  // Grand total
  doc.fontSize(12).fillColor('#000000');
  doc.text('Total:', 380, y);
  doc.text(formatCurrency(data.total, currency), 480, y, { align: 'right', width: 65 });

  return y;
}

/**
 * Renders the payment information section with bank details and/or an online
 * payment link — only if the org has configured at least one of them.
 *
 * @param doc - PDFKit document instance
 * @param company - Issuing org's details
 * @param startY - Y position to start rendering
 */
function renderPaymentInfo(doc: PDFKit.PDFDocument, company: InvoiceCompanyInfo, startY: number): void {
  const hasBankDetails = company.bankName || company.bankSortCode || company.bankAccountNumber;
  if (!hasBankDetails && !company.paymentLink) return;

  let y = startY + 50;

  // Section header
  doc.fontSize(11).fillColor('#000000');
  doc.text('Payment Information', 50, y, { underline: true });
  y += 18;

  doc.fontSize(9).fillColor('#3E3E3E');

  if (company.bankName) {
    doc.text('Bank Details:', 50, y);
    doc.text(company.bankName, 130, y);
    y += 14;
  }
  if (company.bankSortCode) {
    doc.text('Sort Code:', 50, y);
    doc.text(company.bankSortCode, 130, y);
    y += 14;
  }
  if (company.bankAccountNumber) {
    doc.text('Account No:', 50, y);
    doc.text(company.bankAccountNumber, 130, y);
    y += 14;
  }
  if (company.paymentLink) {
    doc.fillColor('#3E3E3E').text('Pay Online:', 50, y);
    doc.fillColor('#0066CC').text(company.paymentLink, 130, y, {
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
  const footerY = doc.page.height - 50;
  const pageWidth = doc.page.width - 100;

  doc.fontSize(8).fillColor('#94A3B8');
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
 * Generates a complete PDF invoice document, branded for the issuing org.
 *
 * The PDF includes:
 * - Company header with logo (if configured)
 * - Invoice metadata (number, dates, status)
 * - Customer billing address
 * - Line items table with real product/service names
 * - Totals with VAT at the org's actual rate
 * - Payment information (bank transfer and/or online), if configured
 * - Footer with thank you message
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

      // Render document sections
      renderHeader(doc, data.company);
      renderInvoiceDetails(doc, data);
      const tableEndY = renderItemsTable(doc, data.items, data.company.currency || 'GBP');
      const totalsEndY = renderTotals(doc, data, tableEndY);
      renderPaymentInfo(doc, data.company, totalsEndY);
      renderFooter(doc, data.company);

      // Finalize document
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
