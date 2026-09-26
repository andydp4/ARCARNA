/**
 * The one CSV writer every export uses (PRV-02, FIX-14; v1.2 Phase 5).
 *
 * - Every cell is quoted, so a comma, quote or line break in a name can never
 *   shift the columns.
 * - A text cell starting with = + - @ (or a tab / carriage return) is read by
 *   Excel and Sheets as a formula, so a customer named `=HYPERLINK(...)`
 *   becomes a live link on whoever opens the export. Such cells get a leading
 *   apostrophe, which spreadsheets treat as "this is text". Numbers are left
 *   alone so a refund of -5.00 stays a number.
 * - A whole file starts with the UTF-8 marker (BOM), so Excel reads £ and
 *   accented names correctly instead of guessing a Windows code page.
 *
 * Server and browser exporters both import this file; shared/csv.spec.ts
 * fails if a file that writes a CSV does not.
 */

/** The UTF-8 byte-order mark Excel needs to read a CSV as UTF-8. */
export const CSV_BOM = "﻿";

/** Line ending between rows: CRLF, as RFC 4180 and Excel expect. */
export const CSV_EOL = "\r\n";

const NUMBER = /^-?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value == null) return '""';
  let str = value instanceof Date ? value.toISOString() : String(value);
  const isNumber = typeof value === "number" || NUMBER.test(str);
  if (!isNumber && FORMULA_START.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

/** A whole CSV file: BOM, header row, data rows, CRLF line endings. */
export function csvDocument(header: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  return CSV_BOM + [header, ...rows].map(csvRow).join(CSV_EOL) + CSV_EOL;
}

/** Objects as a CSV file, columns in the given order or the first object's key order. */
export function csvFromRecords(records: readonly Record<string, unknown>[], columns?: readonly string[]): string {
  const keys = columns ?? (records.length > 0 ? Object.keys(records[0]) : []);
  return csvDocument(keys, records.map((r) => keys.map((k) => r[k])));
}
