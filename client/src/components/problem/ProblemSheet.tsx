import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useLocation, useSearch } from "wouter";
import { LifeBuoy } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useSaleQueueStatus } from "@/hooks/useSaleQueueStatus";
import { apiFetch } from "@/lib/appPaths";
import { getSelectedOrgId } from "@/lib/orgScope";
import {
  buildProblemReport,
  DEVICE_NAME_EVENT,
  deviceName,
  flushProblemQueue,
  isRetryable,
  OPEN_PROBLEM_EVENT,
  openProblemSheet,
  ProblemSendError,
  queueProblem,
  reportScreen,
  setDeviceName,
} from "@/lib/problemReport";
import { sendReplayForProblem, setSentryContextTags } from "@/lib/sentryContext";
import { usageRecorder } from "@/lib/usage";
import { isAtLeast } from "@shared/accessPolicy";
import {
  DEVICE_NAMES,
  PROBLEM_CHIPS,
  PROBLEM_NOTE_HINT,
  PROBLEM_NOTE_MAX,
  UNNAMED_DEVICE,
  type DeviceName,
  type ProblemChip,
  type ProblemReportInput,
} from "@shared/problemReports";
import { APP_VERSION } from "@shared/version";

async function postProblemReport(report: ProblemReportInput): Promise<{ id: string; duplicate: boolean }> {
  const res = await apiFetch("/api/problem-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!res.ok) {
    let message = `Could not send (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.message === "string") message = body.message;
    } catch {
      /* not JSON */
    }
    throw new ProblemSendError(res.status, message);
  }
  return res.json();
}

/** The labelled button, in the header and on the till. */
export function ProblemButton({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={openProblemSheet}
      className={cn("min-h-[44px] gap-1.5", className)}
      data-testid={compact ? "button-problem-till" : "button-problem"}
    >
      <LifeBuoy className="h-4 w-4" aria-hidden />
      <span>Problem?</span>
    </Button>
  );
}

/**
 * The "Problem?" sheet (v1.2 Phase 8A, UXA-09), mounted once in the Layout
 * and opened by either button. It also keeps Sentry's role, screen and device
 * tags current, and sends any report kept while the till was offline.
 */
export function ProblemSheet() {
  const [location] = useLocation();
  const search = useSearch();
  const { user } = useAuth();
  const { toast } = useToast();
  const queue = useSaleQueueStatus();
  const [open, setOpen] = useState(false);
  const [chip, setChip] = useState<ProblemChip | null>(null);
  const [note, setNote] = useState("");
  const [device, setDevice] = useState<DeviceName | null>(() => deviceName());
  const [sending, setSending] = useState(false);
  const role = user?.role ?? null;
  const userId = user?.id ?? null;
  const isStaff = isAtLeast(role, "CASHIER");
  // The usage recorder's screen, not the URL's: the Operations Centre keeps
  // its pane in memory, so only the recorder knows whether the till
  // (/operations?pane=order) or the board is in front. A report and its
  // Sentry tag must land on the same screen as that screen's time and
  // incidents, or the pain score counts the report against the wrong one.
  const recorderScreen = useSyncExternalStore(
    (cb) => usageRecorder.subscribe(cb),
    () => usageRecorder.currentScreen(),
  );
  const screen = reportScreen(recorderScreen, location, search);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onDevice = () => setDevice(deviceName());
    window.addEventListener(OPEN_PROBLEM_EVENT, onOpen);
    window.addEventListener(DEVICE_NAME_EVENT, onDevice);
    return () => {
      window.removeEventListener(OPEN_PROBLEM_EVENT, onOpen);
      window.removeEventListener(DEVICE_NAME_EVENT, onDevice);
    };
  }, []);

  useEffect(() => {
    setSentryContextTags({ role, screen, device: device ?? UNNAMED_DEVICE });
  }, [role, screen, device]);

  const flush = useCallback(() => {
    if (!isStaff || !userId || !navigator.onLine) return;
    void flushProblemQueue(getSelectedOrgId(), userId, async (r) => {
      await postProblemReport(r);
    });
  }, [isStaff, userId]);

  useEffect(() => {
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [flush]);

  const reset = () => {
    setChip(null);
    setNote("");
  };

  const send = async () => {
    if (!chip) return;
    const report = buildProblemReport(chip, note, {
      path: screen,
      search: "",
      device,
      appVersion: APP_VERSION,
      online: queue.online,
      queue: { waiting: queue.waiting, failed: queue.localFailed, needsAttention: queue.serverOpen },
    });
    setSending(true);
    try {
      const out = await postProblemReport(report);
      if (isStaff && !out.duplicate) void sendReplayForProblem(out.id);
      toast({ title: "Thanks, it's reported", description: "An admin will look at it. If it gets fixed, you'll hear which version fixes it." });
      reset();
      setOpen(false);
    } catch (e) {
      if (userId && isRetryable(e) && !(e instanceof ProblemSendError && e.status === 429)) {
        queueProblem(getSelectedOrgId(), userId, report);
        toast({ title: "Saved on this device", description: "It will be sent when the till is back online." });
        reset();
        setOpen(false);
      } else {
        toast({ title: "Could not send the report", description: (e as Error).message, variant: "destructive" });
      }
    } finally {
      setSending(false);
    }
  };

  const queueLine = [
    `${queue.waiting} waiting`,
    `${queue.localFailed} failed`,
    ...(isAtLeast(role, "MANAGER") || queue.serverOpen > 0 ? [`${queue.serverOpen} on Needs attention`] : []),
  ].join(" · ");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        className="inset-0 flex h-[100dvh] max-h-[100dvh] flex-col gap-0 p-0 sm:p-0"
        data-testid="problem-sheet"
      >
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="mx-auto w-full max-w-2xl space-y-6">
            <div>
              <SheetTitle className="text-2xl">What went wrong?</SheetTitle>
              <SheetDescription>Pick one. It goes to the admins with the screen and this device. They see your role, not your name.</SheetDescription>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="What went wrong">
              {PROBLEM_CHIPS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={chip === c.key}
                  onClick={() => setChip(c.key)}
                  className={cn(
                    "min-h-[56px] rounded-xl border px-4 text-left text-base font-medium transition-colors",
                    chip === c.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-muted",
                  )}
                  data-testid={`problem-chip-${c.key}`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="problem-note">Tell us more (optional)</Label>
              <Textarea
                id="problem-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, PROBLEM_NOTE_MAX))}
                rows={3}
                maxLength={PROBLEM_NOTE_MAX}
                placeholder="What were you trying to do?"
                data-testid="problem-note"
              />
              <p className="text-sm font-medium text-amber-500" data-testid="problem-note-hint">
                {PROBLEM_NOTE_HINT}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="problem-device">This device</Label>
              <Select
                value={device ?? UNNAMED_DEVICE}
                onValueChange={(v) => setDeviceName(v === UNNAMED_DEVICE ? null : (v as DeviceName))}
              >
                <SelectTrigger id="problem-device" className="min-h-[44px]" data-testid="problem-device">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNNAMED_DEVICE}>{UNNAMED_DEVICE}</SelectItem>
                  {DEVICE_NAMES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Remembered on this device, so name it once.</p>
            </div>

            <div className="rounded-xl border border-border p-4" data-testid="problem-context">
              <p className="mb-2 text-sm font-medium">Sent with your report</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Screen</dt>
                <dd className="break-all">{screen}</dd>
                <dt className="text-muted-foreground">Role</dt>
                <dd>{role ?? "unknown"}</dd>
                <dt className="text-muted-foreground">Device</dt>
                <dd>{device ?? UNNAMED_DEVICE}</dd>
                <dt className="text-muted-foreground">Version</dt>
                <dd>{APP_VERSION}</dd>
                <dt className="text-muted-foreground">Connection</dt>
                <dd>{queue.online ? "Online" : "Offline"}</dd>
                <dt className="text-muted-foreground">Sales</dt>
                <dd>{queueLine}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="border-t border-border p-4">
          <div className="mx-auto flex w-full max-w-2xl gap-3">
            <Button type="button" variant="outline" className="min-h-[48px] flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="min-h-[48px] flex-1"
              disabled={!chip || sending}
              onClick={() => void send()}
              data-testid="problem-send"
            >
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
