/**
 * Fetches an Arcarna report payload from GET /api/reports/:ref?from=&to=.
 * Shared by every report page so they all consume the same server engine.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";

export interface ReportPayload {
  ref: string;
  title: string;
  generatedAt: string;
  period: { from: string | null; to: string | null };
  summary: Record<string, number | string | null>;
  rows: Record<string, any>[];
  redFlags: string[];
}

export function useReport(ref: string, params?: { from?: string; to?: string }) {
  const search = new URLSearchParams();
  if (params?.from) search.set("from", params.from);
  if (params?.to) search.set("to", params.to);
  const qs = search.toString();

  return useQuery<ReportPayload>({
    queryKey: ["/api/reports", ref, params?.from ?? null, params?.to ?? null],
    queryFn: async () => {
      const response = await apiFetch(`/api/reports/${ref}${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `Failed to load ${ref}`);
      }
      return response.json();
    },
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
