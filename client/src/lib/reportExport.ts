/**
 * Report export — PNG / JPEG / PDF / CSV.
 *
 * "Follow the brand on screen AND when saved off it" (ARC-RPT-SPEC-001):
 * PNG/JPEG/PDF are produced by rasterising the *rendered, branded* report node,
 * so the saved file is pixel-identical to what the user sees. CSV is raw data
 * with ISO-8601 dates and UTF-8 encoding per the Export Format Specification.
 *
 * File name convention (spec): ARC-[REPORT-REF]-[YYYY-MM-DD].[ext]
 */
import { toPng, toJpeg } from "html-to-image";
import { jsPDF } from "jspdf";
import { REPORT_COLORS, isoDate } from "./reportBrand";

export type ExportFormat = "png" | "jpeg" | "pdf" | "csv";

/** Build the spec filename: ARC-T1-001-2025-07-04.pdf */
export function reportFileName(reportRef: string, ext: string, date: Date = new Date()): string {
  const ref = reportRef.replace(/^ARC-/i, "").toUpperCase();
  return `ARC-${ref}-${isoDate(date)}.${ext}`;
}

function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Shared html-to-image options: white paper background, crisp 2× raster. */
function rasterOptions(node: HTMLElement) {
  return {
    backgroundColor: REPORT_COLORS.paper,
    pixelRatio: 2,
    cacheBust: true,
    // Skip elements explicitly marked as non-exportable (e.g. the toolbar itself).
    filter: (el: HTMLElement) => !(el?.dataset?.exportExclude === "true"),
    width: node.scrollWidth,
    height: node.scrollHeight,
    style: { margin: "0" },
  };
}

/** Export a report node as PNG. */
export async function exportNodePng(node: HTMLElement, reportRef: string): Promise<void> {
  const dataUrl = await toPng(node, rasterOptions(node));
  triggerDownload(dataUrl, reportFileName(reportRef, "png"));
}

/** Export a report node as JPEG (white background, quality 0.95). */
export async function exportNodeJpeg(node: HTMLElement, reportRef: string): Promise<void> {
  const dataUrl = await toJpeg(node, { ...rasterOptions(node), quality: 0.95 });
  triggerDownload(dataUrl, reportFileName(reportRef, "jpeg"));
}

/**
 * Export a report node as PDF. Rasterises the branded node, then places it on
 * an A4 page (portrait/landscape chosen by aspect ratio), splitting across
 * pages when the report is taller than one page.
 */
export async function exportNodePdf(node: HTMLElement, reportRef: string): Promise<void> {
  const dataUrl = await toPng(node, rasterOptions(node));
  const imgW = node.scrollWidth;
  const imgH = node.scrollHeight;
  const orientation = imgW >= imgH ? "landscape" : "portrait";

  const pdf = new jsPDF({ orientation, unit: "pt", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const availW = pageW - margin * 2;

  // Scale the capture to the printable width; height follows aspect ratio.
  const scale = availW / imgW;
  const renderH = imgH * scale;
  const availH = pageH - margin * 2;

  if (renderH <= availH) {
    pdf.addImage(dataUrl, "PNG", margin, margin, availW, renderH, undefined, "FAST");
  } else {
    // Tall report: slice the image across pages by shifting the y-offset.
    let remaining = renderH;
    let position = margin;
    let page = 0;
    while (remaining > 0) {
      if (page > 0) {
        pdf.addPage();
        position = margin - page * availH;
      }
      pdf.addImage(dataUrl, "PNG", margin, position, availW, renderH, undefined, "FAST");
      remaining -= availH;
      page += 1;
      // Mask the overflow above/below the page with white margins so slices are clean.
      if (remaining > 0) {
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, pageH - margin, pageW, margin, "F");
        pdf.rect(0, 0, pageW, margin, "F");
      }
    }
  }
  triggerBlobDownload(pdf.output("blob"), reportFileName(reportRef, "pdf"));
}

/** A CSV column: header (Title Case per spec) + accessor from a row. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build + download a CSV (UTF-8 with BOM for Excel). ISO dates should already
 * be formatted by the caller via `isoDate()` inside the column accessor.
 */
export function exportCsv<T>(rows: T[], columns: CsvColumn<T>[], reportRef: string): void {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(",")).join("\n");
  const csv = `﻿${head}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerBlobDownload(blob, reportFileName(reportRef, "csv"));
}

export { isoDate };
