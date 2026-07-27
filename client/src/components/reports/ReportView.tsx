/**
 * Config-driven report page body: back link, branded ReportFrame, KPI grid,
 * table, export toolbar, and loading/error states. Keeps individual report
 * pages to a small declarative config.
 */
import { useRef, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";
import { ReportFrame } from "./ReportFrame";
import { ReportExportToolbar } from "./ReportExportToolbar";
import { ReportKpi, ReportTable, type ReportColumn } from "./ReportPrimitives";
import { useReport, type ReportPayload } from "@/hooks/useReport";
import { reportByRef } from "@/lib/reportCatalog";
import type { FlagLevel } from "@/lib/reportBrand";
import type { CsvColumn } from "@/lib/reportExport";

export interface KpiDef {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  keyInfo?: boolean;
  flag?: FlagLevel;
}

export interface ReportViewConfig<T> {
  reportRef: string;
  params?: { from?: string; to?: string };
  /** Header period label from the payload. */
  periodLabel?: (data: ReportPayload | undefined) => string;
  kpis: (summary: Record<string, any>) => KpiDef[];
  columns: ReportColumn<T>[];
  csvColumns: CsvColumn<T>[];
  rowFlag?: (row: T) => FlagLevel | undefined;
  flagLegend?: { level: FlagLevel; meaning: string }[];
  tableHeading?: string;
  emptyText?: string;
  maxWidth?: string;
  /** Optional controls (e.g. a date picker) rendered above the frame. */
  controls?: ReactNode;
}

export function ReportView<T>({ config }: { config: ReportViewConfig<T> }) {
  const meta = reportByRef(config.reportRef)!;
  const frameRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, error } = useReport(config.reportRef, config.params);

  const summary = data?.summary ?? {};
  const rows = (data?.rows ?? []) as T[];
  const kpis = config.kpis(summary);
  const csv = { rows, columns: config.csvColumns };

  return (
    <div className={`mx-auto ${config.maxWidth ?? "max-w-5xl"} px-4 py-6`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> All reports
        </Link>
        {config.controls}
      </div>

      <ReportFrame
        ref={frameRef}
        reportRef={meta.ref}
        title={meta.title}
        tier={`Tier ${meta.tier}`}
        frequency={meta.frequency}
        purpose={meta.purpose}
        periodLabel={config.periodLabel?.(data)}
        toolbar={<ReportExportToolbar targetRef={frameRef} reportRef={meta.ref} csv={csv} />}
        flagLegend={config.flagLegend}
      >
        {error ? (
          <p className="text-sm" style={{ color: "#DC2626" }}>
            {(error as Error).message}. Check the date range.
          </p>
        ) : (
          <>
            {kpis.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {kpis.map((k, i) => (
                  <ReportKpi key={i} label={k.label} value={k.value} sub={k.sub} keyInfo={k.keyInfo} flag={k.flag} />
                ))}
              </div>
            )}
            <div className="mt-5">
              {config.tableHeading && (
                <h3 className="mb-2 text-sm font-semibold" style={{ color: "#1E3A8A" }}>
                  {config.tableHeading}
                </h3>
              )}
              <ReportTable
                columns={config.columns}
                rows={rows}
                rowFlag={config.rowFlag}
                empty={isLoading ? "Loading…" : config.emptyText ?? "No data for this period."}
              />
            </div>
          </>
        )}
      </ReportFrame>
    </div>
  );
}
