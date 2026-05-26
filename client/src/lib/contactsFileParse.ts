import { IMPORT_MAX_UPLOAD_BYTES, IMPORT_MAX_ROWS } from "@shared/importLimits";
import {
  customerRowsFromCsvText,
  customerRowsFromVcardText,
} from "@shared/customerImport";

export async function parseContactsFileToRows(
  file: File,
  defaultCategory: string,
): Promise<{ rows: Record<string, unknown>[]; source: "vcard" | "csv" }> {
  if (file.size > IMPORT_MAX_UPLOAD_BYTES) {
    const mb = IMPORT_MAX_UPLOAD_BYTES / (1024 * 1024);
    throw new Error(`File is too large (max ${mb} MB). Export fewer contacts or split the file.`);
  }

  const text = await file.text();

  if (/\.vcf$/i.test(file.name)) {
    const rows = customerRowsFromVcardText(text, defaultCategory);
    if (rows.length > IMPORT_MAX_ROWS) {
      throw new Error(`Too many contacts (max ${IMPORT_MAX_ROWS}). Export a smaller group.`);
    }
    return { rows, source: "vcard" };
  }

  if (/\.csv$/i.test(file.name)) {
    const rows = customerRowsFromCsvText(text, defaultCategory);
    if (rows.length > IMPORT_MAX_ROWS) {
      throw new Error(`Too many rows (max ${IMPORT_MAX_ROWS}). Split the CSV.`);
    }
    return { rows, source: "csv" };
  }

  throw new Error("Use a .vcf or .csv file.");
}
