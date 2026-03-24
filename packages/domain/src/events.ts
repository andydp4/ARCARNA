import type { OrderId, CustomerId, ProductId } from './types'
export type DomainEvent =
  | { type: 'OrderPlaced'; orderId: OrderId; customerId?: CustomerId }
  | { type: 'StockReserved'; orderId: OrderId }
  | { type: 'TickAdded'; orderId: OrderId; customerId: CustomerId }
  | { type: 'InvoiceCreated'; orderId: OrderId; invoiceId: string }
  | { type: 'AnalyticsProjected'; orderId: OrderId }
  | { type: 'CustomerHistoryUpdated'; orderId: OrderId; customerId: CustomerId }
  | { type: 'ProductCreated'; productId: ProductId }
  | { type: 'ProductUpdated'; productId: ProductId }
  | { type: 'ProductDeleted'; productId: ProductId }
  | { type: 'CustomerCreated'; customerId: CustomerId; name: string }
  | { type: 'CustomerUpdated'; customerId: CustomerId }
  | { type: 'CustomerDeleted'; customerId: CustomerId }
  | { type: 'CustomerTierChanged'; customerId: CustomerId; from: string; to: string }
  | { type: 'CustomerMetricsUpdated'; customerId: CustomerId }
  | { type: 'OrderUpdated'; orderId: OrderId };
export type EventHandler = (e: DomainEvent) => Promise<void>;