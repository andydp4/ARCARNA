/**
 * Shared, brand-exact building blocks for Arcarna reports.
 * Key figures render in Truth Blue (#1A56DB) per the spec's "Truth Blue?" column.
 */
import type { ReactNode } from "react";
import { REPORT_COLORS, type FlagLevel, FLAG_STYLE, orDash } from "@/lib/reportBrand";
import { Skeleton } from "@/components/ui/skeleton";

/** A headline KPI. `keyInfo` renders the value in Truth Blue (spec: "any number the user acts on"). */
export function ReportKpi({
  label,
  value,
  sub,
  keyInfo = false,
  flag,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  keyInfo?: boolean;
  flag?: FlagLevel;
}) {
  const valueColor = keyInfo ? REPORT_COLORS.truthBlue : REPORT_COLORS.steelGrey;
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: flag ? FLAG_STYLE[flag].border : "rgba(0,0,0,0.08)",
        backgroundColor: flag ? FLAG_STYLE[flag].bg : "#fff",
      }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: REPORT_COLORS.smoke }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold leading-tight" style={{ color: valueColor }}>
        {value}
      </div>
      {sub != null && (
        <div className="mt-0.5 text-xs" style={{ color: REPORT_COLORS.smoke }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * ARC-032: while a report's first fetch is still in flight, the KPI tiles
 * used to render real-looking "£0.00 / 0" values — indistinguishable from a
 * genuinely quiet trading day, and exactly the kind of number a business
 * owner glancing at "£0.00 revenue today" would reasonably panic over.
 * Render this instead whenever `isLoading && !data`; swap back to the real
 * `ReportKpi` grid the instant real data (or a real error) arrives. Reuses
 * the same `Skeleton` primitive already used elsewhere in the app (e.g.
 * ControlCentreToday) rather than inventing a new loading treatment.
 */
export function ReportKpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="status" aria-label="Loading report figures">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border p-4" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Action-oriented flag badge (spec: tell the user what to do). */
export function FlagBadge({ level, children }: { level: FlagLevel; children: ReactNode }) {
  const s = FLAG_STYLE[level];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: s.fg, backgroundColor: s.bg, border: `1px solid ${s.border}` }}
    >
      {children}
    </span>
  );
}

export interface ReportColumn<T> {
  /** Column header — Title Case, 1–3 words (spec). */
  header: string;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  /** Render this column's values in Truth Blue (spec "Truth Blue? ★ Key Info"). */
  keyInfo?: boolean;
  align?: "left" | "right" | "center";
}

/**
 * Branded table: Truth Blue Dark header row, steel-grey body, zebra rows.
 *
 * ARC-054 / ARC-034: these report tables can run 6-9 columns, which is
 * unreadable on a ~390px phone even with the horizontal scroll below. Below
 * `md:` we swap to one card per row — same column config, no bespoke layout
 * per report — matching the convention in `client/src/components/ui/responsive-table.tsx`.
 */
export function ReportTable<T>({
  columns,
  rows,
  rowFlag,
  empty = "No data for this period.",
  getRowKey,
}: {
  columns: ReportColumn<T>[];
  rows: T[];
  /** Optional per-row tint from a flag level. */
  rowFlag?: (row: T) => FlagLevel | undefined;
  empty?: string;
  getRowKey?: (row: T, i: number) => string;
}) {
  if (!rows.length) {
    return (
      <div
        className="rounded-lg border border-dashed p-8 text-center text-sm"
        style={{ color: REPORT_COLORS.smoke, borderColor: "rgba(0,0,0,0.12)" }}
      >
        {empty}
      </div>
    );
  }

  const cellValue = (c: ReportColumn<T>, row: T) => {
    const v = c.cell(row);
    return v === null || v === undefined || v === "" ? orDash(null) : v;
  };

  return (
    <>
      {/* Desktop / tablet: the full table, still horizontally scrollable as a fallback. */}
      <div className="hidden overflow-x-auto rounded-lg border md:block" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: REPORT_COLORS.truthBlueDark }}>
              {columns.map((c, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap px-3 py-2 text-[12px] font-semibold uppercase tracking-wide"
                  style={{ color: "#fff", textAlign: c.align ?? (i === 0 ? "left" : "right") }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const flag = rowFlag?.(row);
              return (
                <tr
                  key={getRowKey ? getRowKey(row, ri) : ri}
                  style={{
                    backgroundColor: flag ? FLAG_STYLE[flag].bg : ri % 2 ? "#F9FAFB" : "#fff",
                  }}
                >
                  {columns.map((c, ci) => (
                    <td
                      key={ci}
                      className="whitespace-nowrap px-3 py-2"
                      style={{
                        color: c.keyInfo ? REPORT_COLORS.truthBlue : REPORT_COLORS.steelGrey,
                        fontWeight: c.keyInfo ? 600 : 400,
                        textAlign: c.align ?? (ci === 0 ? "left" : "right"),
                      }}
                    >
                      {cellValue(c, row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone: one card per row — first column as the title, the rest as label:value lines. */}
      <div className="space-y-2 md:hidden">
        {rows.map((row, ri) => {
          const flag = rowFlag?.(row);
          const [titleCol, ...restCols] = columns;
          return (
            <div
              key={getRowKey ? getRowKey(row, ri) : ri}
              className="rounded-lg border p-3 text-sm"
              style={{
                borderColor: flag ? FLAG_STYLE[flag].border : "rgba(0,0,0,0.08)",
                backgroundColor: flag ? FLAG_STYLE[flag].bg : "#fff",
              }}
            >
              {titleCol && (
                <div
                  className="mb-1.5 font-semibold"
                  style={{ color: titleCol.keyInfo ? REPORT_COLORS.truthBlue : REPORT_COLORS.steelGrey }}
                >
                  {cellValue(titleCol, row)}
                </div>
              )}
              <div className="space-y-1">
                {restCols.map((c, ci) => (
                  <div key={ci} className="flex items-baseline justify-between gap-3">
                    <span className="shrink-0 text-[11px] uppercase tracking-wide" style={{ color: REPORT_COLORS.smoke }}>
                      {c.header}
                    </span>
                    <span
                      className="min-w-0 text-right"
                      style={{
                        color: c.keyInfo ? REPORT_COLORS.truthBlue : REPORT_COLORS.steelGrey,
                        fontWeight: c.keyInfo ? 600 : 400,
                      }}
                    >
                      {cellValue(c, row)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
