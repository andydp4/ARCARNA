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
import { CalendarDays, Plus, Check, X, Trash2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

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
}

interface RotaGridPerson {
  userId: string;
  name: string;
  role: string | null;
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d}/${m}`;
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
  const [from, setFrom] = useState(todayIso());
  const [cellDialog, setCellDialog] = useState<{ userId: string; userName: string; date: string; day: RotaDay } | null>(null);
  const [patternDialogOpen, setPatternDialogOpen] = useState(false);
  const [timeOffDialogOpen, setTimeOffDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

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

  const overrideMutation = useMutation({
    mutationFn: (payload: { userId: string; date: string; status: "working" | "off"; startTime?: string; endTime?: string }) =>
      apiRequest("POST", "/api/rota/overrides", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rota"] });
      setCellDialog(null);
      toast({ title: "Rota updated" });
    },
    onError: (error: Error) => toast({ title: "Couldn't save that", description: error.message, variant: "destructive" }),
  });

  const patternMutation = useMutation({
    mutationFn: (payload: { userId: string; dayOfWeek: number; startTime: string; endTime: string; effectiveFrom: string }) =>
      apiRequest("POST", "/api/rota/patterns", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rota"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rota/patterns"] });
      setPatternDialogOpen(false);
      toast({ title: "Recurring pattern added" });
    },
    onError: (error: Error) => toast({ title: "Couldn't save that pattern", description: error.message, variant: "destructive" }),
  });

  const templateMutation = useMutation({
    mutationFn: async (assignments: Record<string, string>) => {
      for (const role of STARTING_TEMPLATE) {
        const userId = assignments[role.role];
        if (!userId) continue;
        for (const shift of role.shifts) {
          await apiRequest("POST", "/api/rota/patterns", {
            userId,
            dayOfWeek: shift.dayOfWeek,
            startTime: shift.startTime,
            endTime: shift.endTime,
            effectiveFrom: todayIso(),
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rota"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rota/patterns"] });
      setTemplateDialogOpen(false);
      toast({ title: "Starting template loaded" });
    },
    onError: (error: Error) => toast({ title: "Couldn't load the template", description: error.message, variant: "destructive" }),
  });

  const deletePatternMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/rota/patterns/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rota"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rota/patterns"] });
    },
    onError: (error: Error) => toast({ title: "Couldn't remove that pattern", description: error.message, variant: "destructive" }),
  });

  const timeOffMutation = useMutation({
    mutationFn: (payload: { startDate: string; endDate: string; reason?: string }) =>
      apiRequest("POST", "/api/rota/time-off", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rota/time-off"] });
      setTimeOffDialogOpen(false);
      toast({ title: "Time off requested" });
    },
    onError: (error: Error) => toast({ title: "Couldn't send that request", description: error.message, variant: "destructive" }),
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "declined" }) =>
      apiRequest("POST", `/api/rota/time-off/${id}/decide`, { decision }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rota/time-off"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rota"] });
    },
    onError: (error: Error) => toast({ title: "Couldn't decide that request", description: error.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/rota/time-off/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rota/time-off"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rota"] });
    },
    onError: (error: Error) => toast({ title: "Couldn't cancel that request", description: error.message, variant: "destructive" }),
  });

  const grid = gridQuery.data;
  const pendingRequests = useMemo(() => (timeOffQuery.data ?? []).filter((r) => r.status === "pending"), [timeOffQuery.data]);
  const handlePrintRota = () => window.print();

  return (
    <div className="p-6">
      {/* Printing (Print / PDF, or the browser's own "Save as PDF" / share sheet)
          shows only #rota-print-area — everything else on the page, nav included,
          is hidden for that one print. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #rota-print-area, #rota-print-area * { visibility: visible; }
          #rota-print-area { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>
      <PageHeader
        title="Rota"
        icon={CalendarDays}
        question="Who's on, and who's asked for time off?"
        explanation="A 14-day forward view built from each cashier's recurring pattern, plus any one-off cover, swap, or approved day off."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
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
            <Button variant="outline" onClick={handlePrintRota} data-testid="button-print-rota">
              <Printer className="mr-1.5 h-4 w-4" /> Print / PDF
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
              const person = grid?.people.find((p) => p.userId === r.userId);
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-metal-border p-2">
                  <div className="text-sm">
                    <span className="font-medium">{person?.name ?? r.userId}</span>{" "}
                    <span className="text-metal-muted">
                      {shortDate(r.startDate)} – {shortDate(r.endDate)}
                      {r.reason ? ` · ${r.reason}` : ""}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => decideMutation.mutate({ id: r.id, decision: "approved" })}
                      data-testid={`button-approve-timeoff-${r.id}`}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => decideMutation.mutate({ id: r.id, decision: "declined" })}
                      data-testid={`button-decline-timeoff-${r.id}`}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Decline
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card id="rota-print-area">
        <div className="hidden p-4 pb-0 print:block">
          <h2 className="text-lg font-semibold">Rota</h2>
          {grid ? (
            <p className="text-sm text-metal-muted">
              {shortDate(grid.dates[0])} – {shortDate(grid.dates[grid.dates.length - 1])}
            </p>
          ) : null}
        </div>
        <CardContent className="overflow-x-auto p-0">
          {gridQuery.isLoading ? (
            <div className="p-6 text-sm text-metal-muted">Loading the rota…</div>
          ) : !grid ? (
            <div className="p-6 text-sm text-metal-muted">Couldn't load the rota.</div>
          ) : (
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-metal-panel p-2 text-left font-medium text-metal-muted">Staff</th>
                  {grid.dates.map((date) => {
                    const dow = isoDow(date);
                    const intensity = busyQuery.data ? busyIntensity(busyQuery.data.byDayOfWeek, dow) : 0;
                    return (
                      <th
                        key={date}
                        className="min-w-[90px] p-2 text-center font-medium"
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
                    <td className="sticky left-0 z-10 bg-metal-panel p-2 font-medium">{person.name}</td>
                    {person.days.map((day) => (
                      <td key={day.date} className="p-1 text-center align-top">
                        <button
                          type="button"
                          disabled={!isManager}
                          onClick={() => isManager && setCellDialog({ userId: person.userId, userName: person.name, date: day.date, day })}
                          className={cn(
                            "w-full rounded-md border px-1.5 py-1 text-xs",
                            day.status === "working" && "border-emerald-600/40 bg-emerald-600/10 text-emerald-400",
                            day.status === "off" && "border-red-600/40 bg-red-600/10 text-red-400",
                            day.status === "unscheduled" && "border-metal-border bg-transparent text-metal-muted",
                            isManager && "cursor-pointer hover:opacity-80",
                          )}
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
              const person = grid?.people.find((person) => person.userId === p.userId);
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-metal-border p-2 text-sm">
                  <span>
                    <span className="font-medium">{person?.name ?? p.userId}</span> · every {DAY_LABELS[p.dayOfWeek]} · {p.startTime}–
                    {p.endTime}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deletePatternMutation.mutate(p.id)}
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
              userName={cellDialog.userName}
              date={cellDialog.date}
              day={cellDialog.day}
              onSubmit={(status, startTime, endTime) =>
                overrideMutation.mutate({ userId: cellDialog.userId, date: cellDialog.date, status, startTime, endTime })
              }
              isPending={overrideMutation.isPending}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Add recurring pattern dialog (manager+) */}
      <Dialog open={patternDialogOpen} onOpenChange={setPatternDialogOpen}>
        <DialogContent>
          <PatternForm
            people={grid?.people ?? []}
            onSubmit={(payload) => patternMutation.mutate(payload)}
            isPending={patternMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Load starting template dialog (manager+) */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <TemplateForm
            people={grid?.people ?? []}
            onSubmit={(assignments) => templateMutation.mutate(assignments)}
            isPending={templateMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Request time off dialog (any staff) */}
      <Dialog open={timeOffDialogOpen} onOpenChange={setTimeOffDialogOpen}>
        <DialogContent>
          <TimeOffForm onSubmit={(payload) => timeOffMutation.mutate(payload)} isPending={timeOffMutation.isPending} />
        </DialogContent>
      </Dialog>

      {timeOffQuery.data && timeOffQuery.data.length > 0 ? (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{isManager ? "All time-off requests" : "Your time-off requests"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {timeOffQuery.data.map((r) => {
              const person = grid?.people.find((p) => p.userId === r.userId);
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-metal-border p-2 text-sm">
                  <span>
                    {isManager ? <span className="font-medium">{person?.name ?? r.userId}</span> : null}{" "}
                    {shortDate(r.startDate)} – {shortDate(r.endDate)}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={r.status === "approved" ? "default" : r.status === "declined" ? "destructive" : "secondary"}
                    >
                      {r.status}
                    </Badge>
                    {r.status === "pending" && (isManager || r.userId === user?.id) ? (
                      <Button size="sm" variant="ghost" onClick={() => cancelMutation.mutate(r.id)}>
                        Cancel
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
  onSubmit,
  isPending,
}: {
  userName: string;
  date: string;
  day: RotaDay;
  onSubmit: (status: "working" | "off", startTime?: string, endTime?: string) => void;
  isPending: boolean;
}) {
  const [status, setStatus] = useState<"working" | "off">(day.status === "off" ? "off" : "working");
  const [startTime, setStartTime] = useState(day.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(day.endTime ?? "17:00");

  return (
    <>
      <DialogHeader>
        <DialogTitle>{userName} · {date}</DialogTitle>
        <DialogDescription>Set a one-off cover, swap, or day off for this date. This never touches the recurring pattern.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
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
      <DialogFooter>
        <Button
          disabled={isPending}
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
  onSubmit,
  isPending,
}: {
  people: RotaGridPerson[];
  onSubmit: (payload: { userId: string; dayOfWeek: number; startTime: string; endTime: string; effectiveFrom: string }) => void;
  isPending: boolean;
}) {
  const [userId, setUserId] = useState(people[0]?.userId ?? "");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());

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

  return (
    <>
      <DialogHeader>
        <DialogTitle>Load starting template</DialogTitle>
        <DialogDescription>
          A driver plus two workers, covering a light midweek and a 24-hour peak Friday/Saturday. Pick who plays each
          role — it adds {totalShifts} recurring shifts (starting today), on top of whatever's already there.
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
      <DialogFooter>
        <Button
          disabled={isPending || assignedCount === 0}
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
  onSubmit,
  isPending,
}: {
  onSubmit: (payload: { startDate: string; endDate: string; reason?: string }) => void;
  isPending: boolean;
}) {
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [reason, setReason] = useState("");

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
      </div>
      <DialogFooter>
        <Button
          disabled={isPending || endDate < startDate}
          onClick={() => onSubmit({ startDate, endDate, reason: reason.trim() || undefined })}
          data-testid="button-save-timeoff"
        >
          Send request
        </Button>
      </DialogFooter>
    </>
  );
}
