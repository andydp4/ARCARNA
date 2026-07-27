/**
 * ReportFrame — the branded shell every Arcarna exportable report renders into.
 *
 * Implements ARC-RPT-SPEC-001 "Brand & Colour Standards":
 *  - Midnight Black cover banner with Truth Blue Dark accent.
 *  - Report name in Title Case; REF + frequency + export chips.
 *  - Truth Blue Light "what this report is for" tooltip callout.
 *  - Flag-colour legend so exported files are self-describing.
 *
 * It uses literal spec hex (via inline styles / reportBrand tokens) rather than
 * theme CSS variables so the rasterised PNG/JPEG/PDF carries the exact brand.
 * The frame is deliberately light ("paper") for print/export legibility.
 */
import { forwardRef, type ReactNode } from "react";
import { Info } from "lucide-react";
import { REPORT_COLORS, screenDate, type FlagLevel, FLAG_STYLE } from "@/lib/reportBrand";

export interface ReportFrameProps {
  /** Spec reference, e.g. "ARC-T1-001". */
  reportRef: string;
  /** Report name — Title Case, specific & action-oriented (spec copy rule). */
  title: string;
  /** DAILY / WEEKLY / MONTHLY / REAL-TIME. */
  frequency: string;
  /** One-sentence plain-English "what this report is for" (spec tooltip rule). */
  purpose: string;
  /** Tier badge text, e.g. "Tier 1". */
  tier?: string;
  /** Date range / as-of label shown under the title (already formatted or a Date). */
  periodLabel?: string;
  /** Flag levels this report can raise — renders the legend. */
  flagLegend?: { level: FlagLevel; meaning: string }[];
  /** Export toolbar (marked data-export-exclude, so it's stripped from captures). */
  toolbar?: ReactNode;
  /** The report body (KPIs, tables, charts). */
  children: ReactNode;
}

/**
 * The exportable node. Forwarded ref points at the outer branded container so
 * the export toolbar can rasterise exactly this element.
 */
export const ReportFrame = forwardRef<HTMLDivElement, ReportFrameProps>(function ReportFrame(
  { reportRef, title, frequency, purpose, tier, periodLabel, flagLegend, toolbar, children },
  ref,
) {
  return (
    <div
      ref={ref}
      data-report-ref={reportRef}
      style={{ backgroundColor: REPORT_COLORS.paper, color: REPORT_COLORS.steelGrey }}
      className="w-full overflow-hidden rounded-xl border border-black/10 shadow-sm"
    >
      {/* Cover banner — Midnight Black with Truth Blue Dark left rule. */}
      <div
        style={{
          backgroundColor: REPORT_COLORS.midnightBlack,
          borderLeft: `6px solid ${REPORT_COLORS.truthBlueDark}`,
        }}
        className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              style={{ backgroundColor: REPORT_COLORS.truthBlue, color: "#fff" }}
              className="rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide"
            >
              {reportRef}
            </span>
            {tier && (
              <span
                style={{ backgroundColor: REPORT_COLORS.truthBlueDark, color: "#fff" }}
                className="rounded px-2 py-0.5 text-[11px] font-semibold"
              >
                {tier}
              </span>
            )}
            <span style={{ color: REPORT_COLORS.smoke }} className="text-[11px] font-medium tracking-wide">
              {frequency}
            </span>
          </div>
          <h2 style={{ color: "#fff" }} className="mt-2 truncate text-xl font-bold leading-tight">
            {title}
          </h2>
          {periodLabel && (
            <p style={{ color: REPORT_COLORS.smoke }} className="mt-0.5 text-xs">
              {typeof periodLabel === "string" ? periodLabel : screenDate(periodLabel)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {toolbar}
          <div className="hidden text-right sm:block">
            <div style={{ color: "#fff" }} className="text-sm font-bold tracking-wide">
              ARCARNA
            </div>
            <div style={{ color: REPORT_COLORS.smoke }} className="text-[10px] tracking-wider">
              WM SUPPLIES
            </div>
          </div>
        </div>
      </div>

      {/* Purpose callout — Truth Blue Light. */}
      <div
        style={{ backgroundColor: REPORT_COLORS.truthBlueLight, color: REPORT_COLORS.truthBlueDark }}
        className="flex items-start gap-2 px-6 py-3 text-sm"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: REPORT_COLORS.truthBlue }} />
        <p className="leading-snug">{purpose}</p>
      </div>

      {/* Body. */}
      <div className="px-6 py-5">{children}</div>

      {/* Flag legend — makes exports self-describing. */}
      {flagLegend && flagLegend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-black/10 px-6 py-3">
          <span style={{ color: REPORT_COLORS.smoke }} className="text-[11px] font-semibold uppercase tracking-wide">
            Flags
          </span>
          {flagLegend.map((f) => (
            <span key={f.level} className="flex items-center gap-1.5 text-[11px]" style={{ color: REPORT_COLORS.steelGrey }}>
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: FLAG_STYLE[f.level].border }}
              />
              {f.meaning}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
