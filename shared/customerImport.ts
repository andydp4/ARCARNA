import type { ZodError } from "zod";
import { customerImportRowSchema } from "./setup";
import type { Customer } from "./schema";
import { parseVcardFile, type ParsedVCard } from "./vcardParser";

export type CustomerImportPreviewRow = {
  rowIndex: number;
  data: Record<string, unknown>;
  errors: string[];
  duplicateOf?: { id: string; name: string; email?: string | null; phone?: string | null };
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
  source?: "spreadsheet" | "vcard" | "csv";
};

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  email: "email",
  phone: "phone",
  address: "address",
  category: "category",
};

export function normalizePhoneForMatch(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Match phones by full digits or trailing national number (e.g. +44 vs 07…). */
export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhoneForMatch(a);
  const nb = normalizePhoneForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tailLen = 9;
  if (na.length >= tailLen && nb.length >= tailLen) {
    return na.slice(-tailLen) === nb.slice(-tailLen);
  }
  return false;
}

export function formatCustomerImportErrors(zodError: ZodError): string[] {
  return zodError.errors.map((e) => {
    const key = String(e.path[0] ?? "row");
    const label = FIELD_LABELS[key] ?? key;
    return `Invalid ${label}: ${e.message}`;
  });
}

function canonicalCustomerFieldKey(header: string): string | null {
  const k = header.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const map: Record<string, string> = {
    name: "name",
    fullname: "name",
    customername: "name",
    firstname: "firstName",
    givenname: "firstName",
    lastname: "lastName",
    familyname: "lastName",
    surname: "lastName",
    email: "email",
    emailaddress: "email",
    mail: "email",
    phone: "phone",
    mobile: "phone",
    tel: "phone",
    telephone: "phone",
    cellphone: "phone",
    address: "address",
    street: "address",
    company: "company",
    organization: "company",
    org: "company",
    notes: "notes",
    note: "notes",
    category: "category",
    group: "category",
    customergroup: "category",
  };
  return map[k] ?? null;
}

export function flattenCustomerImportRow(raw: Record<string, string>): Record<string, string> {
  const flat: Record<string, string> = { ...raw };
  for (const [header, value] of Object.entries(raw)) {
    const canon = canonicalCustomerFieldKey(header);
    if (canon && value !== undefined && value !== "") {
      flat[canon] = value;
    }
  }
  return flat;
}

export function normalizeCustomerRow(
  raw: Record<string, string>,
  defaultCategory = "Bronze",
): Record<string, unknown> {
  const row = flattenCustomerImportRow(raw);
  const firstName = row.firstName ?? "";
  const lastName = row.lastName ?? "";
  const builtName =
    row.name ??
    row.Name ??
    row.customer_name ??
    [firstName, lastName].filter(Boolean).join(" ").trim();

  const company = row.company ?? "";
  const notes = row.notes ?? "";
  const addressParts = [row.address, company, notes].filter((p) => p && String(p).trim());

  return {
    name: builtName,
    email: row.email ?? row.Email ?? null,
    phone: row.phone ?? row.Phone ?? row.mobile ?? null,
    address: addressParts.length ? addressParts.join("\n\n") : null,
    category: row.category ?? row.Category ?? row.group ?? defaultCategory,
  };
}

export function vcardToCustomerRow(
  card: ParsedVCard,
  defaultCategory = "Bronze",
): Record<string, unknown> {
  const addressParts = [card.company, card.notes].filter((p) => p.trim());
  return {
    name: card.name,
    email: card.emails[0] ?? null,
    phone: card.phones[0] ?? null,
    address: addressParts.length ? addressParts.join("\n\n") : null,
    category: defaultCategory,
  };
}

export function findCustomerDuplicate(
  data: Record<string, unknown>,
  existing: Customer[],
): Customer | undefined {
  const email = String(data.email || "")
    .trim()
    .toLowerCase();
  if (email) {
    const byEmail = existing.find((c) => (c.email || "").toLowerCase() === email);
    if (byEmail) return byEmail;
  }

  const phone = String(data.phone || "");
  if (normalizePhoneForMatch(phone).length >= 7) {
    const byPhone = existing.find((c) => phonesMatch(phone, c.phone || ""));
    if (byPhone) return byPhone;
  }
  return undefined;
}

export function previewCustomerImportFromRows(
  importRows: Record<string, unknown>[],
  existing: Customer[],
  duplicateMode: "skip" | "merge" | "overwrite" = "skip",
  source?: CustomerImportPreview["source"],
): CustomerImportPreview {
  const rows: CustomerImportPreviewRow[] = [];
  let valid = 0;
  let invalid = 0;
  let duplicates = 0;

  importRows.forEach((data, idx) => {
    const parsed = customerImportRowSchema.safeParse(data);
    const errors: string[] = [];
    if (!parsed.success) {
      errors.push(...formatCustomerImportErrors(parsed.error));
    }

    const rowData = parsed.success ? (parsed.data as Record<string, unknown>) : data;
    const dup = findCustomerDuplicate(rowData, existing);
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
      data: rowData,
      errors,
      duplicateOf: dup
        ? { id: dup.id, name: dup.name, email: dup.email, phone: dup.phone }
        : undefined,
      action: errors.length ? "skip" : action,
    });
  });

  return {
    rows,
    summary: { total: importRows.length, valid, invalid, duplicates },
    source,
  };
}

export function previewCustomerImport(
  mappedRows: Record<string, string>[],
  existing: Customer[],
  duplicateMode: "skip" | "merge" | "overwrite" = "skip",
  defaultCategory = "Bronze",
): CustomerImportPreview {
  const importRows = mappedRows.map((raw) => normalizeCustomerRow(raw, defaultCategory));
  const source = mappedRows.length ? "spreadsheet" : "spreadsheet";
  return previewCustomerImportFromRows(importRows, existing, duplicateMode, source);
}

export function previewVcardCustomerImport(
  content: string,
  existing: Customer[],
  duplicateMode: "skip" | "merge" | "overwrite" = "skip",
  defaultCategory = "Bronze",
): CustomerImportPreview {
  const cards = parseVcardFile(content);
  const importRows = cards.map((c) => vcardToCustomerRow(c, defaultCategory));
  return previewCustomerImportFromRows(importRows, existing, duplicateMode, "vcard");
}
