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
  // 'split' is a label, not a tender: the route sets it when an order has 2+
  // distinct payment legs (each recorded separately in order_payments), never
  // a leg's own method. See shared/schema.ts's orderPayments doc comment.
  paymentMethod: z.enum(['cash','card','transfer','tick','gift_card','split']),
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
  channel: z.enum(['pos','web','api','whatsapp','phone']).default('pos'),
  status: z.enum(['pending','on-hold','awaiting-customer','urgent','completed']).optional(),
  // The calendar date the order is FOR, when that is not today: a missed day
  // being keyed in afterwards, or a pre-order. Declared so it survives parsing
  // (this object strips unknown keys); the route, not the engine, acts on it —
  // see server/services/orderDating.ts and shared/orders/orderDate.ts.
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // The promise made to the customer at the till, as MINUTES from now or as a
  // wall-clock time on the order's own date — never as an absolute instant
  // from the tablet, whose clock and timezone are not the shop's. The server
  // resolves both against the order's date in the org timezone and writes
  // `eta_given` (freezing `original_eta` with it).
  //
  // Declared here for the same reason `fulfilmentMethod` above says it is:
  // this is a plain z.object, so an undeclared key is STRIPPED in silence
  // rather than rejected. That is how the till sent a delivery for two months
  // and every one of them was stored as a collection. A field that is not in
  // this list does not reach the route, however carefully the form sends it.
  //
  // The ceiling matches the pre-order window (PREORDER_LIMIT_DAYS = 14 days,
  // shared/orders/orderDate.ts): a promise further out than an order may be
  // dated is a typo, not a promise.
  dueInMinutes: z.number().int().positive().max(60 * 24 * 14).optional(),
  /** 24-hour HH:MM on the order's trading date, e.g. "17:30". */
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Due time must be HH:MM (24-hour)').optional(),
  // Who is to deal with the order — the inputter's explicit choice at the till,
  // overriding the default-owner rule. The auth subject, like the attribution
  // columns; it is NOT a commission field (whoever completes earns the 90%).
  assignedUserId: z.string().min(1).max(255).optional(),
  // Costs incurred on this order (delivery fuel, packaging, a taxi). Inserted
  // as `order_expenses` rows inside the create transaction, on the path
  // personal use already takes. They are costs, never part of the order total:
  // commission is paid on profit, so an expense reduces the pool rather than
  // the price. Collected at checkout since U7 and silently dropped until now
  // (GAP-OPS-05) — precisely because they were not declared here.
  expenses: z
    .array(
      z.object({
        category: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        amount: z.number().nonnegative().finite().max(1000000),
      }),
    )
    .optional(),
})
export type PlaceOrderDTO = z.infer<typeof PlaceOrderInput>
export const UpdateOrderInput = z.object({ lines: z.array(OrderLineInput).min(1) })
export type UpdateOrderDTO = z.infer<typeof UpdateOrderInput>
