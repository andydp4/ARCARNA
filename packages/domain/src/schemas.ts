import { z } from 'zod'
export const OrderLineInput = z.object({ 
  productId: z.string().min(1), 
  quantity: z.number().int().positive().finite().refine(val => val > 0 && val < 10000, { message: "Quantity must be between 1 and 9999" }), 
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
  // Org's configured VAT/sales-tax rate as a percentage (e.g. 20 for 20%).
  // Injected by the route from organizations.default_tax_rate. Optional so
  // existing callers keep the previous fixed 20% behaviour.
  taxRatePercent: z.number().min(0).max(100).optional(),
})
export type PlaceOrderDTO = z.infer<typeof PlaceOrderInput>
export const UpdateOrderInput = z.object({ lines: z.array(OrderLineInput).min(1) })
export type UpdateOrderDTO = z.infer<typeof UpdateOrderInput>