import type { InvoicesPort, OrderId } from '../../packages/domain/src/ports'

export const InvoicesPortStub: InvoicesPort = {
  async createAndStore(orderId: OrderId) {
    // Stub implementation - just generates an ID without PDF generation
    // In production, this would integrate with a real invoice service
    const invoiceNumber = `INV-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(orderId).slice(-4)}`
    return {
      invoiceId: invoiceNumber,
      fileUrl: undefined
    }
  }
}
