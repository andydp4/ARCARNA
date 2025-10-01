import { PlaceOrderInput } from './schemas'
import type { OrdersRepo, ProductsRepo, CustomersRepo, InvoicesPort, AnalyticsSink, AuditPort } from './ports'
import type { EventBus } from './bus'
import type { Order, OrderId } from './types'

export class DomainEngine {
  constructor(
    private readonly bus: EventBus,
    private readonly orders: OrdersRepo,
    private readonly products: ProductsRepo,
    private readonly customers: CustomersRepo,
    private readonly invoices: InvoicesPort,
    private readonly analytics: AnalyticsSink,
    private readonly audit: AuditPort,
    private readonly withTransaction: <T>(fn: ()=>Promise<T>)=>Promise<T>,
  ){}

  async placeOrder(input: unknown): Promise<{ orderId: OrderId }> {
    const dto = PlaceOrderInput.parse(input)
    const subtotal = +dto.lines.reduce((s: number, l: any)=> s + l.quantity*l.unitPrice, 0).toFixed(2)
    const vat = +(subtotal * 0.20).toFixed(2)
    const total = +(subtotal + vat).toFixed(2)

    const orderId = await this.withTransaction(async () => {
      const order: Order = {
        id: crypto.randomUUID() as OrderId,
        customerId: dto.customerId as any,
        lines: dto.lines.map((l: any) => ({ ...l, lineTotal: +(l.quantity*l.unitPrice).toFixed(2) })),
        subtotal, vat, total, paymentMethod: dto.paymentMethod, status: 'completed', createdAt: new Date(),
      }
      await this.orders.save(order)
      for (const l of order.lines) await this.products.reserveStock(l.productId as any, l.quantity)
      if (order.paymentMethod === 'tick' && order.customerId) await this.customers.addTickDebt(order.customerId as any, order.total)
      const { invoiceId } = await this.invoices.createAndStore(order.id)
      await this.analytics.recordOrder(order.id)
      if (order.customerId) await this.customers.addOrderHistory(order.customerId as any, order.id)
      await this.audit.log('OrderCompleted', { orderId: order.id, total: order.total })
      await this.bus.publish({ type: 'OrderPlaced', orderId: order.id, customerId: order.customerId as any })
      await this.bus.publish({ type: 'StockReserved', orderId: order.id })
      if (order.paymentMethod === 'tick' && order.customerId) await this.bus.publish({ type: 'TickAdded', orderId: order.id, customerId: order.customerId as any })
      await this.bus.publish({ type: 'InvoiceCreated', orderId: order.id, invoiceId })
      await this.bus.publish({ type: 'AnalyticsProjected', orderId: order.id })
      if (order.customerId) await this.bus.publish({ type: 'CustomerHistoryUpdated', orderId: order.id, customerId: order.customerId as any })
      return order.id
    })
    return { orderId }
  }
}