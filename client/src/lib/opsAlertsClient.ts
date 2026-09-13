import { chimeFor, type DeliveredAlert, type OpsAlertKind } from "@shared/orders/opsAlerts";
import { STORAGE_OPS_CHIMED, STORAGE_OPS_SOUND } from "@shared/storageKeys";
import type { OpsBoardAlert } from "@/hooks/useOpsBoard";
import { apiRequest } from "./queryClient";

/**
 * The Operations Centre alert rail's client-side plumbing (Phase N, N5b):
 * acknowledging a row server-side, the cross-tab chime dedupe, and the
 * per-device mute preference. `useOpsAlerts.ts` is the React wiring over this
 * — everything here is plain functions so it can be unit-tested (and reused
 * by a future surface, should one ever want its own ack button) without a
 * component tree.
 *
 * What this file deliberately does NOT do: decide who gets an alert, when a
 * time-based one falls due, or which kind wins a chime. Those are
 * `shared/orders/opsAlerts.ts`'s `chimeFor` (N5a, already unit-tested) —
 * `chimeDecisionFor` below only adds the one thing `chimeFor` cannot know on
 * its own, which alert ROW to mark in the cross-tab dedupe set, since
 * `chimeFor` answers with a KIND, not an id.
 */

// --------------------------------------------------------------- acknowledging

export interface AckAlertResult {
  id: string;
  ackedAt: string;
  /** False on a repeat ack of an already-acked row — same idempotent shape the server reports. */
  changed: boolean;
}

/** `PATCH /api/operations/alerts/:id/ack` (server/routes/opsAlerts.ts, N5a) — own rows only, idempotent. */
export async function ackOpsAlert(id: string): Promise<AckAlertResult> {
  const response = await apiRequest("PATCH", `/api/operations/alerts/${id}/ack`);
  return response.json();
}

// ------------------------------------------------------------------- chime policy

/**
 * `chimeFor` (shared/orders/opsAlerts.ts) picks a KIND, at most one per
 * delivery. This picks the one delivered row of that kind that stands for
 * it, purely so callers have a concrete alert id to hand `hasChimed` /
 * `markChimed` below — `chimeFor` itself never needs to know an id exists.
 */
export interface ChimeDecision {
  kind: OpsAlertKind;
  /** The delivered row that produced this decision — the cross-tab dedupe key. */
  alertId: string;
}

/**
 * `delivered` must already be narrowed to the alerts NEW in this delivery
 * (`useOpsAlerts.ts` tracks that) — handing this every currently-open alert
 * on every render would re-chime a row that has been sitting there, unacked,
 * for the last ten minutes, which is exactly what "at most one chime per
 * delivery" (brief, "Chime policy") rules out.
 */
export function chimeDecisionFor(delivered: OpsBoardAlert[], now: Date): ChimeDecision | null {
  const mapped: DeliveredAlert[] = delivered.map((alert) => ({
    kind: alert.kind,
    station: alert.station,
    createdAt: alert.createdAt,
  }));
  const kind = chimeFor(mapped, now);
  if (!kind) return null;
  const alert = delivered.find((a) => a.kind === kind);
  // Cannot happen — `chimeFor` only ever returns a kind present in what it
  // was handed — but a chime with no row to blame is worse than one that
  // silently does nothing.
  if (!alert) return null;
  return { kind, alertId: alert.id };
}

// -------------------------------------------------------- cross-tab chime dedupe

/**
 * How many acknowledged-as-chimed ids `STORAGE_OPS_CHIMED` keeps. Alert ids
 * are never reused (`ops_alerts.id` is a fresh uuid every time, even for the
 * same order — see `dueKeyFor`'s own doc comment), so this is a plain FIFO
 * cap against the jar growing forever across a long shift, not a real cache.
 */
const MAX_CHIMED_IDS = 300;

function readChimedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_OPS_CHIMED);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeChimedIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_OPS_CHIMED, JSON.stringify(ids.slice(-MAX_CHIMED_IDS)));
  } catch {
    /* private mode, or storage disabled — this tab just chimes on its own every time */
  }
}

/** Has ANY tab of this browser already chimed for this alert row? (brief: "no leader election".) */
export function hasChimed(alertId: string): boolean {
  return readChimedIds().includes(alertId);
}

/** Records that a tab chimed for this alert row, so a sibling tab's own delivery skips it. */
export function markChimed(alertId: string): void {
  const ids = readChimedIds();
  if (ids.includes(alertId)) return;
  writeChimedIds([...ids, alertId]);
}

// ------------------------------------------------------------------- mute preference

/** `STORAGE_OPS_SOUND` — per-device, defaults to sound ON (a silent counter alerts nobody). */
export function isOpsSoundMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_OPS_SOUND) === "muted";
  } catch {
    return false;
  }
}

export function setOpsSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_OPS_SOUND, muted ? "muted" : "on");
  } catch {
    /* private mode, or storage disabled — the toggle just resets on reload */
  }
}
