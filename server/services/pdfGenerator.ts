/**
 * PDF Invoice Generator - Viger Assist Branding
 * 
 * Generates professional PDF invoices using PDFKit.
 * All invoices are branded with Viger Assist Ltd company details.
 * 
 * Features:
 * - A4 format with professional layout
 * - Company logo (if available)
 * - Customer billing details
 * - Line item descriptions with position-based labels
 * - Bank transfer and online payment information
 * - VAT always shown as 0% (Viger Assist policy)
 * - Currency: GBP (£)
 * 
 * Line Description Mapping:
 * - Position 1: "Services rendered"
 * - Position 2: "Services rendered planning"
 * - Position 3: "Services rendered development"
 * - Position 4: "Services rendered implementation"
 * - Position 5: "Services rendered evaluation"
 * - Position 6+: "Expenses reclaimed"
 * 
 * @module server/services/pdfGenerator
 */

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

// ============================================================================
// Company Configuration
// ============================================================================

/**
 * Viger Assist Ltd company information for invoice branding.
 * All invoices are issued under this company identity.
 */
const COMPANY_INFO = {
  name: 'Viger Assist Ltd',
  companyNumber: '16247814',
  address: '101 Apexlofts 50 Warwick Street',
  city: 'Birmingham',
  postcode: 'B12 0BA',
  email: 'invoices@vigerassist.com',
  website: 'VigerAssist.com',
  bankName: 'Viger Assist Ltd',
  sortCode: '23-08-01',
  accountNumber: '57623055',
  paymentLink: 'https://pay.anna.money/p/vigerassistltd/fwv',
} as const;

// ============================================================================
// Type Definitions
// ============================================================================

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
  /** Tax amount (displayed as VAT 0%) */
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
  /** Product/service name (not displayed - position-based labels used) */
  name: string;
  /** Quantity of items */
  quantity: number;
  /** Price per unit in GBP */
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
 * Converts line item position to descriptive label.
 * 
 * Business Rule:
 * Products are displayed with generic service descriptions rather
 * than specific product names, based on their position in the order.
 * 
 * @param index - Zero-based position in items array
 * @param totalItems - Total number of items (unused, for future expansion)
 * @returns Description string for PDF display
 */
function getLineDescription(index: number, totalItems: number): string {
  switch (index) {
    case 0: return 'Services rendered';
    case 1: return 'Services rendered planning';
    case 2: return 'Services rendered development';
    case 3: return 'Services rendered implementation';
    case 4: return 'Services rendered evaluation';
    default: return 'Expenses reclaimed';
  }
}

/**
 * Formats a number as GBP currency string.
 * 
 * @param amount - Numeric amount
 * @returns Formatted string with £ symbol (e.g., "£125.00")
 */
function formatCurrency(amount: number): string {
  return `£${amount.toFixed(2)}`;
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
function renderHeader(doc: PDFKit.PDFDocument): void {
  // Company logo (left side)
  const logoPath = path.join(process.cwd(), 'server/assets/viger-logo.png');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 40, { width: 80 });
  }

  // INVOICE title (right side)
  doc.fontSize(24).fillColor('#000000').text('INVOICE', 400, 50, { align: 'right' });

  // Company details (next to logo)
  doc.fontSize(9).fillColor('#3E3E3E');
  doc.text(COMPANY_INFO.name, 140, LAYOUT.HEADER_Y);
  doc.text(COMPANY_INFO.address, 140, LAYOUT.HEADER_Y + 13);
  doc.text(`${COMPANY_INFO.city}, ${COMPANY_INFO.postcode}`, 140, LAYOUT.HEADER_Y + 26);
  doc.text(`Company No: ${COMPANY_INFO.companyNumber}`, 140, LAYOUT.HEADER_Y + 39);
  doc.text(COMPANY_INFO.email, 140, LAYOUT.HEADER_Y + 52);
  doc.text(COMPANY_INFO.website, 140, LAYOUT.HEADER_Y + 65);
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
function renderItemsTable(doc: PDFKit.PDFDocument, items: InvoiceLineItem[]): number {
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

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    
    // Page break if needed
    if (y > LAYOUT.PAGE_BREAK_Y) {
      doc.addPage();
      y = 50;
    }

    // Use position-based description instead of product name
    const description = getLineDescription(i, items.length);

    doc.fontSize(9);
    doc.text(description, COL_DESCRIPTION, y, { width: 240 });
    doc.text(String(item.quantity), COL_QUANTITY, y);
    doc.text(formatCurrency(item.unitPrice), COL_UNIT_PRICE, y);
    doc.text(formatCurrency(item.total), COL_AMOUNT, y);
    y += ROW_HEIGHT;
  }

  return y;
}

/**
 * Renders the invoice totals section.
 * VAT is always displayed as 0% per Viger Assist policy.
 * 
 * @param doc - PDFKit document instance
 * @param data - Invoice data with totals
 * @param startY - Y position to start rendering
 * @returns Y position after totals
 */
function renderTotals(doc: PDFKit.PDFDocument, data: InvoiceData, startY: number): number {
  let y = startY + 15;

  // Separator line
  doc.moveTo(350, y).lineTo(545, y).stroke('#E2E8F0');
  y += 10;

  // Subtotal
  doc.fontSize(10).fillColor('#3E3E3E');
  doc.text('Subtotal:', 380, y);
  doc.text(formatCurrency(data.subtotal), 480, y, { align: 'right', width: 65 });
  y += 18;

  // VAT (always 0%)
  doc.text('VAT (0%):', 380, y);
  doc.text('£0.00', 480, y, { align: 'right', width: 65 });
  y += 18;

  // Total separator
  doc.moveTo(350, y).lineTo(545, y).stroke('#000000');
  y += 8;

  // Grand total
  doc.fontSize(12).fillColor('#000000');
  doc.text('Total:', 380, y);
  doc.text(formatCurrency(data.total), 480, y, { align: 'right', width: 65 });

  return y;
}

/**
 * Renders payment information section with bank details and online payment link.
 * 
 * @param doc - PDFKit document instance
 * @param startY - Y position to start rendering
 */
function renderPaymentInfo(doc: PDFKit.PDFDocument, startY: number): void {
  const y = startY + 50;

  // Section header
  doc.fontSize(11).fillColor('#000000');
  doc.text('Payment Information', 50, y, { underline: true });

  // Payment methods accepted
  doc.fontSize(9).fillColor('#3E3E3E');
  doc.text('Bank Transfer, Card and Mobile Payments Accepted', 50, y + 18);

  // Bank details
  doc.text('Bank Details:', 50, y + 38);
  doc.text(COMPANY_INFO.bankName, 130, y + 38);
  doc.text('Sort Code:', 50, y + 52);
  doc.text(COMPANY_INFO.sortCode, 130, y + 52);
  doc.text('Account No:', 50, y + 66);
  doc.text(COMPANY_INFO.accountNumber, 130, y + 66);

  // Online payment link
  doc.text('Pay Online:', 50, y + 86);
  doc.fillColor('#0066CC').text(COMPANY_INFO.paymentLink, 130, y + 86, {
    link: COMPANY_INFO.paymentLink,
    underline: true,
  });
}

/**
 * Renders the footer with thank you message and company contact.
 * 
 * @param doc - PDFKit document instance
 */
function renderFooter(doc: PDFKit.PDFDocument): void {
  const footerY = doc.page.height - 50;
  const pageWidth = doc.page.width - 100;

  doc.fontSize(8).fillColor('#94A3B8');
  doc.text('Thank you for your business!', 50, footerY, { 
    align: 'center', 
    width: pageWidth 
  });
  doc.text(
    `${COMPANY_INFO.name} | ${COMPANY_INFO.email} | ${COMPANY_INFO.website}`,
    50,
    footerY + 12,
    { align: 'center', width: pageWidth }
  );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generates a complete PDF invoice document.
 * 
 * The PDF includes:
 * - Company header with logo
 * - Invoice metadata (number, dates, status)
 * - Customer billing address
 * - Line items table with position-based descriptions
 * - Totals with VAT at 0%
 * - Payment information (bank transfer and online)
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
 *   customerName: 'John Smith',
 *   items: [{ name: 'Service', quantity: 1, unitPrice: 100, total: 100 }],
 *   subtotal: 100,
 *   tax: 0,
 *   total: 100,
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
      renderHeader(doc);
      renderInvoiceDetails(doc, data);
      const tableEndY = renderItemsTable(doc, data.items);
      const totalsEndY = renderTotals(doc, data, tableEndY);
      renderPaymentInfo(doc, totalsEndY);
      renderFooter(doc);

      // Finalize document
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
