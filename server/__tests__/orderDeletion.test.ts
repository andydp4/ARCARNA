import { describe, expect, it } from "vitest";
import {
  getUnrefundedRestockLines,
  orderDeletionMovementEventId,
} from "../services/orderDeletion";

describe("order deletion invariants", () => {
  it("restocks only unrefunded quantities per order line", () => {
    const restockLines = getUnrefundedRestockLines(
      [
        { id: "line-1", productId: "product-1", quantity: 5 },
        { id: "line-2", productId: "product-2", quantity: 3 },
        { id: "line-3", productId: null, quantity: 7 },
      ],
      [
        { orderLineId: "line-1", qty: 2 },
        { orderLineId: "line-2", qty: 3 },
      ],
    );

    expect(restockLines).toEqual([{ productId: "product-1", quantity: 3 }]);
  });

  it("uses the order UUID as the inventory movement event id", () => {
    const orderId = "123e4567-e89b-12d3-a456-426614174000";

    expect(orderDeletionMovementEventId(orderId)).toBe(orderId);
    expect(orderDeletionMovementEventId(orderId)).toHaveLength(36);
  });
});
