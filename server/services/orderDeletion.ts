export type OrderItemForDeletion = {
  id: string;
  productId: string | null;
  quantity: number;
};

export type RefundLineForDeletion = {
  orderLineId: string;
  qty: number;
};

export type RestockLine = {
  productId: string;
  quantity: number;
};

export function getUnrefundedRestockLines(
  items: OrderItemForDeletion[],
  refundLines: RefundLineForDeletion[],
): RestockLine[] {
  const refundedByLine = new Map<string, number>();
  for (const line of refundLines) {
    refundedByLine.set(line.orderLineId, (refundedByLine.get(line.orderLineId) ?? 0) + line.qty);
  }

  return items.flatMap((item) => {
    if (!item.productId) return [];
    const quantity = item.quantity - (refundedByLine.get(item.id) ?? 0);
    return quantity > 0 ? [{ productId: item.productId, quantity }] : [];
  });
}

export function orderDeletionMovementEventId(orderId: string): string {
  return orderId;
}

export class OrderDeleteConflictError extends Error {
  status = 409;

  constructor(message: string) {
    super(message);
    this.name = "OrderDeleteConflictError";
  }
}
