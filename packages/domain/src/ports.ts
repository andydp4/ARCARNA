import type { Order, ProductId, CustomerId, OrderId } from './types'
export interface OrdersRepo { save(o: Order): Promise<void>; findById(id: OrderId): Promise<Order|null> }
export interface ProductsRepo { reserveStock(p: ProductId, qty: number): Promise<void> }
export interface CustomersRepo { addTickDebt(c: CustomerId, amount: number): Promise<void>; addOrderHistory(c: CustomerId, orderId: OrderId): Promise<void> }
export interface InvoicesPort { createAndStore(orderId: OrderId): Promise<{ invoiceId:string; fileUrl?:string }> }
export interface AnalyticsSink { recordOrder(orderId: OrderId): Promise<void> }
export interface AuditPort { log(event: string, payload: unknown): Promise<void> }