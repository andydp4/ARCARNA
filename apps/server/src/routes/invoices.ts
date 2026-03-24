import { Router } from 'express'
import { generateInvoicePDF } from '../pdf/generateInvoice'

const router = Router()
router.get('/:id/pdf', async (req, res) => {
  const id = req.params.id
  const data = {
    invoiceNumber: `INV-20251001-${id}`,
    invoiceDateISO: new Date().toISOString(),
    customerName: 'Demo Customer',
    customerAddressLines: ['1 Demo Street','Birmingham','B1 1AA'],
    vatRate: 0.2,
    items: [
      { name: 'Legend Tee — Neon Blue', quantity: 1, unitPriceGBP: 35.00 },
      { name: 'Standard Hoodie — Navy', quantity: 1, unitPriceGBP: 65.00 },
    ],
    company: { name: 'Midnight Standard', address: 'Birmingham, UK', vatNumber: 'GBXXXXXXXX' }
  }
  const pdf = await generateInvoicePDF(data as any)
  res.setHeader('Content-Type', 'application/pdf')
  res.send(pdf)
})
export default router