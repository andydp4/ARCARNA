import PDFDocument from 'pdfkit';

interface InvoiceData {
  invoiceNumber: string;
  createdAt: string;
  dueDate: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
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

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(24).fillColor('#1E293B').text('INVOICE', { align: 'right' });
      doc.moveDown(0.5);

      doc.fontSize(10).fillColor('#64748B');
      doc.text('Midnight EPOS', 50, 50);
      doc.text('Point of Sale System', 50, 65);
      doc.moveDown(2);

      const topY = 120;
      doc.fontSize(10).fillColor('#1E293B');
      doc.text(`Invoice Number: ${data.invoiceNumber}`, 50, topY);
      doc.text(`Date: ${new Date(data.createdAt).toLocaleDateString()}`, 50, topY + 15);
      doc.text(`Due Date: ${data.dueDate}`, 50, topY + 30);
      doc.text(`Status: ${data.status.toUpperCase()}`, 50, topY + 45);

      if (data.customerName || data.customerEmail) {
        doc.text('Bill To:', 350, topY, { underline: true });
        if (data.customerName) doc.text(data.customerName, 350, topY + 15);
        if (data.customerEmail) doc.text(data.customerEmail, 350, topY + 30);
        if (data.customerPhone) doc.text(data.customerPhone, 350, topY + 45);
      }

      const tableTop = 220;
      const col1 = 50;
      const col2 = 280;
      const col3 = 350;
      const col4 = 420;
      const col5 = 490;

      doc.fillColor('#3B82F6').rect(col1, tableTop, 500, 20).fill();
      doc.fillColor('#FFFFFF').fontSize(10);
      doc.text('Item', col1 + 5, tableTop + 5);
      doc.text('Qty', col2, tableTop + 5);
      doc.text('Price', col3, tableTop + 5);
      doc.text('Total', col4, tableTop + 5);

      let y = tableTop + 30;
      doc.fillColor('#1E293B');
      
      for (const item of data.items) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        
        doc.text(item.name.substring(0, 40), col1, y);
        doc.text(String(item.quantity), col2, y);
        doc.text(`$${item.unitPrice.toFixed(2)}`, col3, y);
        doc.text(`$${item.total.toFixed(2)}`, col4, y);
        y += 20;
      }

      y += 20;
      doc.moveTo(350, y).lineTo(550, y).stroke('#E2E8F0');
      y += 10;

      doc.fontSize(10);
      doc.text('Subtotal:', 350, y);
      doc.text(`$${data.subtotal.toFixed(2)}`, 480, y, { align: 'right', width: 70 });
      y += 20;

      doc.text('Tax:', 350, y);
      doc.text(`$${data.tax.toFixed(2)}`, 480, y, { align: 'right', width: 70 });
      y += 20;

      doc.moveTo(350, y).lineTo(550, y).stroke('#1E293B');
      y += 10;

      doc.fontSize(14).fillColor('#10B981');
      doc.text('Total:', 350, y);
      doc.text(`$${data.total.toFixed(2)}`, 480, y, { align: 'right', width: 70 });

      if (data.paymentMethod) {
        y += 40;
        doc.fontSize(10).fillColor('#64748B');
        doc.text(`Payment Method: ${data.paymentMethod}`, 350, y);
      }

      doc.fontSize(8).fillColor('#94A3B8');
      doc.text(
        'Thank you for your business!',
        50,
        doc.page.height - 50,
        { align: 'center', width: doc.page.width - 100 }
      );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
