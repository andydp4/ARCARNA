/**
 * The rota as a real PDF — drawn from the grid data, not rasterised off the
 * screen.
 *
 * The first print/PDF of the rota printed the page itself: a dark card, light
 * text, a 14-day table clipped at the paper edge (Friday and Saturday fell off
 * an A4 landscape page), and a blank second sheet. A rota is a sheet for the
 * staff-room wall and for WhatsApp, so it is drawn here as vector text on white
 * paper: every day always fits across the page, staff rows run onto further
 * pages with the header repeated, and the file is small and searchable.
 */
import { jsPDF } from "jspdf";

export interface RotaPdfShift {
  startTime: string;
  endTime: string;
}

export interface RotaPdfDay {
  date: string;
  status: "working" | "off" | "unscheduled";
  startTime: string | null;
  endTime: string | null;
  shifts?: RotaPdfShift[];
}

export interface RotaPdfPerson {
  name: string;
  days: RotaPdfDay[];
}

export interface RotaPdfGrid {
  dates: string[];
  people: RotaPdfPerson[];
  headcountByDate: Record<string, number>;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "2026-10-05" → "5/10", the same short form the on-screen grid uses. */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d}/${m}`;
}

/**
 * The text lines for one cell. Plain hyphens rather than en dashes: the PDF's
 * built-in Helvetica has no guaranteed glyph for U+2013, and a missing glyph
 * prints as a box on some viewers.
 */
export function rotaCellLines(day: RotaPdfDay): string[] {
  if (day.status === "off") return ["Off"];
  if (day.status !== "working") return [];
  const shifts = day.shifts && day.shifts.length > 0
    ? day.shifts
    : day.startTime && day.endTime
      ? [{ startTime: day.startTime, endTime: day.endTime }]
      : [];
  return shifts.map((s) => `${s.startTime}-${s.endTime}`);
}

export function rotaPdfFileName(grid: Pick<RotaPdfGrid, "dates">): string {
  const first = grid.dates[0] ?? "rota";
  return `rota-${first}.pdf`;
}

export interface BuildRotaPdfOptions {
  orgName?: string | null;
  /** When the sheet was produced; printed in the corner so an old copy on the wall is recognisable. */
  generatedAt: Date;
  /** Off in tests so the text can be read back; on for real files. */
  compress?: boolean;
}

const PAGE = { margin: 28, nameColWidth: 104, headerHeight: 34, lineHeight: 9, cellPadY: 5, minRowHeight: 20, footer: 18 };
type Rgb = readonly [number, number, number];
const INK: Record<"text" | "muted" | "rule", Rgb> = { text: [20, 20, 20], muted: [110, 110, 110], rule: [170, 170, 170] };
const FILL: Record<"working" | "off" | "header", Rgb> = { working: [226, 243, 230], off: [251, 229, 226], header: [240, 240, 240] };

function stamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Largest font size (from `start` down to `min`) at which every line fits `width`. */
function fitFontSize(pdf: jsPDF, lines: string[], width: number, start: number, min: number): number {
  for (let size = start; size > min; size -= 0.25) {
    pdf.setFontSize(size);
    if (lines.every((l) => pdf.getTextWidth(l) <= width)) return size;
  }
  return min;
}

export function buildRotaPdf(grid: RotaPdfGrid, opts: BuildRotaPdfOptions): jsPDF {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: opts.compress ?? true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const left = PAGE.margin;
  const tableW = pageW - PAGE.margin * 2;
  const dayCount = Math.max(grid.dates.length, 1);
  const dayColW = (tableW - PAGE.nameColWidth) / dayCount;

  // One cell font size for the whole sheet — the size at which the longest
  // shift text fits a day column — so the columns read evenly.
  const allCellLines = grid.people.flatMap((p) => p.days.flatMap(rotaCellLines));
  pdf.setFont("helvetica", "normal");
  const cellFont = fitFontSize(pdf, allCellLines.length ? allCellLines : ["00:00-00:00"], dayColW - 6, 8, 5);

  const drawTitle = () => {
    pdf.setTextColor(...INK.text);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Rota", left, PAGE.margin + 12);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...INK.muted);
    const range = grid.dates.length ? `${shortDate(grid.dates[0])} - ${shortDate(grid.dates[grid.dates.length - 1])}` : "";
    const sub = [opts.orgName, range].filter(Boolean).join("  ·  ");
    if (sub) pdf.text(sub, left, PAGE.margin + 26);
    pdf.text(`Printed ${stamp(opts.generatedAt)}`, pageW - PAGE.margin, PAGE.margin + 12, { align: "right" });
    return PAGE.margin + 36;
  };

  const drawHeaderRow = (y: number) => {
    pdf.setFillColor(...FILL.header);
    pdf.rect(left, y, tableW, PAGE.headerHeight, "F");
    pdf.setTextColor(...INK.muted);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("Staff", left + 4, y + 20);
    grid.dates.forEach((date, i) => {
      const cx = left + PAGE.nameColWidth + dayColW * i + dayColW / 2;
      pdf.setTextColor(...INK.text);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.text(DAY_LABELS[dow(date)], cx, y + 11, { align: "center" });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.setTextColor(...INK.muted);
      pdf.text(shortDate(date), cx, y + 20, { align: "center" });
      pdf.text(`${grid.headcountByDate[date] ?? 0} on`, cx, y + 29, { align: "center" });
    });
    pdf.setDrawColor(...INK.rule);
    pdf.setLineWidth(0.5);
    pdf.rect(left, y, tableW, PAGE.headerHeight, "S");
    return y + PAGE.headerHeight;
  };

  let y = drawHeaderRow(drawTitle());
  const bottom = pageH - PAGE.margin - PAGE.footer;

  for (const person of grid.people) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    const nameLines = pdf.splitTextToSize(person.name, PAGE.nameColWidth - 8).slice(0, 2) as string[];
    const cellLines = person.days.map(rotaCellLines);
    const maxLines = Math.max(nameLines.length, ...cellLines.map((l) => l.length), 1);
    const rowH = Math.max(PAGE.minRowHeight, maxLines * PAGE.lineHeight + PAGE.cellPadY * 2);

    if (y + rowH > bottom) {
      pdf.addPage();
      y = drawHeaderRow(PAGE.margin);
    }

    person.days.forEach((day, i) => {
      const x = left + PAGE.nameColWidth + dayColW * i;
      const fill: Rgb | null = day.status === "working" ? FILL.working : day.status === "off" ? FILL.off : null;
      if (fill) {
        pdf.setFillColor(fill[0], fill[1], fill[2]);
        pdf.rect(x, y, dayColW, rowH, "F");
      }
      const lines = cellLines[i];
      if (lines.length) {
        pdf.setTextColor(...INK.text);
        pdf.setFont("helvetica", day.status === "off" ? "bold" : "normal");
        pdf.setFontSize(cellFont);
        const top = y + (rowH - lines.length * PAGE.lineHeight) / 2 + PAGE.lineHeight - 2;
        lines.forEach((line, j) => pdf.text(line, x + dayColW / 2, top + j * PAGE.lineHeight, { align: "center" }));
      }
    });

    pdf.setTextColor(...INK.text);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    const nameTop = y + (rowH - nameLines.length * PAGE.lineHeight) / 2 + PAGE.lineHeight - 2;
    nameLines.forEach((line, j) => pdf.text(line, left + 4, nameTop + j * PAGE.lineHeight));

    pdf.setDrawColor(...INK.rule);
    pdf.setLineWidth(0.5);
    pdf.rect(left, y, tableW, rowH, "S");
    for (let i = 0; i <= dayCount; i++) {
      const x = left + PAGE.nameColWidth + dayColW * i;
      pdf.line(x, y, x, y + rowH);
    }
    y += rowH;
  }

  if (grid.people.length === 0) {
    pdf.setTextColor(...INK.muted);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text("Nobody on the roster yet.", left + 4, y + 16);
  }

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setTextColor(...INK.muted);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(`arcarna  ·  page ${p} of ${pages}`, pageW - PAGE.margin, pageH - PAGE.margin + 4, { align: "right" });
  }
  return pdf;
}

export function downloadRotaPdf(pdf: jsPDF, fileName: string): void {
  pdf.save(fileName);
}

/**
 * Hand the PDF to the device's share sheet (WhatsApp, email, AirDrop …) where
 * the browser can share files; otherwise report "unsupported" so the caller
 * can fall back to a download.
 */
export async function shareRotaPdf(pdf: jsPDF, fileName: string, title: string): Promise<"shared" | "cancelled" | "unsupported"> {
  const file = new File([pdf.output("blob")], fileName, { type: "application/pdf" });
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (!nav?.share || !nav.canShare?.({ files: [file] })) return "unsupported";
  try {
    await nav.share({ files: [file], title });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    throw error;
  }
}

/** Whether this browser can share a PDF file at all — used to decide whether to show the Share action. */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare || typeof File === "undefined") return false;
  try {
    return navigator.canShare({ files: [new File([""], "rota.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}
