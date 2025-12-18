import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

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
};

interface InvoiceData {
  invoiceNumber: string;
  createdAt: string;
  dueDate: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
  paymentMethod?: string;
}

function getLineDescription(index: number, totalItems: number): string {
  if (index === 0) return 'Services rendered';
  if (index === 1) return 'Services rendered planning';
  if (index === 2) return 'Services rendered development';
  if (index === 3) return 'Services rendered implementation';
  if (index === 4) return 'Services rendered evaluation';
  return 'Expenses reclaimed';
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const logoPath = path.join(process.cwd(), 'server/assets/viger-logo.png');
      
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 40, { width: 80 });
      }

      doc.fontSize(24).fillColor('#000000').text('INVOICE', 400, 50, { align: 'right' });

      doc.fontSize(9).fillColor('#3E3E3E');
      doc.text(COMPANY_INFO.name, 140, 45);
      doc.text(COMPANY_INFO.address, 140, 58);
      doc.text(`${COMPANY_INFO.city}, ${COMPANY_INFO.postcode}`, 140, 71);
      doc.text(`Company No: ${COMPANY_INFO.companyNumber}`, 140, 84);
      doc.text(COMPANY_INFO.email, 140, 97);
      doc.text(COMPANY_INFO.website, 140, 110);

      const detailsY = 140;
      doc.fontSize(10).fillColor('#000000');
      doc.text(`Invoice Number:`, 50, detailsY);
      doc.text(data.invoiceNumber, 150, detailsY);
      doc.text(`Date:`, 50, detailsY + 15);
      doc.text(new Date(data.createdAt).toLocaleDateString('en-GB'), 150, detailsY + 15);
      doc.text(`Due Date:`, 50, detailsY + 30);
      doc.text(data.dueDate, 150, detailsY + 30);
      doc.text(`Status:`, 50, detailsY + 45);
      doc.text(data.status.toUpperCase(), 150, detailsY + 45);

      if (data.customerName || data.customerEmail) {
        doc.fontSize(10).fillColor('#000000');
        doc.text('Bill To:', 350, detailsY, { underline: true });
        let billY = detailsY + 15;
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

      const tableTop = 230;
      const col1 = 50;
      const col2 = 300;
      const col3 = 380;
      const col4 = 460;

      doc.fillColor('#000000').rect(col1, tableTop, 495, 20).fill();
      doc.fillColor('#FFFFFF').fontSize(10);
      doc.text('Description', col1 + 5, tableTop + 5);
      doc.text('Qty', col2, tableTop + 5);
      doc.text('Unit Price', col3, tableTop + 5);
      doc.text('Amount', col4, tableTop + 5);

      let y = tableTop + 30;
      doc.fillColor('#3E3E3E');
      
      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        if (y > 680) {
          doc.addPage();
          y = 50;
        }
        
        const description = getLineDescription(i, data.items.length);
        
        doc.fontSize(9);
        doc.text(description, col1, y, { width: 240 });
        doc.text(String(item.quantity), col2, y);
        doc.text(`£${item.unitPrice.toFixed(2)}`, col3, y);
        doc.text(`£${item.total.toFixed(2)}`, col4, y);
        y += 18;
      }

      y += 15;
      doc.moveTo(350, y).lineTo(545, y).stroke('#E2E8F0');
      y += 10;

      doc.fontSize(10).fillColor('#3E3E3E');
      doc.text('Subtotal:', 380, y);
      doc.text(`£${data.subtotal.toFixed(2)}`, 480, y, { align: 'right', width: 65 });
      y += 18;

      doc.text('VAT (0%):', 380, y);
      doc.text('£0.00', 480, y, { align: 'right', width: 65 });
      y += 18;

      doc.moveTo(350, y).lineTo(545, y).stroke('#000000');
      y += 8;

      doc.fontSize(12).fillColor('#000000');
      doc.text('Total:', 380, y);
      doc.text(`£${data.total.toFixed(2)}`, 480, y, { align: 'right', width: 65 });

      const paymentY = y + 50;
      doc.fontSize(11).fillColor('#000000');
      doc.text('Payment Information', 50, paymentY, { underline: true });
      
      doc.fontSize(9).fillColor('#3E3E3E');
      doc.text('Bank Transfer, Card and Mobile Payments Accepted', 50, paymentY + 18);
      
      doc.text('Bank Details:', 50, paymentY + 38);
      doc.text(COMPANY_INFO.bankName, 130, paymentY + 38);
      doc.text('Sort Code:', 50, paymentY + 52);
      doc.text(COMPANY_INFO.sortCode, 130, paymentY + 52);
      doc.text('Account No:', 50, paymentY + 66);
      doc.text(COMPANY_INFO.accountNumber, 130, paymentY + 66);
      
      doc.text('Pay Online:', 50, paymentY + 86);
      doc.fillColor('#0066CC').text(COMPANY_INFO.paymentLink, 130, paymentY + 86, {
        link: COMPANY_INFO.paymentLink,
        underline: true,
      });

      doc.fontSize(8).fillColor('#94A3B8');
      doc.text(
        'Thank you for your business!',
        50,
        doc.page.height - 50,
        { align: 'center', width: doc.page.width - 100 }
      );
      doc.text(
        `${COMPANY_INFO.name} | ${COMPANY_INFO.email} | ${COMPANY_INFO.website}`,
        50,
        doc.page.height - 38,
        { align: 'center', width: doc.page.width - 100 }
      );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
