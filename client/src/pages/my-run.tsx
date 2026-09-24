import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GripVertical,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Truck,
  WifiOff,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch } from "@/lib/appPaths";
import { getSelectedOrgId } from "@/lib/orgScope";
import { formatTimeOfDay } from "@/lib/opsClock";
import {
  applyQueuedTaps,
  enqueueRunTap,
  newTapId,
  readRunQueue,
  readRunSnapshot,
  replayRunTaps,
  saveRunSnapshot,
  splitStartable,
  tapsFor,
  writeRunQueue,
  type QueuedRunTap,
} from "@/lib/runQueue";
import {
  COULDNT_DELIVER_NOTE_MAX,
  COULDNT_DELIVER_REASONS,
  mapsPlatformFor,
  mapsUrl,
  moveStop,
  reorderIds,
  stopStage,
  type CouldntDeliverReason,
  type RunPayload,
  type RunStop,
} from "@shared/orders/myRun";
import { isAtLeast } from "@shared/accessPolicy";

const REFRESH_MS = 30_000;
const REPLAY_EVERY_MS = 20_000;

function money(value: number | string): string {
  const n = typeof value === "number" ? value : parseFloat(value);
  return `£${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.message === "string" && body.message ? body.message : fallback;
}

/**
 * Operations Centre › My run (v1.2): the driver's phone view. Their own
 * deliveries that are ready or on the road, in the order they choose; one tap
 * to navigate, call, start the run, mark delivered or say it could not be
 * delivered. Phone first: one column, no pop-ups, every control at least
 * 44px. Offline it shows the last loaded run and keeps Delivered / Couldn't
 * deliver taps to send later (lib/runQueue.ts).
 */
export default function MyRunPage() {
  const { user } = useAuth();
  const me = user?.id ?? "";
  const orgId = getSelectedOrgId() ?? user?.orgId ?? "";
  const manager = isAtLeast(user?.role, "MANAGER");
  const online = useOnline();
  const [driver, setDriver] = useState<string>("");
  const viewing = driver && driver !== me ? driver : "";

  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useQuery<RunPayload>({
    queryKey: ["/api/my-run", viewing],
    queryFn: async () => {
      const res = await apiFetch(`/api/my-run${viewing ? `?driver=${encodeURIComponent(viewing)}` : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await readError(res, "Could not load the run"));
      return (await res.json()) as RunPayload;
    },
    enabled: Boolean(me),
    refetchInterval: REFRESH_MS,
    retry: 1,
  });

  useEffect(() => {
    if (data && orgId && me) saveRunSnapshot(orgId, me, data);
  }, [data, orgId, me]);

  const snapshot = useMemo(
    () => (!data && !viewing && orgId && me ? readRunSnapshot(orgId, me) : null),
    [data, viewing, orgId, me],
  );
  const run: RunPayload | null = data ?? snapshot?.run ?? null;
  const fromCopy = !data && Boolean(snapshot);
  const readOnly = Boolean(run?.viewingOther);

  // ---- queued taps
  const [queue, setQueue] = useState<QueuedRunTap[]>(() => readRunQueue());
  const myTaps = useMemo(() => (orgId && me ? tapsFor(queue, orgId, me) : []), [queue, orgId, me]);
  const updateQueue = useCallback((next: QueuedRunTap[]) => {
    writeRunQueue(next);
    setQueue(next);
  }, []);
  const replaying = useRef(false);
  const replay = useCallback(
    async (force = false) => {
      if (replaying.current || !orgId || !me) return;
      replaying.current = true;
      try {
        const before = readRunQueue();
        if (tapsFor(before, orgId, me).length === 0) return;
        const after = await replayRunTaps(before, { orgId, userId: me }, apiFetch, { force });
        updateQueue(after);
        if (after.length !== before.length) void refetch();
      } finally {
        replaying.current = false;
      }
    },
    [orgId, me, refetch, updateQueue],
  );
  useEffect(() => {
    if (online) void replay(true);
  }, [online, replay]);
  useEffect(() => {
    const t = window.setInterval(() => void replay(), REPLAY_EVERY_MS);
    return () => window.clearInterval(t);
  }, [replay]);

  // ---- the order of the stops
  const serverStops = useMemo(
    () => (run ? (readOnly ? run.stops : applyQueuedTaps(run.stops, myTaps)) : []),
    [run, myTaps, readOnly],
  );
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  useEffect(() => setLocalOrder(null), [dataUpdatedAt, viewing]);
  const stops = useMemo(() => {
    if (!localOrder) return serverStops;
    const byId = new Map(serverStops.map((s) => [s.id, s]));
    const placed = localOrder.map((id) => byId.get(id)).filter((s): s is RunStop => Boolean(s));
    return [...placed, ...serverStops.filter((s) => !localOrder.includes(s.id))];
  }, [serverStops, localOrder]);

  const [orderNote, setOrderNote] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const saveOrder = useCallback((ids: string[]) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const res = await apiFetch("/api/my-run/order", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds: ids }),
        });
        setOrderNote(res.ok ? null : await readError(res, "Could not save the order of your stops"));
      } catch {
        setOrderNote("Offline: the new order is on this phone only until you are back online and move a stop again.");
      }
    }, 500);
  }, []);
  const reorder = (ids: string[]) => {
    setLocalOrder(ids);
    saveOrder(ids);
  };
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  // ---- selection and Start run
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const readyStops = stops.filter((s) => stopStage(s) === "ready");
  // A stop whose Couldn't deliver tap is still on the phone cannot be started
  // again until that tap has gone: replayed after a new dispatch it would take
  // the live delivery off the road.
  const heldIds = useMemo(() => new Set(splitStartable(stops.map((s) => s.id), myTaps).held), [stops, myTaps]);
  const startableStops = readyStops.filter((s) => !heldIds.has(s.id));
  useEffect(() => {
    // Keep only stops that are still waiting to go.
    setSelected((prev) => new Set([...prev].filter((id) => startableStops.some((s) => s.id === id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startableStops.map((s) => s.id).join(",")]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const startRun = async () => {
    if (!online) {
      setMessage({ kind: "error", text: "Start run needs a connection. Try again when you are back online." });
      return;
    }
    // Checked again against the queue as it is now, not as it was drawn.
    const { start: ids, held } = splitStartable(
      startableStops.filter((s) => selected.has(s.id)).map((s) => s.id),
      tapsFor(readRunQueue(), orgId, me),
    );
    if (ids.length === 0) {
      if (held.length > 0) {
        setMessage({ kind: "error", text: "Those stops have a Couldn't deliver still waiting to send. Start them once it has gone." });
      }
      return;
    }
    setBusy("start");
    setMessage(null);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        const res = await apiFetch(`/api/orders/${id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "out_for_delivery" }),
        });
        if (!res.ok) failed.push(`#${id.slice(0, 8)}: ${await readError(res, "not started")}`);
      } catch {
        failed.push(`#${id.slice(0, 8)}: no connection`);
      }
    }
    setBusy(null);
    setSelected(new Set());
    setMessage(
      failed.length
        ? { kind: "error", text: `Some stops did not start. ${failed.join(" · ")}` }
        : { kind: "ok", text: ids.length === 1 ? "1 stop is out for delivery." : `${ids.length} stops are out for delivery.` },
    );
    void refetch();
  };

  // ---- Delivered / Couldn't deliver: sent now, or kept on the phone
  const tap = async (stop: RunStop, kind: QueuedRunTap["kind"], reason?: CouldntDeliverReason, note?: string) => {
    const queued: QueuedRunTap = {
      id: newTapId(),
      orgId,
      userId: me,
      orderId: stop.id,
      shortCode: stop.shortCode,
      kind,
      ...(reason ? { reason } : {}),
      ...(note ? { note } : {}),
      tappedAt: new Date().toISOString(),
    };
    const keep = (text: string) => {
      updateQueue(enqueueRunTap(readRunQueue(), queued));
      setMessage({ kind: "ok", text });
    };
    if (!online) {
      keep(`Saved on this phone: #${stop.shortCode} will be sent when you are back online.`);
      return true;
    }
    setBusy(stop.id);
    setMessage(null);
    try {
      const res =
        kind === "delivered"
          ? await apiFetch(`/api/orders/${stop.id}/transition`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // The same tapId as the queued copy, so a replay after a lost answer is known for what it is.
              body: JSON.stringify({ action: "complete", label: "delivered", tapId: queued.id }),
            })
          : await apiFetch(`/api/orders/${stop.id}/couldnt-deliver`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason, note: note ?? "" }),
            });
      if (!res.ok) {
        if (res.status >= 500) {
          keep(`The server did not answer: #${stop.shortCode} is saved on this phone and will be sent again.`);
          return true;
        }
        setMessage({ kind: "error", text: await readError(res, "That did not go through") });
        return false;
      }
      setMessage({
        kind: "ok",
        text: kind === "delivered" ? `#${stop.shortCode} delivered.` : `#${stop.shortCode} is back to ready. The managers have been told.`,
      });
      void refetch();
      return true;
    } catch {
      keep(`No connection: #${stop.shortCode} is saved on this phone and will be sent when you are back online.`);
      return true;
    } finally {
      setBusy(null);
    }
  };

  const platform = useMemo(
    () => (typeof navigator === "undefined" ? "google" : mapsPlatformFor(navigator.userAgent, navigator.maxTouchPoints ?? 0)),
    [],
  );
  const timezone = run?.timezone ?? "Europe/London";
  const waiting = myTaps.filter((t) => t.state !== "refused");
  const refused = myTaps.filter((t) => t.state === "refused");

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6 pb-28" data-testid="my-run-page">
      <PageHeader
        icon={Truck}
        title="My run"
        question="Where am I going next?"
        explanation="Your deliveries that are ready or on the road, in your order. Move stops to change it; it is kept for today."
      />

      {manager && run?.drivers && (
        <div className="space-y-1">
          <Label htmlFor="my-run-driver">Whose run</Label>
          <select
            id="my-run-driver"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
            value={viewing || me}
            onChange={(e) => setDriver(e.target.value === me ? "" : e.target.value)}
            data-testid="select-run-driver"
          >
            {run.drivers.map((d) => (
              <option key={d.userId} value={d.userId}>
                {d.userId === me ? `${d.name} (me)` : d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {(!online || fromCopy) && (
        <div role="status" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="my-run-offline">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            {fromCopy && snapshot
              ? `Showing your run as last loaded at ${formatTimeOfDay(new Date(snapshot.savedAt), timezone)}. `
              : "You are offline. "}
            Delivered and Couldn't deliver are kept on this phone and sent when you are back online. Start run and Call need a
            connection.
          </p>
        </div>
      )}

      {(waiting.length > 0 || refused.length > 0) && (
        <div className="space-y-2 rounded-md border border-border p-3 text-sm" data-testid="my-run-queue">
          {waiting.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <p>
                {waiting.length === 1 ? "1 tap" : `${waiting.length} taps`} waiting to send
                {waiting.map((t) => ` · #${t.shortCode}`).join("")}
              </p>
              <Button size="touch" variant="outline" onClick={() => void replay(true)} disabled={!online}>
                Send now
              </Button>
            </div>
          )}
          {refused.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-2 text-destructive">
              <p>
                #{t.shortCode} was not accepted: {t.lastError}
              </p>
              <Button
                size="touch"
                variant="ghost"
                onClick={() => updateQueue(readRunQueue().filter((q) => q.id !== t.id))}
                data-testid={`button-dismiss-tap-${t.shortCode}`}
              >
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-foreground"}
          data-testid="my-run-message"
        >
          {message.text}
        </p>
      )}
      {orderNote && <p className="text-sm text-muted-foreground">{orderNote}</p>}

      {isLoading && !run ? (
        <p className="text-sm text-muted-foreground">Loading your run…</p>
      ) : !run ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{isError ? (error as Error).message : "Could not load the run."}</p>
          <Button size="touch" variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : stops.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="my-run-empty">
          {readOnly ? `${run.driver.name} has no deliveries ready or on the road.` : "No deliveries ready or on the road for you."}
        </p>
      ) : (
        <ol className="space-y-3" data-testid="my-run-stops">
          {stops.map((stop, index) => (
            <li
              key={stop.id}
              draggable={!readOnly}
              onDragStart={() => setDragFrom(index)}
              onDragOver={(e) => {
                if (!readOnly) e.preventDefault();
              }}
              onDrop={() => {
                if (dragFrom != null) reorder(reorderIds(stops.map((s) => s.id), dragFrom, index));
                setDragFrom(null);
              }}
              className="rounded-lg border border-border bg-card p-3"
              data-testid={`run-stop-${stop.shortCode}`}
            >
              <StopCard
                stop={stop}
                position={index + 1}
                count={stops.length}
                timezone={timezone}
                readOnly={readOnly}
                online={online}
                busy={busy === stop.id}
                held={heldIds.has(stop.id)}
                selected={selected.has(stop.id)}
                onSelect={(on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(stop.id);
                    else next.delete(stop.id);
                    return next;
                  })
                }
                onMove={(delta) => reorder(moveStop(stops.map((s) => s.id), stop.id, delta))}
                navigateUrl={mapsUrl(stop, platform)}
                onDelivered={() => tap(stop, "delivered")}
                onCouldntDeliver={(reason, note) => tap(stop, "couldnt_deliver", reason, note)}
              />
            </li>
          ))}
        </ol>
      )}

      {!readOnly && startableStops.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center gap-2">
            <Button
              variant="outline"
              size="touch"
              onClick={() => setSelected(new Set(startableStops.map((s) => s.id)))}
              data-testid="button-select-all-ready"
            >
              Select all
            </Button>
            <Button
              size="touch"
              className="flex-1"
              disabled={selected.size === 0 || busy === "start"}
              onClick={() => void startRun()}
              data-testid="button-start-run"
            >
              {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Truck className="h-4 w-4" aria-hidden />}
              Start run{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StopCard({
  stop,
  position,
  count,
  timezone,
  readOnly,
  online,
  busy,
  held,
  selected,
  onSelect,
  onMove,
  navigateUrl,
  onDelivered,
  onCouldntDeliver,
}: {
  stop: RunStop;
  position: number;
  count: number;
  timezone: string;
  readOnly: boolean;
  online: boolean;
  busy: boolean;
  /** A tap for this stop is still waiting to send: it cannot be started yet. */
  held: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  navigateUrl: string | null;
  onDelivered: () => Promise<boolean>;
  onCouldntDeliver: (reason: CouldntDeliverReason, note: string) => Promise<boolean>;
}) {
  const out = stopStage(stop) === "out";
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState<CouldntDeliverReason | null>(null);
  const [note, setNote] = useState("");
  const needsNote = reason === "other" && note.trim().length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        {!readOnly && (
          <span className="mt-1 hidden cursor-grab text-muted-foreground sm:block" aria-hidden>
            <GripVertical className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {position}. #{stop.shortCode}
            </span>
            <span>{out ? "Out for delivery" : "Ready"}</span>
            {stop.dueAt && <span>Due {formatTimeOfDay(stop.dueAt, timezone)}</span>}
          </p>
          <p className="text-base font-semibold text-foreground">{stop.customerName ?? "No name"}</p>
          <p className="flex items-start gap-1 text-sm text-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{[stop.deliveryAddress, stop.deliveryPostcode].filter(Boolean).join(", ") || "No address on the order"}</span>
          </p>
          {stop.deliveryNotes && <p className="text-sm text-muted-foreground">{stop.deliveryNotes}</p>}
          <p className="text-sm text-muted-foreground">
            {stop.itemCount === 1 ? "1 item" : `${stop.itemCount} items`}
            {stop.onTick > 0 && (
              <span className="ml-2 font-medium text-foreground" data-testid={`run-stop-tick-${stop.shortCode}`}>
                Unpaid, on tick: {money(stop.onTick)}
              </span>
            )}
          </p>
          {stop.deliveryIssue && (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400" data-testid={`run-stop-issue-${stop.shortCode}`}>
              {stop.deliveryIssue}
              {stop.deliveryIssueAt ? ` (${formatTimeOfDay(stop.deliveryIssueAt, timezone)})` : ""}
            </p>
          )}
        </div>
        {!readOnly && !out && held && (
          <span className="shrink-0 text-xs text-muted-foreground" data-testid={`run-stop-held-${stop.shortCode}`}>
            Waiting to send
          </span>
        )}
        {!readOnly && !out && !held && (
          <label className="flex h-11 w-11 shrink-0 items-center justify-center" title="Include in Start run">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
              aria-label={`Include #${stop.shortCode} in Start run`}
              data-testid={`checkbox-run-stop-${stop.shortCode}`}
            />
          </label>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {navigateUrl && (
          <Button asChild variant="outline" size="touch">
            <a href={navigateUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-navigate-${stop.shortCode}`}>
              <Navigation className="h-4 w-4" aria-hidden />
              Navigate
            </a>
          </Button>
        )}
        {!readOnly && out && stop.hasCustomer && <CallButton orderId={stop.id} online={online} />}
        {!readOnly && (
          <>
            <Button
              variant="ghost"
              size="touch"
              onClick={() => onMove(-1)}
              disabled={position === 1}
              aria-label={`Move #${stop.shortCode} up`}
              data-testid={`button-move-up-${stop.shortCode}`}
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="touch"
              onClick={() => onMove(1)}
              disabled={position === count}
              aria-label={`Move #${stop.shortCode} down`}
              data-testid={`button-move-down-${stop.shortCode}`}
            >
              <ArrowDown className="h-4 w-4" aria-hidden />
            </Button>
          </>
        )}
      </div>

      {!readOnly && out && !failing && (
        <div className="grid grid-cols-2 gap-2">
          <Button size="touch" onClick={() => void onDelivered()} disabled={busy} data-testid={`button-delivered-${stop.shortCode}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            Delivered
          </Button>
          <Button
            size="touch"
            variant="outline"
            onClick={() => setFailing(true)}
            disabled={busy}
            data-testid={`button-couldnt-deliver-${stop.shortCode}`}
          >
            <XCircle className="h-4 w-4" aria-hidden />
            Couldn't deliver
          </Button>
        </div>
      )}

      {!readOnly && out && failing && (
        <form
          className="space-y-2 rounded-md border border-border p-2"
          data-testid={`form-couldnt-deliver-${stop.shortCode}`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!reason || needsNote) return;
            const ok = await onCouldntDeliver(reason, note.trim());
            if (ok) {
              setFailing(false);
              setReason(null);
              setNote("");
            }
          }}
        >
          <p className="text-sm font-medium">Why not?</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Reason">
            {COULDNT_DELIVER_REASONS.map((r) => (
              <Button
                key={r.key}
                type="button"
                size="touch"
                variant={reason === r.key ? "default" : "outline"}
                aria-pressed={reason === r.key}
                onClick={() => setReason(r.key)}
                data-testid={`chip-reason-${r.key}`}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <div>
            <Label htmlFor={`run-note-${stop.id}`}>{reason === "other" ? "What happened (needed)" : "Note (optional)"}</Label>
            <Textarea
              id={`run-note-${stop.id}`}
              rows={2}
              maxLength={COULDNT_DELIVER_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="submit" size="touch" disabled={!reason || needsNote || busy} data-testid={`button-send-couldnt-deliver-${stop.shortCode}`}>
              Back to ready
            </Button>
            <Button type="button" size="touch" variant="outline" onClick={() => setFailing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * The driver's call: the existing logged reveal (POST
 * /api/orders/:id/customer-phone). The number lives in this component's state
 * only — never the query cache, the run copy on the phone or the service
 * worker — and is gone when the stop leaves the screen.
 */
function CallButton({ orderId, online }: { orderId: string; online: boolean }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setPhone(null);
    setError(null);
  }, [orderId]);

  const reveal = async () => {
    if (!online) {
      setError("Call needs a connection.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/orders/${orderId}/customer-phone`, { method: "POST", cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? "Could not show the number");
      setPhone(body.phone as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not show the number");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {phone ? (
        <Button asChild variant="outline" size="touch">
          <a href={`tel:${phone}`} data-testid="button-call-customer">
            <Phone className="h-4 w-4" aria-hidden />
            {phone}
          </a>
        </Button>
      ) : (
        <Button variant="outline" size="touch" onClick={() => void reveal()} disabled={loading} data-testid="button-show-customer-phone">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Phone className="h-4 w-4" aria-hidden />}
          Call
        </Button>
      )}
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </>
  );
}
