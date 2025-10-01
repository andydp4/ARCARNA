export type Brand<K, T> = K & { readonly __brand: T }
export type ProductId = Brand<string, 'ProductId'>
export type CustomerId = Brand<string, 'CustomerId'>
export type OrderId = Brand<string, 'OrderId'>
export type MoneyGBP = number

export type OrderLine = { productId: ProductId; quantity: number; unitPrice: MoneyGBP; lineTotal: MoneyGBP }
export type Order = {
  id: OrderId; customerId?: CustomerId; lines: OrderLine[];
  subtotal: MoneyGBP; vat: MoneyGBP; total: MoneyGBP;
  paymentMethod: 'cash'|'card'|'transfer'|'tick';
  status: 'pending'|'processing'|'completed'|'cancelled'; createdAt: Date;
}