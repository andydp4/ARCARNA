import { z } from 'zod'
export const OrderLineInput = z.object({ 
  productId: z.string().min(1), 
  quantity: z.number().int().positive().finite().refine(val => val > 0 && val < 10000, { message: "Quantity must be between 1 and 9999" }), 
  unitPrice: z.number().nonnegative().finite().refine(val => val >= 0 && val < 1000000, { message: "Price must be non-negative and less than 1,000,000" })
})
export const PlaceOrderInput = z.object({
  customerId: z.string().optional(),
  lines: z.array(OrderLineInput).min(1),
  paymentMethod: z.enum(['cash','card','transfer','tick','gift_card']),
  orgId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
})
export type PlaceOrderDTO = z.infer<typeof PlaceOrderInput>
export const UpdateOrderInput = z.object({ lines: z.array(OrderLineInput).min(1) })
export type UpdateOrderDTO = z.infer<typeof UpdateOrderInput>