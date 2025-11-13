import path from 'path'
import os from 'os'
import fs from 'fs'
import { generateInvoicePDF } from '../pdf/generateInvoice'
import type { InvoicesPort, OrderId } from '@midnight/domain'

export const InvoicesPortPuppeteer: InvoicesPort = {
  async createAndStore(orderId: OrderId){
    // Minimal demo payload; replace with DB lookup
    const items = [{ name:'Legend Tee — Neon Blue', quantity:1, price: 35, total: 35 }];
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const tax = subtotal * 0.2;
    const total = subtotal + tax;
    
    const data = {
      invoiceNumber: `INV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(orderId).slice(-4)}`,
      date: new Date().toLocaleDateString(),
      customerName: 'Demo Customer',
      customerEmail: undefined,
      customerAddress: '1 Demo Street, Birmingham, B1 1AA',
      items,
      subtotal,
      tax,
      total,
      businessName: 'Midnight Standard',
      businessAddress: 'Birmingham, UK',
      businessPhone: undefined,
      businessEmail: 'info@midnightepos.com'
    }
    const out = path.join(os.tmpdir(), `${data.invoiceNumber}.pdf`)
    await generateInvoicePDF(data)
    // In real use, upload to Drive/S3 and return link
    return { invoiceId: data.invoiceNumber, fileUrl: out }
  }
}