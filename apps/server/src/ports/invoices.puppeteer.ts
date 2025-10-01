import path from 'path'
import os from 'os'
import fs from 'fs'
import { generateInvoicePDF } from '../pdf/generateInvoice'
import type { InvoicesPort, OrderId } from '@midnight/domain'

export const InvoicesPortPuppeteer: InvoicesPort = {
  async createAndStore(orderId: OrderId){
    // Minimal demo payload; replace with DB lookup
    const data = {
      invoiceNumber: `INV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(orderId).slice(-4)}`,
      invoiceDateISO: new Date().toISOString(),
      customerName: 'Demo Customer',
      customerAddressLines: ['1 Demo Street','Birmingham','B1 1AA'],
      vatRate: 0.2,
      items: [{ name:'Legend Tee — Neon Blue', quantity:1, unitPriceGBP:35 }],
      company: { name:'Midnight Standard', address:'Birmingham, UK', vatNumber:'GBXXXXXXXX' }
    }
    const out = path.join(os.tmpdir(), `${data.invoiceNumber}.pdf`)
    await generateInvoicePDF(data as any, out)
    // In real use, upload to Drive/S3 and return link
    return { invoiceId: data.invoiceNumber, fileUrl: out }
  }
}