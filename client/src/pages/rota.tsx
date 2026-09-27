import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getJson } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CalendarDays, Plus, Check, X, Trash2, Printer, Download, Share2, RotateCcw, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgTimezone } from "@/hooks/useDefaultTradingDay";
import { localCalendarDate } from "@shared/time/tradingDay";
import { buildRotaPdf, canShareFiles, downloadRotaPdf, rotaPdfFileName, shareRotaPdf } from "@/lib/rotaPdf";

interface RotaShiftSegment {
  startTime: string;
  endTime: string;
}

interface RotaDay {
  date: string;
  status: "working" | "off" | "unscheduled";
  startTime: string | null;
  endTime: string | null;
  shifts: RotaShiftSegment[];
  isOverride: boolean;
  overrideId: string | null;
}

interface RotaGridPerson {
  userId: string;
  name: string;
  role: string | null;
  /** Every id this person's rows and requests may carry (Clerk subject and legacy id). */
  aliases: string[];
  days: RotaDay[];
}

interface RotaGrid {
  dates: string[];
  people: RotaGridPerson[];
  headcountByDate: Record<string, number>;
}

interface ShiftPattern {
  id: string;
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  isActive: number;
}

interface TimeOffRequest {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: "pending" | "approved" | "declined" | "cancelled";
  decidedByUserId: string | null;
  decisionNote: string | null;
}

const MANAGER_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MANAGER"]);
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_AHEAD = 14;
/** The server refuses longer requests; checked here too so the form says so before sending. */
const MAX_TIME_OFF_DAYS = 62;

interface TemplateShift {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface TemplateRole {
  role: string;
  shifts: TemplateShift[];
}

/**
 * A 3-person starting pattern the owner sketched out by hand: a driver plus
 * two workers, covering a 24-hour peak (Fri/Sat) with a lighter midweek.
 * Loading it creates one recurring pattern per shift, mapped onto whichever
 * three roster members the manager picks in the dialog — it never assumes
 * who "Driver" or "Worker A" actually is.
 */
const STARTING_TEMPLATE: TemplateRole[] = [
  {
    role: "Driver",
    shifts: [
      { dayOfWeek: 1, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: 2, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: 4, startTime: "16:00", endTime: "00:00" },
      { dayOfWeek: 5, startTime: "16:00", endTime: "00:00" },
      { dayOfWeek: 6, startTime: "16:00", endTime: "00:00" },
    ],
  },
  {
    role: "Worker A",
    shifts: [
      { dayOfWeek: 3, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: 4, startTime: "16:00", endTime: "00:00" },
      { dayOfWeek: 5, startTime: "00:00", endTime: "08:00" },
      { dayOfWeek: 5, startTime: "16:00", endTime: "00:00" },
      { dayOfWeek: 6, startTime: "00:00", endTime: "08:00" },
      { dayOfWeek: 0, startTime: "00:00", endTime: "08:00" },
    ],
  },
  {
    role: "Worker B",
    shifts: [
      { dayOfWeek: 1, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: 2, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: 3, startTime: "12:00", endTime: "20:00" },
      { dayOfWeek: 4, startTime: "16:00", endTime: "00:00" },
      { dayOfWeek: 5, startTime: "08:00", endTime: "16:00" },
      { dayOfWeek: 6, startTime: "08:00", endTime: "16:00" },
      { dayOfWeek: 0, startTime: "08:00", endTime: "14:00" },
    ],
  },
];

/** Today in the shop's own timezone — the UTC date is still yesterday between midnight and 01:00 in a UK summer. */
function todayIn(timeZone: string): string {
  return localCalendarDate(new Date(), timeZone);
}

function isoDow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d}/${m}`;
}

/** "Mon 5 Oct 2026" — with the year, so a request typed for the wrong year is obvious before anyone approves it. */
function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Days from start to end inclusive; 0 when the range is backwards or not a date. */
function dayCount(startDate: string, endDate: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const days = Math.round((t(endDate) - t(startDate)) / 86_400_000) + 1;
  return Number.isFinite(days) && days > 0 ? days : 0;
}

function dateRangeLabel(startDate: string, endDate: string): string {
  const days = dayCount(startDate, endDate);
  const span = startDate === endDate ? longDate(startDate) : `${longDate(startDate)} – ${longDate(endDate)}`;
  return `${span} (${days} day${days === 1 ? "" : "s"})`;
}

/** Relative intensity (0-1) for the busy-overlay tint behind each day column. */
function busyIntensity(byDayOfWeek: Record<number, number> | undefined, dow: number): number {
  if (!byDayOfWeek) return 0;
  const values = Object.values(byDayOfWeek);
  const max = Math.max(...values, 0);
  if (max <= 0) return 0;
  return (byDayOfWeek[dow] ?? 0) / max;
}

export default function RotaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isManager = MANAGER_ROLES.has(user?.role ?? "");
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const timeZone = useOrgTimezone();
  const today = todayIn(timeZone);
  // Null until someone picks a date, so the default follows the org's timezone once settings load.
  const [pickedFrom, setPickedFrom] = useState<string | null>(null);
  const from = pickedFrom ?? today;
  const [cellDialog, setCellDialog] = useState<{ person: RotaGridPerson; date: string; day: RotaDay } | null>(null);
  const [patternDialogOpen, setPatternDialogOpen] = useState(false);
  const [timeOffDialogOpen, setTimeOffDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const shareSupported = useMemo(() => canShareFiles(), []);

  const gridQuery = useQuery<RotaGrid>({
    queryKey: ["/api/rota", "grid", from, DAYS_AHEAD],
    queryFn: () => getJson<RotaGrid>(`/api/rota?from=${from}&days=${DAYS_AHEAD}`),
  });

  const busyQuery = useQuery<{ byDayOfWeek: Record<number, number>; weeks: number }>({
    queryKey: ["/api/rota/busy"],
    queryFn: () => getJson("/api/rota/busy?weeks=8"),
    enabled: isManager,
  });

  const timeOffQuery = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/rota/time-off"],
    queryFn: () => getJson<TimeOffRequest[]>("/api/rota/time-off"),
  });

  const patternsQuery = useQuery<ShiftPattern[]>({
    queryKey: ["/api/rota/patterns"],
    queryFn: () => getJson<ShiftPattern[]>("/api/rota/patterns"),
    enabled: isManager,
  });

  const refreshRota = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/rota"] });
    queryClient.invalidateQueries({ queryKey: ["/api/rota/time-off"] });
    queryClient.invalidateQueries({ queryKey: ["/api/rota/patterns"] });
  };
  // A failure often means someone else got there first (a request already
  // decided, a day already changed) — reload so the screen shows what is true now.
  const failed = (title: string) => (error: Error) => {
    refreshRota();
    toast({ title, description: error.message, variant: "destructive" });
  };

  const grid = gridQuery.data;
  const people = grid?.people ?? [];
  const personFor = (userId: string) => people.find((p) => p.userId === userId || p.aliases?.includes(userId));
  const me = user?.id ? personFor(user.id) : undefined;
  const myIds = me ? me.aliases : user?.id ? [user.id] : [];
  const isMine = (r: TimeOffRequest) => myIds.includes(r.userId);
  // Only the owner decides their own time off (the server enforces this too).
  const mayDecide = (r: TimeOffRequest) => isManager && (isSuperAdmin || !isMine(r));

  const overrideMutation = useMutation({
    mutationFn: (payload: { userId: string; date: string; status: "working" | "off"; startTime?: string; endTime?: string }) =>
      apiRequest("POST", "/api/rota/overrides", payload),
    onSuccess: () => {
      refreshRota();
      setCellDialog(null);
      toast({ title: "Rota updated" });
    },
    onError: failed("Couldn't save that"),
  });

  const resetOverrideMutation = useMutation({
    mutationFn: (overrideId: string) => apiRequest("DELETE", `/api/rota/overrides/${overrideId}`),
    onSuccess: () => {
      refreshRota();
      setCellDialog(null);
      toast({ title: "Back to the usual pattern" });
    },
    onError: failed("Couldn't reset that day"),
  });

  const patternMutation = useMutation({
    mutationFn: (payload: { userId: string; dayOfWeek: number; startTime: string; endTime: string; effectiveFrom: string }) =>
      apiRequest("POST", "/api/rota/patterns", payload),
    onSuccess: () => {
      refreshRota();
      setPatternDialogOpen(false);
      toast({ title: "Recurring pattern added" });
    },
    onError: failed("Couldn't save that pattern"),
  });

  const templateMutation = useMutation({
    mutationFn: async (assignments: Record<string, string>) => {
      // Skip any shift the person already has, so loading the template twice
      // (or after a partial failure) never doubles anyone up.
      const existing = patternsQuery.data ?? [];
      let added = 0;
      let skipped = 0;
      for (const role of STARTING_TEMPLATE) {
        const userId = assignments[role.role];
        if (!userId) continue;
        const ids = personFor(userId)?.aliases ?? [userId];
        for (const shift of role.shifts) {
          const already = existing.some(
            (p) =>
              ids.includes(p.userId) &&
              p.isActive !== 0 &&
              p.dayOfWeek === shift.dayOfWeek &&
              p.startTime === shift.startTime &&
              p.endTime === shift.endTime &&
              (!p.effectiveUntil || p.effectiveUntil >= today),
          );
          if (already) {
            skipped++;
            continue;
          }
          await apiRequest("POST", "/api/rota/patterns", {
            userId,
            dayOfWeek: shift.dayOfWeek,
            startTime: shift.startTime,
            endTime: shift.endTime,
            effectiveFrom: today,
          });
          added++;
        }
      }
      return { added, skipped };
    },
    onSuccess: ({ added, skipped }) => {
      refreshRota();
      setTemplateDialogOpen(false);
      toast({
        title: "Starting template loaded",
        description: `${added} shift${added === 1 ? "" : "s"} added${skipped ? `, ${skipped} already there and skipped` : ""}.`,
      });
    },
    onError: failed("Couldn't load all of the template"),
  });

  const deletePatternMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/rota/patterns/${id}`),
    onSuccess: refreshRota,
    onError: failed("Couldn't remove that pattern"),
  });

  const timeOffMutation = useMutation({
    mutationFn: (payload: { startDate: string; endDate: string; reason?: string }) =>
      apiRequest("POST", "/api/rota/time-off", payload),
    onSuccess: () => {
      refreshRota();
      setTimeOffDialogOpen(false);
      toast({ title: "Time off requested" });
    },
    onError: failed("Couldn't send that request"),
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "declined" | "revoked" }) =>
      apiRequest("POST", `/api/rota/time-off/${id}/decide`, { decision }),
    onSuccess: (_data, { decision }) => {
      refreshRota();
      toast({
        title:
          decision === "approved"
            ? "Approved — the days off are on the rota"
            : decision === "revoked"
              ? "Approval revoked — those days are back to the usual pattern"
              : "Declined",
      });
    },
    onError: failed("Couldn't decide that request"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/rota/time-off/${id}/cancel`),
    onSuccess: () => {
      refreshRota();
      toast({ title: "Request cancelled" });
    },
    onError: failed("Couldn't cancel that request"),
  });

  const pendingRequests = useMemo(() => (timeOffQuery.data ?? []).filter((r) => r.status === "pending"), [timeOffQuery.data]);

  /** The approved request (if any) that put this person off on this date — such a day is changed by revoking the request. */
  const approvedRequestFor = (person: RotaGridPerson, date: string) =>
    (timeOffQuery.data ?? []).find(
      (r) => r.status === "approved" && person.aliases.includes(r.userId) && r.startDate <= date && r.endDate >= date,
    );

  const makePdf = () => {
    if (!grid) return null;
    const pdf = buildRotaPdf(grid, { orgName: user?.orgName ?? null, generatedAt: new Date() });
    return { pdf, fileName: rotaPdfFileName(grid) };
  };

  const handleDownload = () => {
    const made = makePdf();
    if (made) downloadRotaPdf(made.pdf, made.fileName);
  };

  const handlePrint = () => {
    const made = makePdf();
    if (!made) return;
    // The browser's own PDF viewer prints the sheet exactly as drawn — white
    // paper, all 14 days across one landscape page.
    const url = URL.createObjectURL(made.pdf.output("blob"));
    const opened = window.open(url, "_blank");
    if (!opened) {
      downloadRotaPdf(made.pdf, made.fileName);
      toast({ title: "Pop-up blocked", description: "The rota PDF was downloaded instead — open it and print from there." });
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const handleShare = async () => {
    const made = makePdf();
    if (!made) return;
    setSharing(true);
    try {
      const outcome = await shareRotaPdf(made.pdf, made.fileName, "Rota");
      if (outcome === "unsupported") {
        downloadRotaPdf(made.pdf, made.fileName);
        toast({ title: "Sharing isn't available here", description: "The rota PDF was downloaded instead." });
      }
    } catch (error) {
      toast({ title: "Couldn't share the rota", description: (error as Error).message, variant: "destructive" });
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Rota"
        icon={CalendarDays}
        question="Who's on, and who's asked for time off?"
        explanation="A 14-day forward view built from each person's recurring pattern, plus any one-off cover, swap, or approved day off."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setPickedFrom(e.target.value || null)}
              className="w-40"
              data-testid="input-rota-from"
            />
            <Button variant="outline" onClick={() => setTimeOffDialogOpen(true)} data-testid="button-request-time-off">
              <Plus className="mr-1.5 h-4 w-4" /> Request time off
            </Button>
            {isManager ? (
              <>
                <Button variant="outline" onClick={() => setTemplateDialogOpen(true)} data-testid="button-load-template">
                  Load starting template
                </Button>
                <Button onClick={() => setPatternDialogOpen(true)} data-testid="button-add-pattern">
                  <Plus className="mr-1.5 h-4 w-4" /> Add recurring pattern
                </Button>
              </>
            ) : null}
            <Button variant="outline" onClick={handleDownload} disabled={!grid} data-testid="button-download-rota-pdf">
              <Download className="mr-1.5 h-4 w-4" /> Download PDF
            </Button>
            {shareSupported ? (
              <Button variant="outline" onClick={handleShare} disabled={!grid || sharing} data-testid="button-share-rota-pdf">
                <Share2 className="mr-1.5 h-4 w-4" /> Share
              </Button>
            ) : null}
            <Button variant="outline" onClick={handlePrint} disabled={!grid} data-testid="button-print-rota">
              <Printer className="mr-1.5 h-4 w-4" /> Print
            </Button>
          </div>
        }
      />

      {isManager && pendingRequests.length > 0 ? (
        <Card className="mb-4 border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pending time-off requests ({pendingRequests.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pendingRequests.map((r) => {
              const person = personFor(r.userId);
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-metal-border p-2">
                  <div className="text-sm">
                    <span className="font-medium">{person?.name ?? "Former staff member"}</span>{" "}
                    <span className="text-metal-muted">
                      {dateRangeLabel(r.startDate, r.endDate)}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </span>
                  </div>
                  {mayDecide(r) ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: r.id, decision: "approved" })}
                        data-testid={`button-approve-timeoff-${r.id}`}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: r.id, decision: "declined" })}
                        data-testid={`button-decline-timeoff-${r.id}`}
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Decline
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-metal-muted">Your own request — someone else decides it.</span>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {gridQuery.isLoading ? (
            <div className="p-6 text-sm text-metal-muted">Loading the rota…</div>
          ) : !grid ? (
            <div className="p-6 text-sm text-metal-muted">Couldn't load the rota.</div>
          ) : grid.people.length === 0 ? (
            <div className="p-6 text-sm text-metal-muted">Nobody on the roster yet — add staff under Settings → Users.</div>
          ) : (
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card p-2 text-left font-medium text-metal-muted">Staff</th>
                  {grid.dates.map((date) => {
                    const dow = isoDow(date);
                    const intensity = busyQuery.data ? busyIntensity(busyQuery.data.byDayOfWeek, dow) : 0;
                    return (
                      <th
                        key={date}
                        className={cn("min-w-[90px] p-2 text-center font-medium", date === today && "ring-1 ring-inset ring-primary/60")}
                        style={isManager ? { backgroundColor: `rgba(234, 88, 12, ${0.06 + intensity * 0.28})` } : undefined}
                        title={isManager ? "Shading reflects how busy this day of week usually is" : undefined}
                      >
                        <div>{DAY_LABELS[dow]}</div>
                        <div className="text-xs text-metal-muted">{shortDate(date)}</div>
                        <div className="mt-0.5 text-xs text-metal-muted">{grid.headcountByDate[date] ?? 0} on</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {grid.people.map((person) => (
                  <tr key={person.userId} className="border-t border-metal-border">
                    <td className="sticky left-0 z-10 bg-card p-2 font-medium">{person.name}</td>
                    {person.days.map((day) => (
                      <td key={day.date} className="p-1 text-center align-top">
                        <button
                          type="button"
                          disabled={!isManager}
                          onClick={() => isManager && setCellDialog({ person, date: day.date, day })}
                          className={cn(
                            "w-full rounded-md border px-1.5 py-1 text-xs",
                            day.status === "working" && "border-emerald-600/40 bg-emerald-600/10 text-emerald-400",
                            day.status === "off" && "border-red-600/40 bg-red-600/10 text-red-400",
                            day.status === "unscheduled" && "border-metal-border bg-transparent text-metal-muted",
                            day.isOverride && "border-dashed",
                            isManager && "cursor-pointer hover:opacity-80",
                          )}
                          title={day.isOverride ? "One-off change for this date" : undefined}
                          data-testid={`cell-rota-${person.userId}-${day.date}`}
                        >
                          {day.status === "working" ? (
                            day.shifts.length > 1 ? (
                              <span className="flex flex-col gap-0.5">
                                {day.shifts.map((s, i) => (
                                  <span key={i}>{s.startTime}–{s.endTime}</span>
                                ))}
                              </span>
                            ) : (
                              `${day.startTime}–${day.endTime}`
                            )
                          ) : day.status === "off" ? (
                            "Off"
                          ) : (
                            "—"
                          )}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {isManager && patternsQuery.data && patternsQuery.data.length > 0 ? (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recurring patterns</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {patternsQuery.data.map((p) => {
              const person = personFor(p.userId);
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-metal-border p-2 text-sm">
                  <span>
                    <span className="font-medium">{person?.name ?? "Former staff member"}</span> · every {DAY_LABELS[p.dayOfWeek]} · {p.startTime}–
                    {p.endTime}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={deletePatternMutation.isPending}
                    onClick={() => deletePatternMutation.mutate(p.id)}
                    aria-label="Remove this pattern"
                    data-testid={`button-delete-pattern-${p.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* Cell edit dialog: manager sets a one-off cover/swap/day-off for a person+date */}
      <Dialog open={!!cellDialog} onOpenChange={(open) => !open && setCellDialog(null)}>
        <DialogContent>
          {cellDialog ? (
            <CellOverrideForm
              key={`${cellDialog.person.userId}-${cellDialog.date}`}
              userName={cellDialog.person.name}
              date={cellDialog.date}
              day={cellDialog.day}
              fromTimeOff={cellDialog.day.status === "off" && !!approvedRequestFor(cellDialog.person, cellDialog.date)}
              onSubmit={(status, startTime, endTime) =>
                overrideMutation.mutate({ userId: cellDialog.person.userId, date: cellDialog.date, status, startTime, endTime })
              }
              onReset={cellDialog.day.overrideId ? () => resetOverrideMutation.mutate(cellDialog.day.overrideId!) : undefined}
              isPending={overrideMutation.isPending || resetOverrideMutation.isPending}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Add recurring pattern dialog (manager+) */}
      <Dialog open={patternDialogOpen} onOpenChange={setPatternDialogOpen}>
        <DialogContent>
          <PatternForm
            people={people}
            today={today}
            onSubmit={(payload) => patternMutation.mutate(payload)}
            isPending={patternMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Load starting template dialog (manager+) */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <TemplateForm
            people={people}
            onSubmit={(assignments) => templateMutation.mutate(assignments)}
            isPending={templateMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Request time off dialog (any staff) */}
      <Dialog open={timeOffDialogOpen} onOpenChange={setTimeOffDialogOpen}>
        <DialogContent>
          <TimeOffForm today={today} onSubmit={(payload) => timeOffMutation.mutate(payload)} isPending={timeOffMutation.isPending} />
        </DialogContent>
      </Dialog>

      {timeOffQuery.data && timeOffQuery.data.length > 0 ? (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{isManager ? "All time-off requests" : "Your time-off requests"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {timeOffQuery.data.map((r) => {
              const person = personFor(r.userId);
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-metal-border p-2 text-sm">
                  <span>
                    {isManager ? <span className="font-medium">{person?.name ?? "Former staff member"}</span> : null}{" "}
                    {dateRangeLabel(r.startDate, r.endDate)}
                    {r.reason ? ` · ${r.reason}` : ""}
                    {r.decisionNote ? <span className="text-metal-muted"> · {r.decisionNote}</span> : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={r.status === "approved" ? "default" : r.status === "declined" ? "destructive" : "secondary"}
                    >
                      {r.status}
                    </Badge>
                    {r.status === "pending" && (isManager || isMine(r)) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate(r.id)}
                        data-testid={`button-cancel-timeoff-${r.id}`}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    {r.status === "approved" && mayDecide(r) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: r.id, decision: "revoked" })}
                        data-testid={`button-revoke-timeoff-${r.id}`}
                      >
                        <Undo2 className="mr-1 h-3.5 w-3.5" /> Revoke
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CellOverrideForm({
  userName,
  date,
  day,
  fromTimeOff,
  onSubmit,
  onReset,
  isPending,
}: {
  userName: string;
  date: string;
  day: RotaDay;
  /** This day off was written by an approved time-off request: change it by revoking the request. */
  fromTimeOff: boolean;
  onSubmit: (status: "working" | "off", startTime?: string, endTime?: string) => void;
  /** Present when a one-off change exists for this date; removes it so the usual pattern applies again. */
  onReset?: () => void;
  isPending: boolean;
}) {
  const [status, setStatus] = useState<"working" | "off">(day.status === "off" ? "off" : "working");
  // The first real shift, not the day's overall span: a 00:00–08:00 + 16:00–00:00
  // double would otherwise prefill as a single 00:00–00:00 "shift".
  const [startTime, setStartTime] = useState(day.shifts[0]?.startTime ?? day.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(day.shifts[0]?.endTime ?? day.endTime ?? "17:00");
  const isSplit = day.shifts.length > 1;

  if (fromTimeOff) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{userName} · {longDate(date)}</DialogTitle>
          <DialogDescription>
            This day off comes from an approved time-off request. To put {userName} back on, revoke that request under
            "All time-off requests" below the rota.
          </DialogDescription>
        </DialogHeader>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{userName} · {longDate(date)}</DialogTitle>
        <DialogDescription>Set a one-off cover, swap, or day off for this date. This never touches the recurring pattern.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        {isSplit ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs" data-testid="text-split-shift-warning">
            {userName} has {day.shifts.length} shifts this day ({day.shifts.map((s) => `${s.startTime}–${s.endTime}`).join(", ")}).
            Saving replaces all of them, for this date only, with the one shift below.
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" variant={status === "working" ? "default" : "outline"} onClick={() => setStatus("working")}>
            Working
          </Button>
          <Button type="button" variant={status === "off" ? "default" : "outline"} onClick={() => setStatus("off")}>
            Off
          </Button>
        </div>
        {status === "working" ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Start</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label>End</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
        ) : null}
      </div>
      <DialogFooter className="gap-2">
        {onReset ? (
          <Button variant="outline" disabled={isPending} onClick={onReset} data-testid="button-reset-override">
            <RotateCcw className="mr-1.5 h-4 w-4" /> Reset to usual pattern
          </Button>
        ) : null}
        <Button
          disabled={isPending || (status === "working" && (!startTime || !endTime))}
          onClick={() => onSubmit(status, status === "working" ? startTime : undefined, status === "working" ? endTime : undefined)}
          data-testid="button-save-override"
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

function PatternForm({
  people,
  today,
  onSubmit,
  isPending,
}: {
  people: RotaGridPerson[];
  today: string;
  onSubmit: (payload: { userId: string; dayOfWeek: number; startTime: string; endTime: string; effectiveFrom: string }) => void;
  isPending: boolean;
}) {
  const [userId, setUserId] = useState(people[0]?.userId ?? "");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [effectiveFrom, setEffectiveFrom] = useState(today);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a recurring pattern</DialogTitle>
        <DialogDescription>Repeats every week on this day until you remove it or set an end date.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div>
          <Label>Staff member</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger data-testid="select-pattern-user"><SelectValue /></SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={p.userId} value={p.userId}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Day of week</Label>
          <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAY_LABELS.map((label, index) => (
                <SelectItem key={index} value={String(index)}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Start</Label>
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <Label>End</Label>
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Starting from</Label>
          <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button
          disabled={isPending || !userId}
          onClick={() => onSubmit({ userId, dayOfWeek: Number(dayOfWeek), startTime, endTime, effectiveFrom })}
          data-testid="button-save-pattern"
        >
          Save pattern
        </Button>
      </DialogFooter>
    </>
  );
}

function TemplateForm({
  people,
  onSubmit,
  isPending,
}: {
  people: RotaGridPerson[];
  onSubmit: (assignments: Record<string, string>) => void;
  isPending: boolean;
}) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const totalShifts = STARTING_TEMPLATE.reduce((sum, role) => sum + role.shifts.length, 0);
  const assignedCount = STARTING_TEMPLATE.filter((role) => assignments[role.role]).length;
  const chosen = STARTING_TEMPLATE.map((role) => assignments[role.role]).filter(Boolean);
  // One person in two roles would be rota'd for overlapping shifts (Thursday has all three on 16:00–00:00).
  const doubledUp = new Set(chosen).size !== chosen.length;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Load starting template</DialogTitle>
        <DialogDescription>
          A driver plus two workers, covering a light midweek and a 24-hour peak Friday/Saturday. Pick who plays each
          role — it adds up to {totalShifts} recurring shifts (starting today), on top of whatever's already there. Shifts
          someone already has are skipped, so loading it twice never doubles anyone up.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        {STARTING_TEMPLATE.map((role) => (
          <div key={role.role}>
            <Label>{role.role}</Label>
            <Select value={assignments[role.role] ?? ""} onValueChange={(v) => setAssignments((a) => ({ ...a, [role.role]: v }))}>
              <SelectTrigger data-testid={`select-template-${role.role.replace(/\s+/g, "-").toLowerCase()}`}>
                <SelectValue placeholder="Choose a staff member" />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.userId} value={p.userId}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {doubledUp ? (
        <p className="text-xs text-red-400" data-testid="text-template-doubled-up">
          The same person is picked for two roles. Pick a different person for each.
        </p>
      ) : null}
      <DialogFooter>
        <Button
          disabled={isPending || assignedCount === 0 || doubledUp}
          onClick={() => onSubmit(assignments)}
          data-testid="button-save-template"
        >
          Load template
        </Button>
      </DialogFooter>
    </>
  );
}

function TimeOffForm({
  today,
  onSubmit,
  isPending,
}: {
  today: string;
  onSubmit: (payload: { startDate: string; endDate: string; reason?: string }) => void;
  isPending: boolean;
}) {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const days = dayCount(startDate, endDate);
  const problem = !startDate || !endDate
    ? "Pick both dates."
    : endDate < startDate
      ? "The last day is before the first."
      : days > MAX_TIME_OFF_DAYS
        ? `That's ${days} days — a request can cover at most ${MAX_TIME_OFF_DAYS}. Check the year.`
        : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Request time off</DialogTitle>
        <DialogDescription>Sent for a manager to approve or decline.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>From</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Reason (optional)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
        <p className={cn("text-xs", problem ? "text-red-400" : "text-metal-muted")} data-testid="text-timeoff-summary">
          {problem ?? dateRangeLabel(startDate, endDate)}
        </p>
      </div>
      <DialogFooter>
        <Button
          disabled={isPending || !!problem}
          onClick={() => onSubmit({ startDate, endDate, reason: reason.trim() || undefined })}
          data-testid="button-save-timeoff"
        >
          Send request
        </Button>
      </DialogFooter>
    </>
  );
}
