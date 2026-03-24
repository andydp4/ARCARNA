import puppeteer from 'puppeteer';

interface InvoiceData {
  invoiceNumber: string;
  date: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  businessName?: string;
  businessAddress?: string;
  businessPhone?: string;
  businessEmail?: string;
}

/**
 * Generate an invoice PDF using Puppeteer
 */
export async function generateInvoicePDF(invoiceData: InvoiceData): Promise<Buffer> {
  // Create HTML template for the invoice
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 20px;
          color: #333;
        }
        .invoice-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 30px;
        }
        .business-details {
          flex: 1;
        }
        .invoice-details {
          text-align: right;
          flex: 1;
        }
        .invoice-number {
          font-size: 24px;
          font-weight: bold;
          color: #1E293B;
        }
        .customer-details {
          margin-bottom: 30px;
          padding: 15px;
          background-color: #f5f5f5;
          border-radius: 5px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 30px;
        }
        th {
          background-color: #1E293B;
          color: white;
          padding: 10px;
          text-align: left;
        }
        td {
          padding: 10px;
          border-bottom: 1px solid #ddd;
        }
        .totals {
          text-align: right;
          margin-top: 30px;
        }
        .total-row {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 10px;
        }
        .total-label {
          width: 150px;
          font-weight: bold;
        }
        .total-value {
          width: 150px;
          text-align: right;
        }
        .grand-total {
          font-size: 20px;
          color: #1E293B;
          border-top: 2px solid #1E293B;
          padding-top: 10px;
        }
        .footer {
          margin-top: 50px;
          text-align: center;
          color: #666;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="invoice-header">
        <div class="business-details">
          <h1>${invoiceData.businessName || 'Midnight EPOS'}</h1>
          <p>${invoiceData.businessAddress || '123 Main Street'}</p>
          <p>${invoiceData.businessPhone || '+1 234 567 890'}</p>
          <p>${invoiceData.businessEmail || 'info@midnightepos.com'}</p>
        </div>
        <div class="invoice-details">
          <div class="invoice-number">INVOICE</div>
          <p><strong>Invoice #:</strong> ${invoiceData.invoiceNumber}</p>
          <p><strong>Date:</strong> ${invoiceData.date}</p>
        </div>
      </div>

      <div class="customer-details">
        <h3>Bill To:</h3>
        <p><strong>${invoiceData.customerName}</strong></p>
        ${invoiceData.customerEmail ? `<p>${invoiceData.customerEmail}</p>` : ''}
        ${invoiceData.customerAddress ? `<p>${invoiceData.customerAddress}</p>` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th style="text-align: center;">Quantity</th>
            <th style="text-align: right;">Price</th>
            <th style="text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${invoiceData.items.map(item => `
            <tr>
              <td>${item.name}</td>
              <td style="text-align: center;">${item.quantity}</td>
              <td style="text-align: right;">£${item.price.toFixed(2)}</td>
              <td style="text-align: right;">£${item.total.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="totals">
        <div class="total-row">
          <div class="total-label">Subtotal:</div>
          <div class="total-value">£${invoiceData.subtotal.toFixed(2)}</div>
        </div>
        <div class="total-row">
          <div class="total-label">VAT (20%):</div>
          <div class="total-value">£${invoiceData.tax.toFixed(2)}</div>
        </div>
        <div class="total-row grand-total">
          <div class="total-label">Total:</div>
          <div class="total-value">£${invoiceData.total.toFixed(2)}</div>
        </div>
      </div>

      <div class="footer">
        <p>Thank you for your business!</p>
        <p>Payment due within 30 days</p>
      </div>
    </body>
    </html>
  `;

  try {
    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Set the HTML content
    await page.setContent(html, {
      waitUntil: 'networkidle0'
    });

    // Generate PDF
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        bottom: '20mm',
        left: '20mm',
        right: '20mm'
      }
    });

    await browser.close();
    
    return Buffer.from(pdf);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error('Failed to generate invoice PDF');
  }
}