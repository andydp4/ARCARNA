import { z } from 'zod'
export const OrderLineInput = z.object({ productId: z.string(), quantity: z.number().int().positive(), unitPrice: z.number().nonnegative() })
export const PlaceOrderInput = z.object({ customerId: z.string().optional(), lines: z.array(OrderLineInput).min(1), paymentMethod: z.enum(['cash','card','transfer','tick']) })
export type PlaceOrderDTO = z.infer<typeof PlaceOrderInput>