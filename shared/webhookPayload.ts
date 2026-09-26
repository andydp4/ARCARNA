/**
 * What an outbound webhook sends for each event (v1.2 Phase 5, CMP-14).
 *
 * The outbox payload is internal: it grows whenever a worker needs another
 * field, and it can carry things an integration has no business receiving
 * (a delivery address, a staff member's reason, a receipt-email switch).
 * So nothing is forwarded as-is: each event has an explicit list of fields,
 * copied one by one, and an event with no builder is not sent at all.
 * Customers appear by id only — never a name, phone, email or address.
 */

type Payload = Record<string, unknown>;

function obj(value: unknown): Payload {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Payload) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function orderLines(items: unknown): Array<{ productId: string | null; qty: number | null; unitPrice: number | null; lineTotal: number | null }> {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const item = obj(raw);
    return {
      productId: str(item.productId),
      qty: num(item.qty),
      unitPrice: num(item.unitPrice),
      lineTotal: num(item.lineTotal),
    };
  });
}

function orderSnapshot(payload: Payload) {
  const order = obj(payload.order);
  return {
    orderId: str(order.orderId),
    status: str(order.status),
    customerId: str(order.customerId),
    total: num(order.total),
    paymentMethod: str(order.paymentMethod),
    items: orderLines(order.items),
  };
}

function statusChange(payload: Payload) {
  return {
    orderId: str(payload.orderId),
    from: str(payload.from),
    to: str(payload.to),
    action: str(payload.action),
    changedAt: str(payload.changedAt),
  };
}

const BUILDERS: Record<string, (payload: Payload) => Payload> = {
  OrderCreated: orderSnapshot,
  OrderUpdated: orderSnapshot,
  OrderStatusChanged: statusChange,
  OrderStageChanged: (p) => ({ orderId: str(p.orderId), action: str(p.action), stage: str(p.kind) }),
  OrderCancelled: (p) => ({ orderId: str(p.orderId) ?? str(obj(p.order).orderId) }),
  PaymentCaptured: (p) => ({
    orderId: str(p.orderId) ?? str(obj(p.order).orderId),
    amount: num(p.amount),
    method: str(p.method),
  }),
  RefundIssued: (p) => ({
    refundId: str(p.refundId),
    orderId: str(p.orderId),
    total: num(p.total),
    method: str(p.method),
    lines: Array.isArray(p.lines)
      ? p.lines.map((raw) => {
          const line = obj(raw);
          return { productId: str(line.productId), qty: num(line.qty) };
        })
      : [],
  }),
  GiftCardIssued: (p) => ({ giftCardId: str(p.giftCardId), amount: num(p.amount), movementType: str(p.movementType) }),
  GiftCardRedeemed: (p) => ({
    giftCardId: str(p.giftCardId),
    orderId: str(p.orderId),
    amount: num(p.amount),
    balanceAfter: num(p.balanceAfter),
  }),
  // PersonalUseRecorded and the expense events are staff and bookkeeping
  // matters: not offered to integrations.
};

/** The event types an integration can subscribe to. */
export const WEBHOOK_EVENT_TYPES = Object.keys(BUILDERS);

/** The body's `payload` for one event, or null when the event is not sent to webhooks. */
export function webhookPayloadFor(eventType: string, payload: unknown): Payload | null {
  const build = BUILDERS[eventType];
  return build ? build(obj(payload)) : null;
}

/**
 * Where an event's org can be read straight from its payload. Most order
 * events carry only the order id; the sender looks the org up from that.
 */
export function orgIdInPayload(payload: unknown): string | null {
  const p = obj(payload);
  const order = obj(p.order);
  return str(p.orgId) ?? str(p.org_id) ?? str(order.orgId) ?? str(order.org_id);
}

/** The order an event is about, when it is about one. */
export function orderIdInPayload(payload: unknown): string | null {
  const p = obj(payload);
  return str(p.orderId) ?? str(obj(p.order).orderId);
}
