import { PlaceOrderInput } from './schemas'
import type { OrdersRepo, ProductsRepo, CustomersRepo, InvoicesPort, AnalyticsSink, AuditPort } from './ports'
import type { EventBus } from './bus'
import type { Order, OrderId, Product, ProductId, Customer, CustomerId } from './types'

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
      
      let invoiceId = null
      try {
        const result = await this.invoices.createAndStore(order.id)
        invoiceId = result.invoiceId
      } catch (error) {
        console.warn('[DomainEngine] Invoice generation failed (non-critical):', error)
      }
      
      await this.analytics.recordOrder(order.id)
      if (order.customerId) {
        await this.customers.addOrderHistory(order.customerId as any, order.id)
        // Update customer metrics after order
        await this.customers.updateMetrics(order.customerId as any)
        await this.analytics.updateCustomerMetrics(order.customerId as any)
      }
      await this.audit.log('OrderCompleted', { orderId: order.id, total: order.total })
      await this.bus.publish({ type: 'OrderPlaced', orderId: order.id, customerId: order.customerId as any })
      await this.bus.publish({ type: 'StockReserved', orderId: order.id })
      if (order.paymentMethod === 'tick' && order.customerId) await this.bus.publish({ type: 'TickAdded', orderId: order.id, customerId: order.customerId as any })
      if (invoiceId) await this.bus.publish({ type: 'InvoiceCreated', orderId: order.id, invoiceId })
      await this.bus.publish({ type: 'AnalyticsProjected', orderId: order.id })
      if (order.customerId) await this.bus.publish({ type: 'CustomerHistoryUpdated', orderId: order.id, customerId: order.customerId as any })
      return order.id
    })
    return { orderId }
  }

  // Product Management Methods
  async createProduct(input: unknown): Promise<Product> {
    const product = await this.withTransaction(async () => {
      const newProduct: Product = {
        id: crypto.randomUUID() as ProductId,
        productCode: (input as any).productId || `PRD-${Date.now()}`,
        name: (input as any).name,
        barcode: (input as any).barcode,
        price: (input as any).price || 0,
        tax: (input as any).tax || 0,
        stock: (input as any).stock || 0,
        stockLimit: (input as any).stockLimit || 100,
        categoryId: (input as any).categoryId,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const created = await this.products.create(newProduct)
      await this.audit.log('ProductCreated', { productId: created.id, name: created.name })
      await this.bus.publish({ type: 'ProductCreated', productId: created.id })
      return created
    })
    return product
  }

  async updateProduct(id: string, input: unknown): Promise<Product> {
    const product = await this.withTransaction(async () => {
      const productId = id as ProductId
      const existing = await this.products.findById(productId)
      if (!existing) throw new Error('Product not found')
      
      const updated = await this.products.update(productId, {
        ...(input as any),
        updatedAt: new Date(),
      })
      await this.audit.log('ProductUpdated', { productId: updated.id, changes: input })
      await this.bus.publish({ type: 'ProductUpdated', productId: updated.id })
      return updated
    })
    return product
  }

  async deleteProduct(id: string): Promise<void> {
    await this.withTransaction(async () => {
      const productId = id as ProductId
      const existing = await this.products.findById(productId)
      if (!existing) throw new Error('Product not found')
      
      await this.products.delete(productId)
      await this.audit.log('ProductDeleted', { productId })
      await this.bus.publish({ type: 'ProductDeleted', productId })
    })
  }

  async getProducts(): Promise<Product[]> {
    return await this.products.findAll()
  }

  async getProduct(id: string): Promise<Product | null> {
    return await this.products.findById(id as ProductId)
  }

  // Customer Management Methods
  async createCustomer(input: unknown): Promise<Customer> {
    const customer = await this.withTransaction(async () => {
      const newCustomer: Customer = {
        id: crypto.randomUUID() as CustomerId,
        name: (input as any).name,
        phone: (input as any).phone,
        email: (input as any).email,
        address: (input as any).address,
        category: (input as any).category || 'Bronze',
        loyaltyPoints: 0,
        totalSpent: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const created = await this.customers.create(newCustomer)
      await this.audit.log('CustomerCreated', { customerId: created.id, name: created.name })
      await this.bus.publish({ type: 'CustomerCreated', customerId: created.id })
      return created
    })
    return customer
  }

  async updateCustomer(id: string, input: unknown): Promise<Customer> {
    const customer = await this.withTransaction(async () => {
      const customerId = id as CustomerId
      const existing = await this.customers.findById(customerId)
      if (!existing) throw new Error('Customer not found')
      
      const previousCategory = existing.category
      const updated = await this.customers.update(customerId, {
        ...(input as any),
        updatedAt: new Date(),
      })
      
      // If category changed, trigger loyalty tier update
      if (previousCategory !== updated.category) {
        await this.analytics.updateCustomerMetrics(customerId)
        await this.bus.publish({ type: 'CustomerTierChanged', customerId, from: previousCategory, to: updated.category })
      }
      
      await this.audit.log('CustomerUpdated', { customerId: updated.id, changes: input })
      await this.bus.publish({ type: 'CustomerUpdated', customerId: updated.id })
      return updated
    })
    return customer
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.withTransaction(async () => {
      const customerId = id as CustomerId
      const existing = await this.customers.findById(customerId)
      if (!existing) throw new Error('Customer not found')
      
      await this.customers.delete(customerId)
      await this.audit.log('CustomerDeleted', { customerId })
      await this.bus.publish({ type: 'CustomerDeleted', customerId })
    })
  }

  async getCustomers(): Promise<Customer[]> {
    return await this.customers.findAll()
  }

  async getCustomer(id: string): Promise<Customer | null> {
    return await this.customers.findById(id as CustomerId)
  }

  // Update customer metrics (CLV, RFM) - called by worker
  async updateCustomerMetrics(id: string): Promise<void> {
    await this.withTransaction(async () => {
      const customerId = id as CustomerId
      await this.customers.updateMetrics(customerId)
      await this.analytics.updateCustomerMetrics(customerId)
      await this.bus.publish({ type: 'CustomerMetricsUpdated', customerId })
    })
  }
}