import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/appPaths";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResponsiveTable, ResponsiveCardRow } from "@/components/ui/responsive-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ZReportView } from "@/components/ZReport";
import type { ZReportData } from "@shared/reports/zReport";
import { cn } from "@/lib/utils";
import { MoreVertical, UserRound } from "lucide-react";

interface ShiftRow {
  id: string;
  userId: string;
  /** Resolved server-side: full name, else email, else the id. */
  userName: string;
  locationId: string;
  locationName: string | null;
  status: string;
  openingFloat: string;
  closingCount: string | null;
  expectedCash: string | null;
  variance: string | null;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
}

/**
 * How far back the list looks. 48 hours is the default because the question
 * this page answers — who was on — is usually asked about last night, and a
 * "today" window answers it with an empty table any time after midnight.
 */
const WINDOWS = [
  { value: "24", label: "Last 24 hours" },
  { value: "48", label: "Last 48 hours" },
  { value: "168", label: "Last 7 days" },
] as const;

const DEFAULT_WINDOW = "48";
const ACTIVE_SHIFT_STATUSES = new Set(["open", "reopened"]);

/**
 * ARC-011: the Control Centre's "drawer not counted" signal points here, but
 * until this page had these actions there was nothing to click — closing or
 * reopening someone else's till lived only on the server
 * (`POST /api/shifts/:id/close` and `/reopen`, both already `requireRole`d to
 * MANAGER+). Mirrored client-side rather than trusting a 403 to hide the
 * button, same as the rest of this app's role-gated row actions.
 */
const MANAGER_PLUS_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MANAGER"]);

function money(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = parseFloat(value);
  return Number.isFinite(n) ? `£${n.toFixed(2)}` : "—";
}

/** "4h 20m" — long enough to be read at a glance, short enough for a cell. */
function duration(fromIso: string, toIso: string | null): string {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return "—";
  const minutes = Math.floor((to - from) / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

/**
 * A variance is a number an owner acts on, so it carries a sign and a word.
 * Colour repeats that; it never has to carry it alone.
 */
function VarianceCell({ value }: { value: string | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return <span className="text-muted-foreground">—</span>;
  if (Math.abs(n) < 0.005) return <span className="tabular-nums">Balanced</span>;
  return (
    <span className={cn("tabular-nums", n < 0 ? "text-red-400" : "text-amber-400")}>
      {n < 0 ? `£${Math.abs(n).toFixed(2)} short` : `£${n.toFixed(2)} over`}
    </span>
  );
}

export default function ShiftsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canManageShifts = MANAGER_PLUS_ROLES.has(user?.role ?? "");

  const [reportShiftId, setReportShiftId] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState<string>(DEFAULT_WINDOW);
  const [closeTarget, setCloseTarget] = useState<ShiftRow | null>(null);
  const [closingCount, setClosingCount] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [reopenTarget, setReopenTarget] = useState<ShiftRow | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  const { data: shifts = [], isLoading } = useQuery<ShiftRow[]>({
    queryKey: ["/api/shifts", { hours: windowHours }],
    queryFn: async () => {
      const res = await apiFetch(`/api/shifts?hours=${windowHours}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load shifts");
      return res.json();
    },
    // Someone is on the till right now; a stale "on now" panel is worse than none.
    refetchInterval: 60_000,
  });

  const invalidateShifts = () => queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });

  const closeMutation = useMutation({
    mutationFn: async ({ id, closingCount, notes }: { id: string; closingCount: number; notes: string }) => {
      const res = await apiRequest("POST", `/api/shifts/${id}/close`, {
        closingCount,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Shift closed" });
      setCloseTarget(null);
      setClosingCount("");
      setCloseNotes("");
      invalidateShifts();
    },
    onError: (error: Error) => {
      toast({ title: "Could not close shift", description: error.message, variant: "destructive" });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/shifts/${id}/reopen`, { reason });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Shift reopened" });
      setReopenTarget(null);
      setReopenReason("");
      invalidateShifts();
    },
    onError: (error: Error) => {
      toast({ title: "Could not reopen shift", description: error.message, variant: "destructive" });
    },
  });

  const openShifts = useMemo(
    () => shifts.filter((shift) => ACTIVE_SHIFT_STATUSES.has(shift.status)),
    [shifts],
  );

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

  const windowLabel =
    WINDOWS.find((w) => w.value === windowHours)?.label.toLowerCase() ?? "window";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shifts"
        question="Who was on, and did the till balance?"
        explanation="Who is on now, who was on recently, and how each till counted."
        action={
          <Select value={windowHours} onValueChange={setWindowHours}>
            <SelectTrigger
              className="min-h-[44px] w-full sm:w-[12rem]"
              aria-label="How far back to show shifts"
              data-testid="select-shift-window"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  data-testid={`shift-window-${option.value}`}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* On now is the first thing asked and was the one thing the page never
          said. Open shifts are listed here whatever the window, because someone
          who started before it began is still on. */}
      <Card data-testid="card-on-now">
        <CardHeader>
          <CardTitle className="text-base">On now</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : openShifts.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-nobody-on">
              Nobody is on. No till is open.
            </p>
          ) : (
            <ul className="space-y-2">
              {openShifts.map((shift) => (
                <li
                  key={shift.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                  data-testid={`on-now-${shift.id}`}
                >
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{shift.userName}</span>
                  {shift.locationName && (
                    <span className="text-muted-foreground">{shift.locationName}</span>
                  )}
                  <span className="text-muted-foreground">
                    on since {when(shift.openedAt)} · {duration(shift.openedAt, null)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {WINDOWS.find((w) => w.value === windowHours)?.label ?? "Recent shifts"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : shifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shifts in the {windowLabel}. Try a longer window.
            </p>
          ) : (
            <ResponsiveTable
              rows={shifts}
              getRowKey={(shift) => shift.id}
              head={
                <TableRow>
                  <TableHead>Who</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>On for</TableHead>
                  <TableHead className="text-right">Float</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              }
              renderCard={(shift) => (
                <Card data-testid={`shift-card-${shift.id}`}>
                  <CardContent className="pt-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{shift.userName}</p>
                        <p className="text-sm text-muted-foreground">
                          {shift.locationName ?? "—"}
                        </p>
                      </div>
                      <Badge variant={shift.status === "open" ? "default" : "secondary"}>
                        {shift.status}
                      </Badge>
                    </div>
                    <div className="space-y-1 border-t pt-2">
                      <ResponsiveCardRow label="Opened">{when(shift.openedAt)}</ResponsiveCardRow>
                      <ResponsiveCardRow label="Closed">{when(shift.closedAt)}</ResponsiveCardRow>
                      <ResponsiveCardRow label="On for">
                        <span className="tabular-nums">{duration(shift.openedAt, shift.closedAt)}</span>
                      </ResponsiveCardRow>
                      <ResponsiveCardRow label="Float">
                        <span className="tabular-nums">{money(shift.openingFloat)}</span>
                      </ResponsiveCardRow>
                      <ResponsiveCardRow label="Counted">
                        <span className="tabular-nums">{money(shift.closingCount)}</span>
                      </ResponsiveCardRow>
                      <ResponsiveCardRow label="Variance">
                        <VarianceCell value={shift.variance} />
                      </ResponsiveCardRow>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-[44px] flex-1"
                        onClick={() => setReportShiftId(shift.id)}
                        aria-label={`Z-report for ${shift.userName}'s shift opened ${when(shift.openedAt)}`}
                      >
                        Z-report
                      </Button>
                      {/* ARC-011: the only way to act on "drawer not counted"
                          used to be this page's Z-report button — there was
                          no Close or Reopen at all. MANAGER+ only, and only
                          when the shift's own status makes the action valid
                          (mirrors the server: close needs open/reopened,
                          reopen needs closed). */}
                      {canManageShifts && (ACTIVE_SHIFT_STATUSES.has(shift.status) || shift.status === "closed") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-[44px] px-2"
                              aria-label={`More actions for ${shift.userName}'s shift`}
                              data-testid={`shift-actions-${shift.id}`}
                            >
                              <MoreVertical className="h-4 w-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {ACTIVE_SHIFT_STATUSES.has(shift.status) && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setClosingCount("");
                                  setCloseNotes("");
                                  setCloseTarget(shift);
                                }}
                                data-testid={`shift-close-${shift.id}`}
                              >
                                Close shift…
                              </DropdownMenuItem>
                            )}
                            {shift.status === "closed" && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setReopenReason("");
                                  setReopenTarget(shift);
                                }}
                                data-testid={`shift-reopen-${shift.id}`}
                              >
                                Reopen shift…
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            >
              {shifts.map((shift) => (
                <TableRow key={shift.id} data-testid={`shift-row-${shift.id}`}>
                  <TableCell className="font-medium">{shift.userName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {shift.locationName ?? "—"}
                  </TableCell>
                  <TableCell>{when(shift.openedAt)}</TableCell>
                  <TableCell>{when(shift.closedAt)}</TableCell>
                  <TableCell className="tabular-nums">
                    {duration(shift.openedAt, shift.closedAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(shift.openingFloat)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(shift.closingCount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <VarianceCell value={shift.variance} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={shift.status === "open" ? "default" : "secondary"}>
                      {shift.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-[44px]"
                        onClick={() => setReportShiftId(shift.id)}
                        aria-label={`Z-report for ${shift.userName}'s shift opened ${when(shift.openedAt)}`}
                      >
                        Z-report
                      </Button>
                      {canManageShifts && (ACTIVE_SHIFT_STATUSES.has(shift.status) || shift.status === "closed") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-[44px] px-2"
                              aria-label={`More actions for ${shift.userName}'s shift`}
                              data-testid={`shift-actions-${shift.id}`}
                            >
                              <MoreVertical className="h-4 w-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {ACTIVE_SHIFT_STATUSES.has(shift.status) && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setClosingCount("");
                                  setCloseNotes("");
                                  setCloseTarget(shift);
                                }}
                                data-testid={`shift-close-${shift.id}`}
                              >
                                Close shift…
                              </DropdownMenuItem>
                            )}
                            {shift.status === "closed" && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setReopenReason("");
                                  setReopenTarget(shift);
                                }}
                                data-testid={`shift-reopen-${shift.id}`}
                              >
                                Reopen shift…
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </ResponsiveTable>
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

      {/* ARC-011: close another person's shift. Asks for the same counted-cash
          figure the cashier would give at the till (`POST /api/shifts/:id/close`
          computes variance from it server-side, same as a self-close). */}
      <Dialog open={!!closeTarget} onOpenChange={(v) => !v && setCloseTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Close shift</DialogTitle>
            <DialogDescription>
              {closeTarget && (
                <>
                  {closeTarget.userName}'s shift at {closeTarget.locationName ?? "this location"}, on since{" "}
                  {when(closeTarget.openedAt)}.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="close-counted">Counted cash</Label>
              <Input
                id="close-counted"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={closingCount}
                onChange={(e) => setClosingCount(e.target.value)}
                placeholder="0.00"
                data-testid="input-close-counted-cash"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="close-notes">Notes (optional)</Label>
              <Textarea
                id="close-notes"
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                placeholder="Why you're closing this on their behalf"
                data-testid="input-close-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                closeMutation.isPending ||
                closingCount.trim() === "" ||
                !Number.isFinite(parseFloat(closingCount)) ||
                parseFloat(closingCount) < 0
              }
              onClick={() =>
                closeTarget &&
                closeMutation.mutate({
                  id: closeTarget.id,
                  closingCount: parseFloat(closingCount),
                  notes: closeNotes,
                })
              }
              data-testid="button-confirm-close-shift"
            >
              Close shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ARC-011: reopen a closed shift. The server requires a reason
          (`reopenBodySchema`, min 3 chars) so there is always an audit trail
          for why a shift some Z-report may already reference got reopened. */}
      <Dialog open={!!reopenTarget} onOpenChange={(v) => !v && setReopenTarget(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reopen shift</DialogTitle>
            <DialogDescription>
              {reopenTarget && (
                <>
                  {reopenTarget.userName}'s shift, closed {when(reopenTarget.closedAt)}.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reopen-reason">Reason</Label>
            <Textarea
              id="reopen-reason"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Why this shift needs to be reopened"
              data-testid="input-reopen-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={reopenMutation.isPending || reopenReason.trim().length < 3}
              onClick={() =>
                reopenTarget && reopenMutation.mutate({ id: reopenTarget.id, reason: reopenReason.trim() })
              }
              data-testid="button-confirm-reopen-shift"
            >
              Reopen shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
