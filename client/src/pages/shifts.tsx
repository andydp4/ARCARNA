import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { AppPageHeader } from "@/components/app-page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ZReportView } from "@/components/ZReport";
import type { ZReportData } from "@shared/reports/zReport";

interface ShiftRow {
  id: string;
  userId: string;
  locationId: string;
  status: string;
  openingFloat: string;
  closingCount: string | null;
  variance: string | null;
  openedAt: string;
  closedAt: string | null;
}

export default function ShiftsPage() {
  const [reportShiftId, setReportShiftId] = useState<string | null>(null);

  const { data: shifts = [], isLoading } = useQuery<ShiftRow[]>({
    queryKey: ["/api/shifts"],
    queryFn: async () => {
      const res = await apiFetch("/api/shifts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load shifts");
      return res.json();
    },
  });

  const { data: reportData } = useQuery<{ report: ZReportData }>({
    queryKey: ["/api/shifts", reportShiftId, "report"],
    queryFn: async () => {
      const res = await apiFetch(`/api/shifts/${reportShiftId}/report`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
    enabled: !!reportShiftId,
  });

  return (
    <div className="space-y-6">
      <AppPageHeader
        title="Shifts"
        description="Today's shifts, cash variances, and Z-reports"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : shifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shifts today.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opened</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Float</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell>
                      {new Date(shift.openedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={shift.status === "open" ? "default" : "secondary"}>
                        {shift.status}
                      </Badge>
                    </TableCell>
                    <TableCell>£{parseFloat(shift.openingFloat).toFixed(2)}</TableCell>
                    <TableCell>
                      {shift.variance != null
                        ? `£${parseFloat(shift.variance).toFixed(2)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setReportShiftId(shift.id)}
                      >
                        Z-report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reportShiftId} onOpenChange={(v) => !v && setReportShiftId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Z-Report</DialogTitle>
          </DialogHeader>
          {reportData?.report ? (
            <ZReportView report={reportData.report} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading report…</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
