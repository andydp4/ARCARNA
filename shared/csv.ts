/**
 * One CSV cell, safe to open in a spreadsheet (PRV-02).
 *
 * A value starting with = + - @ (or a tab / carriage return) is read by
 * Excel and Sheets as a formula, so a customer named `=HYPERLINK(...)`
 * becomes a live link on whoever opens the export. Such cells get a leading
 * apostrophe, which spreadsheets treat as "this is text". Numbers are left
 * alone so a refund of -5.00 stays a number.
 */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  let str = value instanceof Date ? value.toISOString() : String(value);
  const isNumber = typeof value === "number" || /^-?\d+(\.\d+)?$/.test(str);
  if (!isNumber && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}
