import { z } from 'zod'
import { positiveQuantity } from '../../../shared/quantity'
export const OrderLineInput = z.object({ 
  productId: z.string().min(1), 
  // Decimal, not integer: a shop selling by weight needs 0.4 of a product.
  // The 10000 ceiling is a per-line sanity bound, kept from the original.
  quantity: positiveQuantity.refine(val => val < 10000, { message: "Quantity must be less than 10,000" }),
  unitPrice: z.number().nonnegative().finite().refine(val => val >= 0 && val < 1000000, { message: "Price must be non-negative and less than 1,000,000" })
})
export const PlaceOrderInput = z.object({
  // Must be a uuid when present. Walk-in orders send "" / null, which we
  // normalise to undefined rather than reject. Validating here keeps
  // unvalidated strings out of downstream queries (see CustomersRepo.updateMetrics).
  customerId: z
    .union([z.string().uuid(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === null ? undefined : v)),
  lines: z.array(OrderLineInput).min(1),
  paymentMethod: z.enum(['cash','card','transfer','tick','gift_card']),
  orgId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  // Must be declared even though nothing in the engine branches on it: this is
  // a plain z.object, so it strips unknown keys, and an undeclared field is
  // dropped here silently rather than rejected. Omitted means collection, which
  // matches the column default and the backfill.
  fulfilmentMethod: z.enum(['collection', 'delivery']).optional(),
  // Org's configured VAT/sales-tax rate as a percentage (e.g. 20 for 20%).
  // Injected by the route from organizations.default_tax_rate. Optional so
  // existing callers keep the previous fixed 20% behaviour.
  taxRatePercent: z.number().min(0).max(100).optional(),
})
export type PlaceOrderDTO = z.infer<typeof PlaceOrderInput>
export const UpdateOrderInput = z.object({ lines: z.array(OrderLineInput).min(1) })
export type UpdateOrderDTO = z.infer<typeof UpdateOrderInput>