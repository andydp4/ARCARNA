import type { ZodError } from "zod";
import { productImportRowSchema } from "./setup";

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

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  productId: "product ID",
  barcode: "barcode",
  defaultSalePrice: "sale price",
  costPrice: "cost price",
  stock: "stock",
  stockLimit: "stock limit",
};

/** Normalize spreadsheet header labels to canonical import field keys. */
function canonicalProductFieldKey(header: string): string | null {
  const k = header.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const map: Record<string, string> = {
    name: "name",
    productname: "name",
    product: "name",
    barcode: "barcode",
    ean: "barcode",
    upc: "barcode",
    costprice: "costPrice",
    cost: "costPrice",
    unitcost: "costPrice",
    saleprice: "defaultSalePrice",
    defaultsaleprice: "defaultSalePrice",
    price: "defaultSalePrice",
    sellprice: "defaultSalePrice",
    retailprice: "defaultSalePrice",
    productid: "productId",
    sku: "productId",
    id: "productId",
    stock: "stock",
    initialstock: "stock",
    openingstock: "stock",
    qty: "stock",
    quantity: "stock",
    stocklimit: "stockLimit",
    maxstock: "stockLimit",
    reorderlevel: "stockLimit",
    minstock: "stockLimit",
  };
  return map[k] ?? null;
}

export function matchProductImportHeader(header: string, fieldKey: string): boolean {
  return canonicalProductFieldKey(header) === fieldKey;
}

/** Flatten row keys like "Sale Price" / "Product ID" into canonical camelCase fields. */
export function flattenProductImportRow(raw: Record<string, string>): Record<string, string> {
  const flat: Record<string, string> = { ...raw };
  for (const [header, value] of Object.entries(raw)) {
    const canon = canonicalProductFieldKey(header);
    if (canon && value !== undefined && value !== "") {
      flat[canon] = value;
    }
  }
  return flat;
}

export function normalizeProductRow(raw: Record<string, string>): Record<string, unknown> {
  const row = flattenProductImportRow(raw);
  return {
    name: row.name ?? row.Name ?? row.product_name ?? "",
    productId: row.productId ?? row.product_id ?? row.sku ?? row.SKU ?? "",
    barcode: row.barcode ?? row.Barcode ?? null,
    defaultSalePrice:
      row.defaultSalePrice ??
      row.sale_price ??
      row.salePrice ??
      row.price ??
      row.Price ??
      "",
    costPrice: row.costPrice ?? row.cost_price ?? row.cost ?? row.tax ?? "",
    stock: row.stock ?? row.Stock ?? row.initialStock ?? "0",
    stockLimit: row.stockLimit ?? row.stock_limit ?? "100",
  };
}

export function formatProductImportErrors(zodError: ZodError): string[] {
  return zodError.errors.map((e) => {
    const key = String(e.path[0] ?? "row");
    const label = FIELD_LABELS[key] ?? key;
    return `Invalid ${label}: ${e.message}`;
  });
}

/** Parse CSV text (comma-separated, no quoted-field edge cases) into mapped rows. */
export function parseProductCsvText(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

export function previewProductImportFromMappedRows(
  mappedRows: Record<string, string>[],
  existingByProductId?: Map<string, { id: string; productId: string; name: string }>,
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
      errors.push(...formatProductImportErrors(parsed.error));
    }

    const sku = data.productId ? String(data.productId).trim() : "";
    const existing = sku && existingByProductId ? existingByProductId.get(sku) : undefined;

    let action: "insert" | "skip" | "overwrite" = "insert";
    if (existing) {
      duplicates++;
      action = duplicateMode === "overwrite" ? "overwrite" : "skip";
    }

    if (errors.length) invalid++;
    else valid++;

    rows.push({
      rowIndex: idx + 1,
      data: parsed.success ? (parsed.data as Record<string, unknown>) : data,
      errors,
      duplicateOf: existing,
      action: errors.length ? "skip" : action,
    });
  });

  return {
    rows,
    summary: { total: mappedRows.length, valid, invalid, duplicates },
  };
}
