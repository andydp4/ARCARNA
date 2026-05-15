import { productImportRowSchema } from "@shared/setup";
import type { Product } from "@shared/schema";

export type ProductImportPreviewRow = {
  rowIndex: number;
  data: Record<string, unknown>;
  errors: string[];
  duplicateOf?: { id: string; productId: string; name: string };
  action: "insert" | "skip" | "overwrite";
};

export type ProductImportPreview = {
  rows: ProductImportPreviewRow[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
  };
};

function normalizeProductRow(raw: Record<string, string>): Record<string, unknown> {
  return {
    name: raw.name ?? raw.Name ?? raw.product_name ?? "",
    productId: raw.productId ?? raw.product_id ?? raw.sku ?? raw.SKU ?? "",
    barcode: raw.barcode ?? raw.Barcode ?? null,
    defaultSalePrice:
      raw.defaultSalePrice ?? raw.sale_price ?? raw.price ?? raw.Price ?? "",
    costPrice: raw.costPrice ?? raw.cost_price ?? raw.cost ?? "",
    stock: raw.stock ?? raw.Stock ?? "0",
    stockLimit: raw.stockLimit ?? raw.stock_limit ?? "100",
  };
}

export function previewProductImport(
  mappedRows: Record<string, string>[],
  existingByProductId: Map<string, Product>,
  duplicateMode: "skip" | "overwrite" = "skip",
): ProductImportPreview {
  const rows: ProductImportPreviewRow[] = [];
  let valid = 0;
  let invalid = 0;
  let duplicates = 0;

  mappedRows.forEach((raw, idx) => {
    const data = normalizeProductRow(raw);
    const parsed = productImportRowSchema.safeParse(data);
    const errors: string[] = [];
    if (!parsed.success) {
      parsed.error.errors.forEach((e) => errors.push(e.message));
    }

    const existing = data.productId
      ? existingByProductId.get(String(data.productId).trim())
      : undefined;

    let action: "insert" | "skip" | "overwrite" = "insert";
    if (existing) {
      duplicates++;
      action = duplicateMode === "overwrite" ? "overwrite" : "skip";
    }

    if (errors.length) invalid++;
    else valid++;

    rows.push({
      rowIndex: idx + 1,
      data,
      errors,
      duplicateOf: existing
        ? { id: existing.id, productId: existing.productId, name: existing.name }
        : undefined,
      action: errors.length ? "skip" : action,
    });
  });

  return {
    rows,
    summary: { total: mappedRows.length, valid, invalid, duplicates },
  };
}
