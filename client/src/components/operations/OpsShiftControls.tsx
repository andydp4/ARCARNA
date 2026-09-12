/**
 * Shift housekeeping for the Operations Centre — "Z-report so far", "Close
 * shift" and "Dashboard", moved out of the order form (Phase N, N6).
 *
 * Before N6 these lived in `pos.tsx`'s own page header. Once the form is
 * embedded beside the board it has none (the brief's "Form embedding": "no
 * PageHeader"), and the board's own header (`OpsHeader.tsx`) is explicitly
 * out of this package's scope to touch — so this renders in `operations.tsx`'s
 * new `headerExtras` slot instead, a persistent strip above both the two-pane
 * layout and the phone's tabs. That also means it stays reachable while a
 * phone cashier is on the "New order" tab, where the board (and its header)
 * is hidden — the one thing moving these buttons into `OpsHeader.tsx` itself
 * would not have achieved either.
 *
 * Reachable from that same "New order" tab means both actions below render
 * as inline expanding panels, not `<Dialog>`s: the tab's own DoD is zero
 * `role="dialog"` mounts, with no carve-out for controls that merely happen
 * to sit above it. "Z-report so far" expands `ShiftSoFar` in place; "Close
 * shift" expands `ShiftCloseWizard`, which converted the same way for the
 * same reason (see its own file).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Package, Receipt, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/appPaths";
import { getStoredShiftId, setStoredShiftId } from "@/lib/shiftStorage";
import { ShiftSoFar } from "@/pages/pos/shift-so-far";
import { ShiftCloseWizard } from "@/pages/pos/shift-close";

export function OpsShiftControls() {
  const [shiftId, setShiftId] = useState<string | null>(() => getStoredShiftId());
  const [zReportOpen, setZReportOpen] = useState(false);
  const [shiftCloseOpen, setShiftCloseOpen] = useState(false);

  const { data: currentShiftData, isLoading: shiftLoading } = useQuery<{
    shift: { id: string; status: string } | null;
  }>({
    queryKey: ["/api/shifts/current"],
    queryFn: async () => {
      const res = await apiFetch("/api/shifts/current", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load shift");
      return res.json();
    },
  });

  // The till no longer asks anybody to open a shift — one exists per person
  // per trading day and opens itself on the first sale (migration 058) — so
  // this only mirrors what the server already decided, exactly as pos.tsx
  // did before N6 moved these controls here.
  useEffect(() => {
    const serverShift = currentShiftData?.shift;
    if (serverShift?.id) {
      setShiftId(serverShift.id);
      setStoredShiftId(serverShift.id);
    } else if (!shiftLoading && currentShiftData && !serverShift) {
      setShiftId(null);
      setStoredShiftId(null);
    }
  }, [currentShiftData, shiftLoading]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {shiftId && (
          <>
            <Button
              variant="outline"
              size="touch"
              className="lm-btn-outline"
              onClick={() => {
                setShiftCloseOpen(false);
                setZReportOpen((open) => !open);
              }}
              data-testid="button-z-report-so-far"
            >
              <Receipt className="mr-2 h-4 w-4" aria-hidden />
              Z-report so far
            </Button>
            <Button
              variant="outline"
              size="touch"
              className="lm-btn-outline"
              onClick={() => {
                setZReportOpen(false);
                setShiftCloseOpen(true);
              }}
              data-testid="button-close-shift"
            >
              <Clock className="mr-2 h-4 w-4" aria-hidden />
              Close shift
            </Button>
          </>
        )}
        <Button asChild variant="outline" size="touch" className="lm-btn-outline" data-testid="link-dashboard">
          <Link href="/">
            <Package className="mr-2 h-4 w-4" aria-hidden />
            Dashboard
          </Link>
        </Button>
      </div>

      {/* Where you are up to, without closing anything. Fetched fresh each
          time it opens rather than cached (ShiftSoFar), because a stale
          figure is the whole problem this screen is meant to solve. Inline,
          not a `<Dialog>` — see this file's module comment. */}
      {shiftId && zReportOpen && (
        <div
          className="w-full max-w-2xl space-y-3 rounded-lg border border-border bg-card p-3 max-h-[85dvh] overflow-y-auto"
          data-testid="ops-z-report-panel"
        >
          <div>
            <h3 className="text-sm font-medium text-foreground">Your shift so far</h3>
            <p className="text-sm text-muted-foreground">
              Everything you have taken since the shift began. Nothing is closed by looking.
            </p>
          </div>
          <ShiftSoFar shiftId={shiftId} />
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setZReportOpen(false)} data-testid="button-z-report-close">
              Close
            </Button>
          </div>
        </div>
      )}

      {shiftId && (
        <ShiftCloseWizard
          open={shiftCloseOpen}
          shiftId={shiftId}
          onClosed={() => {
            // Closing the drawer no longer prompts to open another. The next
            // sale opens one by itself, on whatever trading day it falls in.
            setShiftCloseOpen(false);
            setShiftId(null);
            setStoredShiftId(null);
          }}
          onCancel={() => setShiftCloseOpen(false)}
        />
      )}
    </div>
  );
}
