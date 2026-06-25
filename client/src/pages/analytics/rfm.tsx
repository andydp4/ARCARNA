import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch, resolveApiUrl } from "@/lib/appPaths";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RfmHeatmap } from "@/components/charts/RfmHeatmap";
import { RFM_SEGMENTS, type RfmSegment } from "@shared/analytics/rfm";
import { Skeleton } from "@/components/Skeleton";
import { Download, RefreshCw, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SEGMENT_COLORS: Record<RfmSegment, string> = {
  Champions: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Loyal: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  Promising: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "At-Risk": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Lost: "bg-red-500/15 text-red-700 dark:text-red-300",
  New: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
};

type RfmSummary = {
  segments: Record<RfmSegment, number>;
  heatmap: Array<{ r: number; f: number; count: number; avgMonetary: number }>;
  computedAt: string | null;
  totalCustomers: number;
};

export default function RfmAnalyticsPage() {
  const { toast } = useToast();
  const [selectedSegment, setSelectedSegment] = useState<RfmSegment>("Champions");

  const { data: summary, isLoading } = useQuery<RfmSummary>({
    queryKey: ["/api/analytics/rfm"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/rfm", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load RFM");
      return res.json();
    },
  });

  const { data: segmentData, isLoading: segmentLoading } = useQuery({
    queryKey: ["/api/analytics/rfm/customers", selectedSegment],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/analytics/rfm/customers?segment=${encodeURIComponent(selectedSegment)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load segment");
      return res.json();
    },
    enabled: !!selectedSegment,
  });

  const recompute = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/analytics/rfm/recompute", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Recompute failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/rfm"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/rfm/customers"] });
      toast({ title: "RFM updated", description: `${data.customersScored} customers scored.` });
    },
    onError: () => {
      toast({ title: "Recompute failed", variant: "destructive" });
    },
  });

  const handleExport = () => {
    window.open(
      resolveApiUrl(`/api/analytics/rfm/export?segment=${encodeURIComponent(selectedSegment)}`),
      "_blank",
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton variant="card" count={3} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <PageHeader
            className="!mb-0"
            title="Customer segments (RFM)"
            question="Which customers are loyal, at risk, or lost?"
            explanation="Recency, frequency, and monetary scores — updated nightly."
          />
          {summary?.computedAt && (
            <p className="text-metal-muted text-xs mt-1">
              Last run {new Date(summary.computedAt).toLocaleString()}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
          <RefreshCw className={`h-4 w-4 mr-2 ${recompute.isPending ? "animate-spin" : ""}`} />
          Recompute now
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {RFM_SEGMENTS.map((seg) => (
          <Card
            key={seg}
            className={`cursor-pointer transition-shadow hover:shadow-md ${selectedSegment === seg ? "ring-2 ring-primary" : ""}`}
            onClick={() => setSelectedSegment(seg)}
          >
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium">{seg}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold">{summary?.segments[seg] ?? 0}</div>
              <Badge variant="secondary" className={`mt-2 text-xs ${SEGMENT_COLORS[seg]}`}>
                <Users className="h-3 w-3 mr-1" />
                customers
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">R × F heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <RfmHeatmap cells={summary?.heatmap ?? []} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{selectedSegment} customers</CardTitle>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          {segmentLoading ? (
            <Skeleton variant="row" count={5} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>R</TableHead>
                  <TableHead>F</TableHead>
                  <TableHead>M</TableHead>
                  <TableHead className="text-right">Total spent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(segmentData?.customers ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No customers in this segment yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  segmentData.customers.map((c: any) => (
                    <TableRow key={c.customerId}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.email || "—"}</TableCell>
                      <TableCell>{c.recencyScore}</TableCell>
                      <TableCell>{c.frequencyScore}</TableCell>
                      <TableCell>{c.monetaryScore}</TableCell>
                      <TableCell className="text-right">
                        £{parseFloat(String(c.totalSpent || 0)).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
