/**
 * Parse CSV / XLSX uploads into row objects for import preview.
 */
import ExcelJS from "exceljs";
import { parse as parseCsvSync } from "csv-parse/sync";
import { IMPORT_MAX_ROWS, IMPORT_MAX_UPLOAD_BYTES } from "@shared/importLimits";

export type ParsedSheet = {
  headers: string[];
  rows: Record<string, string>[];
};

const ALLOWED_EXTENSIONS = [".csv", ".txt", ".xlsx", ".xls"] as const;

const ALLOWED_MIME_PREFIXES = [
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
] as const;

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("text" in value && value.text != null) return String(value.text).trim();
    if ("result" in value && value.result != null) return String(value.result).trim();
    if (value instanceof Date) return value.toISOString();
  }
  return String(value).trim();
}

function assertUploadLimits(buffer: Buffer, fileName: string): void {
  if (buffer.length > IMPORT_MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds ${IMPORT_MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
  }
  if (buffer.length === 0) {
    throw new Error("File is empty");
  }
  const lower = fileName.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new Error("Unsupported file type. Use CSV or XLSX.");
  }
}

export function assertSpreadsheetMime(mimeType?: string): void {
  if (!mimeType) return;
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!normalized) return;
  if (ALLOWED_MIME_PREFIXES.some((allowed) => normalized === allowed || normalized.startsWith(allowed))) {
    return;
  }
  throw new Error(`Unsupported MIME type: ${normalized}`);
}

export function parseCsv(content: string): ParsedSheet {
  const trimmed = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!trimmed) return { headers: [], rows: [] };

  const records = parseCsvSync(trimmed, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = Object.keys(records[0]);
  const rows = records.map((record) => {
    const row: Record<string, string> = {};
    for (const header of headers) {
      row[header] = record[header] ?? "";
    }
    return row;
  });
  return { headers, rows };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error("Could not read spreadsheet. The file may be corrupt or password-protected.");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers: string[] = [];
  const rows: Record<string, string>[] = [];

  sheet.eachRow((row, rowNumber) => {
    const cells = Array.from({ length: row.cellCount }, (_, i) =>
      cellToString(row.getCell(i + 1).value),
    );

    if (rowNumber === 1) {
      headers.push(...cells.map((cell, index) => cell || `column_${index + 1}`));
      return;
    }

    const mapped: Record<string, string> = {};
    headers.forEach((header, index) => {
      mapped[header] = cells[index] ?? "";
    });
    if (Object.values(mapped).some((value) => value.length > 0)) {
      rows.push(mapped);
    }
  });

  return { headers, rows };
}

function capRows(sheet: ParsedSheet): ParsedSheet {
  if (sheet.rows.length <= IMPORT_MAX_ROWS) return sheet;
  throw new Error(`Too many rows (max ${IMPORT_MAX_ROWS}). Split the file and import in batches.`);
}

export async function parseSpreadsheet(
  contentBase64: string,
  fileName: string,
  mimeType?: string,
): Promise<ParsedSheet> {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(contentBase64, "base64");
  } catch {
    throw new Error("Invalid file encoding");
  }

  assertUploadLimits(buffer, fileName);
  assertSpreadsheetMime(mimeType);

  const lower = fileName.toLowerCase();
  let sheet: ParsedSheet;

  try {
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      sheet = parseCsv(buffer.toString("utf8"));
    } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      sheet = await parseXlsx(buffer);
    } else {
      throw new Error("Unsupported file type. Use CSV or XLSX.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Too many rows")) throw error;
    if (error instanceof Error && error.message.includes("Unsupported")) throw error;
    if (error instanceof Error && error.message.includes("exceeds")) throw error;
    if (error instanceof Error && error.message.includes("empty")) throw error;
    if (error instanceof Error && error.message.includes("Could not read")) throw error;
    throw new Error("Failed to parse spreadsheet. Check the file format and try again.");
  }

  return capRows(sheet);
}

export function applyColumnMapping(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
): Record<string, string>[] {
  return rows.map((row) => {
    const mapped: Record<string, string> = {};
    for (const [targetField, sourceColumn] of Object.entries(mapping)) {
      if (sourceColumn && row[sourceColumn] !== undefined) {
        mapped[targetField] = row[sourceColumn];
      }
    }
    return mapped;
  });
}
