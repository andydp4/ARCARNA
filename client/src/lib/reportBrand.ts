/**
 * Arcarna Exportable Reports — brand & colour standard.
 *
 * Source of truth: ARC-RPT-SPEC-001 "Brand & Colour Standards For All Reports".
 * These are the EXACT hex codes from the spec. They are intentionally kept as
 * literal hex (not CSS `var()`) because report exports are rasterised to
 * PNG/JPEG and drawn into PDF, where computed CSS variables are not reliably
 * resolved — the saved file must carry the same brand as the screen.
 *
 * Every report (on screen and when exported) must use these tokens.
 */

/** The spec palette — name → hex, with its documented role. */
export const REPORT_COLORS = {
  /** Primary key info: headline figures, margin %, KPIs — anything the user acts on. */
  truthBlue: "#1A56DB",
  /** Report headers, section titles, table column headers. */
  truthBlueDark: "#1E3A8A",
  /** Tooltip backgrounds, info panels, "what this means" callouts. */
  truthBlueLight: "#DBEAFE",
  /** Report covers, banner headers, dark section backgrounds. */
  midnightBlack: "#0D1117",
  /** Alerts / highlights: warning states, flags needing attention, premium accents. */
  gold: "#C9A84C",
  /** Positive flags: healthy margin, on-target KPI, payment received, stock OK. */
  green: "#16A34A",
  /** Watch flags: approaching threshold, moderate risk, monitor required. */
  amber: "#D97706",
  /** Critical flags: below threshold, overdue, critical stock, KPI failure. */
  red: "#DC2626",
  /** Standard body copy, field values, table cell text. */
  steelGrey: "#374151",
  /** Secondary text: labels, subtitles, supplementary info, dates. */
  smoke: "#6B7280",
  /** Page/card surface behind report content when exported (kept light for print). */
  paper: "#FFFFFF",
} as const;

export type ReportColorName = keyof typeof REPORT_COLORS;

/** Flag levels used across report flag/alert logic. */
export type FlagLevel = "green" | "blue" | "amber" | "red" | "gold";

/** Maps a flag level to its foreground/background pair for badges & row tints. */
export const FLAG_STYLE: Record<
  FlagLevel,
  { label: string; fg: string; bg: string; border: string }
> = {
  green: { label: "OK", fg: REPORT_COLORS.green, bg: "#DCFCE7", border: "#16A34A" },
  blue: { label: "Info", fg: REPORT_COLORS.truthBlue, bg: REPORT_COLORS.truthBlueLight, border: "#1A56DB" },
  amber: { label: "Watch", fg: REPORT_COLORS.amber, bg: "#FEF3C7", border: "#D97706" },
  red: { label: "Critical", fg: REPORT_COLORS.red, bg: "#FEE2E2", border: "#DC2626" },
  gold: { label: "Priority", fg: "#7A5C12", bg: "#FBF3D9", border: REPORT_COLORS.gold },
};

/**
 * Copy & tone helpers (spec "Copy & Tone Standards").
 * Money uses £ prefix; rates use % suffix; time in days. Never blank cells.
 */

/** Format money as £1,234.56. Null/undefined → "£0.00" (never blank). */
export function money(value: number | null | undefined): string {
  const n = typeof value === "number" && isFinite(value) ? value : 0;
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format a signed money delta, e.g. "+£120.00" / "−£40.00". */
export function moneyDelta(value: number | null | undefined): string {
  const n = typeof value === "number" && isFinite(value) ? value : 0;
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${money(Math.abs(n))}`;
}

/** Format a rate as "98.0%". Null/undefined → "0.0%". */
export function pct(value: number | null | undefined, dp = 1): string {
  const n = typeof value === "number" && isFinite(value) ? value : 0;
  return `${n.toFixed(dp)}%`;
}

/** Integer with thousands separators; null/undefined → "0". */
export function int(value: number | null | undefined): string {
  const n = typeof value === "number" && isFinite(value) ? Math.round(value) : 0;
  return n.toLocaleString("en-GB");
}

/** Screen date: DD/MM/YYYY (spec). */
export function screenDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

/** CSV / file date: ISO 8601 YYYY-MM-DD (spec). */
export function isoDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/** Empty-state cell: never blank. Use "—" for no data. */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
