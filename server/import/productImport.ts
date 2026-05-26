import type { Product } from "@shared/schema";
import {
  normalizeProductRow,
  previewProductImportFromMappedRows,
  type ProductImportPreview,
  type ProductImportPreviewRow,
} from "@shared/productImport";

export type { ProductImportPreview, ProductImportPreviewRow };

export function previewProductImport(
  mappedRows: Record<string, string>[],
  existingByProductId: Map<string, Product>,
  duplicateMode: "skip" | "overwrite" = "skip",
): ProductImportPreview {
  const existing = new Map(
    [...existingByProductId.entries()].map(([sku, p]) => [
      sku,
      { id: p.id, productId: p.productId, name: p.name },
    ]),
  );
  return previewProductImportFromMappedRows(mappedRows, existing, duplicateMode);
}

export { normalizeProductRow };
