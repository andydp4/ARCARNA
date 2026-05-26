/**
 * Parse numeric values from CSV/XLSX cells (strips £, $, commas, whitespace).
 * Used by import validation — templates must use raw numbers; imports accept formatted cells.
 */
export function parseImportNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  let s = String(value).trim();
  if (!s) return undefined;

  s = s.replace(/[£$€₹\s]/g, "").replace(/,/g, "");
  if (s.startsWith("(") && s.endsWith(")")) {
    s = `-${s.slice(1, -1)}`;
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

export function parseImportInteger(value: unknown): number | undefined {
  const n = parseImportNumber(value);
  if (n === undefined) return undefined;
  return Math.trunc(n);
}
