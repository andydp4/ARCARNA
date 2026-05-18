import type { Order, Product, Customer, ProductId, CustomerId, OrderId } from './types'
export type { OrderId }
export interface OrdersRepo { 
  save(o: Order): Promise<void>
  findById(id: OrderId): Promise<Order|null> 
}
export type StockContext = {
  orgId: string
  locationId?: string | null
  orderId?: string | null
  userId?: string | null
}

export interface ProductsRepo { 
  checkStock(p: ProductId, ctx?: StockContext): Promise<number>
  reserveStock(p: ProductId, qty: number, ctx: StockContext): Promise<void>
  releaseStock(p: ProductId, qty: number, ctx: StockContext): Promise<void>
  create(product: Product): Promise<Product>
  update(id: ProductId, product: Partial<Product>, orgId?: string | null): Promise<Product>
  delete(id: ProductId, orgId?: string | null): Promise<void>
  findById(id: ProductId): Promise<Product|null>
  findAll(): Promise<Product[]>
}
export interface CustomersRepo { 
  addTickDebt(c: CustomerId, amount: number): Promise<void>
  addOrderHistory(c: CustomerId, orderId: OrderId): Promise<void>
  create(customer: Customer): Promise<Customer>
  update(id: CustomerId, customer: Partial<Customer>, orgId?: string | null): Promise<Customer>
  delete(id: CustomerId, orgId?: string | null): Promise<void>
  findById(id: CustomerId): Promise<Customer|null>
  findAll(): Promise<Customer[]>
  updateMetrics(c: CustomerId): Promise<void>
}
export interface InvoicesPort { createAndStore(orderId: OrderId): Promise<{ invoiceId:string; fileUrl?:string }> }
export interface AnalyticsSink { 
  recordOrder(orderId: OrderId): Promise<void>
  updateCustomerMetrics(customerId: CustomerId): Promise<void>
}
export interface AuditPort { log(event: string, payload: unknown): Promise<void> }