import type { OrderId, CustomerId } from './types'
export type DomainEvent =
  | { type: 'OrderPlaced'; orderId: OrderId; customerId?: CustomerId }
  | { type: 'StockReserved'; orderId: OrderId }
  | { type: 'TickAdded'; orderId: OrderId; customerId: CustomerId }
  | { type: 'InvoiceCreated'; orderId: OrderId; invoiceId: string }
  | { type: 'AnalyticsProjected'; orderId: OrderId }
  | { type: 'CustomerHistoryUpdated'; orderId: OrderId; customerId: CustomerId };
export type EventHandler = (e: DomainEvent) => Promise<void>;