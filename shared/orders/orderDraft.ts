import { z } from "zod";

/** What the till remembers. No card numbers and no gift-card codes. */
export const orderDraftPayloadSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive().max(1_000_000_000),
        customPrice: z.number().nonnegative().max(1_000_000),
      }),
    )
    .max(200),
  customerId: z.string().uuid().nullable(),
  paymentMethod: z.string().max(50),
  personalUseReason: z.string().max(500),
  splitPayment: z.boolean(),
  tenderLegs: z.array(z.object({ method: z.string().max(50), amount: z.string().max(20) })).max(8),
  orderDate: z.string().max(10),
  fulfilmentMethod: z.enum(["collection", "delivery"]),
  delivery: z.object({
    address: z.string().max(500),
    postcode: z.string().max(20),
    notes: z.string().max(500),
    saveAsCustomerAddress: z.boolean(),
  }),
  deliveryFeeInput: z.string().max(20).nullable(),
  promoCode: z.string().max(50),
  redeemPoints: z.number().int().nonnegative().max(1_000_000),
  orderExpenses: z
    .array(
      z.object({
        category: z.string().max(100),
        description: z.string().max(500),
        amount: z.number().nonnegative(),
      }),
    )
    .max(20),
  emailReceipt: z.boolean(),
  channel: z.string().max(32),
  dueTime: z.string().max(8),
  dueMinutes: z.number().nullable(),
  dueTouched: z.boolean(),
  assigneeUserId: z.string().max(255),
  label: z.string().max(120),
});

export type OrderDraftPayload = z.infer<typeof orderDraftPayloadSchema>;
