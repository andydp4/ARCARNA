import {
  parseNonNegativeQuantityInput,
  parseQuantityInput,
} from "@shared/quantity";

export type ReceiptQuantityInputs = Record<
  string,
  { received?: string; damaged?: string }
>;

export type ReceivableItem = {
  id: string;
  productId: string;
};

export type GoodsReceiptItemInput = {
  purchaseDraftItemId: string;
  productId: string;
  quantityReceived: number;
  quantityDamaged: number;
};

export function buildGoodsReceiptItems(
  items: ReceivableItem[],
  quantities: ReceiptQuantityInputs,
): GoodsReceiptItemInput[] {
  return items.flatMap((item) => {
    const raw = quantities[item.id];
    const received = parseQuantityInput(raw?.received ?? "");
    if (received == null) return [];

    return [
      {
        purchaseDraftItemId: item.id,
        productId: item.productId,
        quantityReceived: received,
        quantityDamaged: parseNonNegativeQuantityInput(raw?.damaged ?? "") ?? 0,
      },
    ];
  });
}
