import { customerImportRowSchema } from "@shared/setup";
import type { Customer } from "@shared/schema";

export type CustomerImportPreviewRow = {
  rowIndex: number;
  data: Record<string, unknown>;
  errors: string[];
  duplicateOf?: { id: string; name: string; email?: string | null };
  action: "insert" | "skip" | "merge" | "overwrite";
};

export type CustomerImportPreview = {
  rows: CustomerImportPreviewRow[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
  };
};

function normalizeCustomerRow(raw: Record<string, string>): Record<string, unknown> {
  return {
    name: raw.name ?? raw.Name ?? raw.customer_name ?? "",
    email: raw.email ?? raw.Email ?? null,
    phone: raw.phone ?? raw.Phone ?? raw.mobile ?? null,
    address: raw.address ?? raw.Address ?? null,
    category: raw.category ?? raw.Category ?? "Bronze",
  };
}

export function findCustomerDuplicate(
  data: Record<string, unknown>,
  existing: Customer[],
): Customer | undefined {
  const email = String(data.email || "").trim().toLowerCase();
  const phone = String(data.phone || "").trim();
  if (email) {
    const byEmail = existing.find((c) => (c.email || "").toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  if (phone) {
    const byPhone = existing.find((c) => (c.phone || "").trim() === phone);
    if (byPhone) return byPhone;
  }
  return undefined;
}

export function previewCustomerImport(
  mappedRows: Record<string, string>[],
  existing: Customer[],
  duplicateMode: "skip" | "merge" | "overwrite" = "skip",
): CustomerImportPreview {
  const rows: CustomerImportPreviewRow[] = [];
  let valid = 0;
  let invalid = 0;
  let duplicates = 0;

  mappedRows.forEach((raw, idx) => {
    const data = normalizeCustomerRow(raw);
    const parsed = customerImportRowSchema.safeParse(data);
    const errors: string[] = [];
    if (!parsed.success) {
      parsed.error.errors.forEach((e) => errors.push(e.message));
    }

    const dup = findCustomerDuplicate(data, existing);
    let action: CustomerImportPreviewRow["action"] = "insert";
    if (dup) {
      duplicates++;
      if (duplicateMode === "overwrite") action = "overwrite";
      else if (duplicateMode === "merge") action = "merge";
      else action = "skip";
    }

    if (errors.length) invalid++;
    else valid++;

    rows.push({
      rowIndex: idx + 1,
      data,
      errors,
      duplicateOf: dup ? { id: dup.id, name: dup.name, email: dup.email } : undefined,
      action: errors.length ? "skip" : action,
    });
  });

  return {
    rows,
    summary: { total: mappedRows.length, valid, invalid, duplicates },
  };
}
