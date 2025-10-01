// Simple invoice PDF generator stub
import puppeteer from 'puppeteer'
import fs from 'fs/promises'

export async function generateInvoicePDF(data: any, outputPath: string) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #1E293B; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        .total { text-align: right; margin-top: 20px; font-size: 18px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1>INVOICE</h1>
          <p>Invoice #: ${data.invoiceNumber}</p>
          <p>Date: ${new Date(data.invoiceDateISO).toLocaleDateString()}</p>
        </div>
        <div>
          <h3>${data.company.name}</h3>
          <p>${data.company.address}</p>
          <p>VAT: ${data.company.vatNumber}</p>
        </div>
      </div>
      
      <div>
        <h3>Bill To:</h3>
        <p>${data.customerName}</p>
        ${data.customerAddressLines.map((line: string) => `<p>${line}</p>`).join('')}
      </div>
      
      <table>
        <tr>
          <th>Item</th>
          <th>Quantity</th>
          <th>Unit Price</th>
          <th>Total</th>
        </tr>
        ${data.items.map((item: any) => `
          <tr>
            <td>${item.name}</td>
            <td>${item.quantity}</td>
            <td>£${item.unitPriceGBP.toFixed(2)}</td>
            <td>£${(item.quantity * item.unitPriceGBP).toFixed(2)}</td>
          </tr>
        `).join('')}
      </table>
      
      <div class="total">
        <p>Subtotal: £${data.items.reduce((s:number, i:any) => s + i.quantity * i.unitPriceGBP, 0).toFixed(2)}</p>
        <p>VAT (${data.vatRate * 100}%): £${(data.items.reduce((s:number, i:any) => s + i.quantity * i.unitPriceGBP, 0) * data.vatRate).toFixed(2)}</p>
        <p><strong>Total: £${(data.items.reduce((s:number, i:any) => s + i.quantity * i.unitPriceGBP, 0) * (1 + data.vatRate)).toFixed(2)}</strong></p>
      </div>
    </body>
    </html>
  `
  
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setContent(html)
  await page.pdf({ path: outputPath, format: 'A4' })
  await browser.close()
}