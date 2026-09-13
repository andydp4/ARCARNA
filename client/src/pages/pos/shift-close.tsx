import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ZReportView } from "@/components/ZReport";
import type { ZReportData } from "@shared/reports/zReport";
import { useToast } from "@/hooks/use-toast";
import { setStoredShiftId } from "@/lib/shiftStorage";

const DENOMS = [
  { label: "£50", value: 50 },
  { label: "£20", value: 20 },
  { label: "£10", value: 10 },
  { label: "£5", value: 5 },
  { label: "£2", value: 2 },
  { label: "£1", value: 1 },
  { label: "50p", value: 0.5 },
  { label: "20p", value: 0.2 },
];

interface ShiftCloseWizardProps {
  open: boolean;
  shiftId: string;
  onClosed: () => void;
  onCancel: () => void;
}

/**
 * The cash-count-then-report wizard for closing a shift.
 *
 * An inline panel, not a `<Dialog>`: its only caller, `OpsShiftControls.tsx`,
 * renders in the Operations Centre's `headerExtras` slot so it stays reachable
 * while a phone cashier is on the "New order" tab — and that tab's own DoD
 * (Phase N, N6) is zero `role="dialog"` mounts, no exceptions. Nothing else in
 * the app uses this component, so it converts in place rather than gaining a
 * parallel non-dialog sibling; `open` still gates whether anything renders at
 * all, exactly as it gated the old `<Dialog>`.
 */
export function ShiftCloseWizard({
  open,
  shiftId,
  onClosed,
  onCancel,
}: ShiftCloseWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<"count" | "report">("count");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [manualTotal, setManualTotal] = useState("");
  const [report, setReport] = useState<ZReportData | null>(null);

  const denomTotal = useMemo(
    () =>
      DENOMS.reduce((sum, d) => sum + (counts[d.label] ?? 0) * d.value, 0),
    [counts],
  );

  const closingCount =
    manualTotal.trim() !== ""
      ? parseFloat(manualTotal) || 0
      : Math.round(denomTotal * 100) / 100;

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/shifts/${shiftId}/close`, {
        closingCount,
        notes: notes.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: (data: { report?: ZReportData }) => {
      setStoredShiftId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/shifts/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      if (data.report) {
        setReport(data.report);
        setStep("report");
      } else {
        toast({ title: "Shift closed" });
        onClosed();
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Could not close shift",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (!open) return null;

  return (
    <div
      className="w-full max-w-lg space-y-3 rounded-lg border border-border bg-card p-3 max-h-[90dvh] overflow-y-auto"
      data-testid="shift-close-panel"
    >
      {step === "count" ? (
        <>
          <div>
            <h3 className="text-sm font-medium text-foreground">Close shift</h3>
            <p className="text-sm text-muted-foreground">
              Count cash in the drawer (denominations or enter a total).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 py-2">
            {DENOMS.map((d) => (
              <div key={d.label} className="flex items-center gap-2">
                <Label className="w-10 shrink-0 text-xs">{d.label}</Label>
                <Input
                  type="number"
                  min={0}
                  className="h-8"
                  value={counts[d.label] ?? ""}
                  onChange={(e) =>
                    setCounts((c) => ({
                      ...c,
                      [d.label]: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Or total counted (£)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={manualTotal}
              onChange={(e) => setManualTotal(e.target.value)}
              placeholder={denomTotal > 0 ? String(denomTotal.toFixed(2)) : ""}
            />
            <p className="text-sm text-muted-foreground">
              Counted: £{closingCount.toFixed(2)}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onCancel} data-testid="button-shift-close-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => closeMutation.mutate()}
              disabled={closeMutation.isPending}
              data-testid="button-shift-close-confirm"
            >
              Confirm close
            </Button>
          </div>
        </>
      ) : (
        <>
          {report && <ZReportView report={report} />}
          <div className="flex justify-end">
            <Button onClick={onClosed} data-testid="button-shift-close-done">Done</Button>
          </div>
        </>
      )}
    </div>
  );
}
