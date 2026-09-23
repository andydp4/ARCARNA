export type Brand<K, T> = K & { readonly __brand: T }
export type ProductId = Brand<string, 'ProductId'>
export type CustomerId = Brand<string, 'CustomerId'>
export type OrderId = Brand<string, 'OrderId'>
export type MoneyGBP = number

export type Product = {
  id: ProductId
  productCode: string
  name: string
  barcode?: string
  /** null = cost not known. Never 0 for "unknown": 0 reads as a free item. */
  costPrice: MoneyGBP | null
  salePrice: MoneyGBP
  /** null = follows the sale price (shared/pricing/floor.ts). */
  minPrice?: MoneyGBP | null
  stock: number
  stockLimit: number
  categoryId?: string
  createdAt: Date
  updatedAt: Date
}

export type Customer = {
  id: CustomerId
  name: string
  phone?: string
  email?: string
  address?: string
  source?: string
  category: 'Bronze' | 'Silver' | 'Gold' | 'Platinum'
  loyaltyPoints: number
  totalSpent: MoneyGBP
  rfmScore?: number
  clv?: MoneyGBP
  createdAt: Date
  updatedAt: Date
}

export type OrderLine = { productId: ProductId; quantity: number; unitPrice: MoneyGBP; lineTotal: MoneyGBP }
export type OrderChannel = 'pos'|'web'|'api'|'whatsapp'|'phone'
export type Order = {
  id: OrderId; customerId?: CustomerId; lines: OrderLine[];
  subtotal: MoneyGBP; vat: MoneyGBP; total: MoneyGBP;
  paymentMethod: 'cash'|'card'|'transfer'|'tick'|'gift_card'|'split'|'personal_use';
  status: 'pending'|'completed'|'on-hold'|'awaiting-customer'|'urgent';
  channel?: OrderChannel;
  createdAt: Date;
}
