import type { PosProduct } from "@/components/pos-product-card";

export interface PosOrderLine {
  product: PosProduct;
  quantity: number;
  customPrice: number;
  subtotal: number;
  priceInput?: string;
  quantityInput?: string;
}

export function priceOf(product: PosProduct): number {
  const raw = product.defaultSalePrice;
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  return Number.isFinite(n) ? Number(n) : 0;
}

export function makeLine(product: PosProduct): PosOrderLine {
  const price = priceOf(product);
  return { product, quantity: 1, customPrice: price, subtotal: price };
}

export function updateOrderLine(
  lines: PosOrderLine[],
  index: number,
  patch: Partial<PosOrderLine>,
): PosOrderLine[] {
  return lines.map((line, i) => {
    if (i !== index) return line;
    const merged = { ...line, ...patch };
    return { ...merged, subtotal: merged.quantity * merged.customPrice };
  });
}

export function addProductToOrderLines(
  lines: PosOrderLine[],
  product: PosProduct,
): PosOrderLine[] {
  const existing = lines.findIndex((line) => line.product.id === product.id);
  if (existing >= 0) {
    return updateOrderLine(lines, existing, {
      quantity: lines[existing].quantity + 1,
      quantityInput: undefined,
    });
  }
  return [...lines, makeLine(product)];
}

export function selectProductForOrderLine(
  lines: PosOrderLine[],
  index: number,
  product: PosProduct,
): PosOrderLine[] {
  const current = lines[index];
  if (!current) return addProductToOrderLines(lines, product);

  const existing = lines.findIndex((line, i) => i !== index && line.product.id === product.id);
  if (existing >= 0) {
    const next = [...lines];
    next[existing] = {
      ...next[existing],
      quantity: next[existing].quantity + current.quantity,
      quantityInput: undefined,
      subtotal: (next[existing].quantity + current.quantity) * next[existing].customPrice,
    };
    next.splice(index, 1);
    return next;
  }

  return updateOrderLine(lines, index, {
    product,
    customPrice: priceOf(product),
    priceInput: undefined,
  });
}
