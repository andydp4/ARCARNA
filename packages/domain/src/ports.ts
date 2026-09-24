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
  /**
   * Checking stock for a new sale (v1.2.1, E2E-07). The stock row is locked
   * for the rest of the sale's transaction and sales not yet taken off stock
   * are counted as gone, so two tills selling the last unit at once see it
   * the way they would one after the other.
   */
  forSale?: boolean
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
/**
 * One underpriced order line (PRC-03, CMP-03): sold below its minimum or
 * below known cost. Written silently; the sale never waits on it.
 */
export type PriceExceptionRecord = {
  orgId: string
  orderId: string
  productId: string
  userId: string | null
  source: 'sale' | 'edit'
  channel: string | null
  quantity: number
  unitPrice: number
  listPrice: number
  floorPrice: number
  unitCost: number | null
  belowMinimum: boolean
  belowCost: boolean
  underList: number
  underCost: number
}
export interface PriceExceptionsPort {
  /**
   * Must not leave the caller's transaction unusable when it fails (the
   * Drizzle port writes under a savepoint); the engine swallows the error.
   */
  record(rows: PriceExceptionRecord[]): Promise<void>
  /** The rows already recorded for an order, so an edit can tell what changed. */
  forOrder(orgId: string, orderId: string): Promise<PriceExceptionRecord[]>
  /**
   * An edit's reconciliation: drops the order's rows for these products and
   * writes `rows` in their place, so a breach is counted once, as it now
   * stands. Same savepoint rule as record().
   */
  replaceForOrder(orgId: string, orderId: string, productIds: string[], rows: PriceExceptionRecord[]): Promise<void>
}
