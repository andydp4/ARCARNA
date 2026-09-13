import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { ZReportView } from "@/components/ZReport";
import type { ZReportData } from "@shared/reports/zReport";

/**
 * The Z-report for a shift that is still running.
 *
 * Loaded on open rather than kept in cache: a cashier checking where they are
 * up to needs the figure as of now, and a stale one is exactly the problem
 * this is meant to solve.
 *
 * Extracted out of `pos.tsx` (Phase N, N6): the form no longer owns the
 * shift-so-far dialog — `OpsShiftControls` does, so this needs to be
 * importable from there too without pulling in the whole order form.
 */
export function ShiftSoFar({ shiftId }: { shiftId: string }) {
  const { data, isLoading, isError } = useQuery<{ report: ZReportData }>({
    queryKey: ["/api/shifts", shiftId, "report"],
    queryFn: async () => {
      const res = await apiFetch(`/api/shifts/${shiftId}/report`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the report");
      return res.json();
    },
    staleTime: 0,
    gcTime: 0,
  });

  if (isLoading) return <p className="text-sm text-metal-muted">Working out where you are up to…</p>;
  if (isError || !data?.report) {
    return <p className="text-sm text-destructive">Could not load your shift figures.</p>;
  }
  return <ZReportView report={data.report} />;
}
