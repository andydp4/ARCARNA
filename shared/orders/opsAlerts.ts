/**
 * The Operations Centre's alert rules — pure, synchronous, and `now`-injected
 * like every other timing rule in this phase (`shared/orders/opsState.ts`,
 * `docs/testing/FAKE_TIME.md`).
 *
 * This module answers three questions no database is needed for:
 *  - WHO gets an alert of a given kind, given the order, the assignee and the
 *    station's presence (docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "Alerts &
 *    notifications" table);
 *  - WHETHER a time-based kind (`due_soon`, `new_unassigned`) is due yet, or
 *    should be skipped by one of the table's own carve-outs (a short prep
 *    window, the loader still being at the till);
 *  - WHAT `due_key` an alert cycles on, so a revised promise creates a fresh
 *    row instead of colliding with the unique index.
 *
 * `server/services/opsAlerts.ts` is the only caller today (`createInTx`'s
 * transactional kinds and `sweepOpsAlerts`'s time-based ones) — it owns the
 * database reads (staff presence, org settings) and calls straight back into
 * these functions with plain values. `chimeFor` has no caller yet: it exists
 * for N5b's client audio, written now so its rule is unit-tested before any
 * UI reads it (the same pattern N4a's `useOpsAlerts.ts` stub already set).
 */

/** The six alert kinds the brief's table defines. */
export const OPS_ALERT_KINDS = [
  "assigned",
  "new_unassigned",
  "customer_waiting",
  "due_soon",
  "late",
  "delayed",
] as const;

export type OpsAlertKind = (typeof OPS_ALERT_KINDS)[number];

export type OpsAlertStation = "" | "collection" | "delivery" | "both";

/** One row `createInTx`/`sweepOpsAlerts` is about to insert. */
export interface AlertRecipient {
  userId: string;
  /** '' = addressed personally to the assignee (pulse only); a station name = the station-wide broadcast (chimes). */
  station: OpsAlertStation;
}

/** What recipient resolution needs about one member of staff. */
export interface OpsStaffPresence {
  userId: string;
  station: "collection" | "delivery" | "both" | null;
  onBreak: boolean;
  /** Seen within the 15-minute presence window (brief, "Stations & presence"). */
  present: boolean;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * `due_key`: the ISO of the instant an alert was computed from, so a revised
 * promise (or a fresh incident on the same order) starts a new cycle instead
 * of colliding with `ops_alerts_once_idx`. `null`/missing collapses to `''`
 * — the column's own default, meaning "no cycle" (never used for a kind that
 * needs one; every caller below always has an instant to hand).
 */
export function dueKeyFor(instant: Date | string | null | undefined): string {
  const d = toDate(instant);
  return d ? d.toISOString() : "";
}

/**
 * Station members eligible for a STATION alert: on that station (or Both),
 * not on a break, ever (brief, "Assignment" → "on break ... removes the
 * person from recipients"). Presence then narrows that list to who has been
 * seen in the last 15 minutes — falling back to everyone on the station when
 * nobody has, so a quiet shop still gets told rather than nobody at all
 * (brief, "Stations & presence": "else everyone on the station").
 */
export function stationRecipients(
  fulfilmentMethod: "collection" | "delivery",
  staff: OpsStaffPresence[],
): OpsStaffPresence[] {
  const onStation = staff.filter(
    (s) => !s.onBreak && (s.station === fulfilmentMethod || s.station === "both"),
  );
  const present = onStation.filter((s) => s.present);
  return present.length > 0 ? present : onStation;
}

/**
 * `assigned` — brief: "the new assignee (not on self-claim, and not the
 * inputter when the default-owner rule picks them)". A self-claim is exactly
 * `assigneeId === actorId` (the person taking the order IS the actor); the
 * default-owner carve-out is the same shape one step removed (the ORDER's
 * inputter, picked automatically rather than by their own tap) — both reduce
 * to "the person about to be told already knows, because they just did it or
 * it was done in their own name automatically".
 */
export function shouldAlertAssigned(params: {
  assigneeId: string;
  actorId: string | null;
  isDefaultOwnerPick: boolean;
  inputUserId: string | null;
}): boolean {
  if (params.assigneeId === params.actorId) return false;
  if (params.isDefaultOwnerPick && params.assigneeId === params.inputUserId) return false;
  return true;
}

/** `assigned`'s one recipient — a thin wrapper so call sites never build the `AlertRecipient` shape by hand. */
export function assignedRecipient(assigneeId: string): AlertRecipient {
  return { userId: assigneeId, station: "" };
}

/**
 * `new_unassigned` — brief: "60 s after `received`, still unclaimed; skipped
 * for the first 5 min while the loader is present". `ageSeconds` and
 * `loaderPresent` are the caller's own facts (received-at arithmetic and a
 * staff presence lookup); this function is the pure decision alone so its
 * three branches (too new, loader still there, due) are each one assertion.
 */
export function shouldAlertNewUnassigned(params: { ageSeconds: number; loaderPresent: boolean }): boolean {
  if (params.ageSeconds < 60) return false;
  if (params.loaderPresent && params.ageSeconds < 5 * 60) return false;
  return true;
}

/** `new_unassigned`'s recipients: present members of the lane's station (brief). */
export function newUnassignedRecipients(
  fulfilmentMethod: "collection" | "delivery",
  staff: OpsStaffPresence[],
): AlertRecipient[] {
  return stationRecipients(fulfilmentMethod, staff).map((s) => ({ userId: s.userId, station: fulfilmentMethod }));
}

/** `customer_waiting` — brief: "assignee, else present Collection members". */
export function customerWaitingRecipients(
  assigneeId: string | null,
  staff: OpsStaffPresence[],
): AlertRecipient[] {
  if (assigneeId) return [{ userId: assigneeId, station: "" }];
  return stationRecipients("collection", staff).map((s) => ({ userId: s.userId, station: "collection" }));
}

/**
 * `due_soon` — brief: "skipped when promise − received ≤ lead + 2 min". A
 * promise made barely ahead of the lead time would fire "due soon" the
 * moment it was taken, which tells nobody anything they don't already know.
 */
export function shouldAlertDueSoon(params: { receivedAt: Date; dueAt: Date; leadMinutes: number }): boolean {
  const windowMinutes = (params.dueAt.getTime() - params.receivedAt.getTime()) / 60_000;
  return windowMinutes > params.leadMinutes + 2;
}

/**
 * `due_soon` / `late` recipients — brief: "assignee (pulse only), else
 * station (chime)"; `late` additionally: "also station when the assignee is
 * absent 15 min". `due_soon` never widens to the station on top of an
 * assigned order — only `late` does, via `assigneePresent`.
 *
 * The assignee's own row always carries `station: ''` (pulse only, never
 * chimes — see `chimeFor`); a station row is only added when there is no
 * assignee, or (late only) the assignee has been away 15 minutes.
 */
export function dueSoonOrLateRecipients(params: {
  kind: "due_soon" | "late";
  assigneeId: string | null;
  /** Only consulted for `late`'s "assignee absent 15 min" widening. */
  assigneePresent: boolean;
  fulfilmentMethod: "collection" | "delivery";
  staff: OpsStaffPresence[];
}): AlertRecipient[] {
  const recipients: AlertRecipient[] = [];
  if (params.assigneeId) {
    recipients.push({ userId: params.assigneeId, station: "" });
  }
  const needsStation = !params.assigneeId || (params.kind === "late" && !params.assigneePresent);
  if (needsStation) {
    for (const s of stationRecipients(params.fulfilmentMethod, params.staff)) {
      if (s.userId === params.assigneeId) continue; // already has the personal row above
      recipients.push({ userId: s.userId, station: params.fulfilmentMethod });
    }
  }
  return recipients;
}

/** `delayed` — brief: "assignee, when someone else declared it". */
export function delayedRecipients(assigneeId: string | null, actorId: string | null): AlertRecipient[] {
  if (!assigneeId || assigneeId === actorId) return [];
  return [{ userId: assigneeId, station: "" }];
}

// ---------------------------------------------------------------- chime policy

/** What `chimeFor` needs about one delivered (unacked, unresolved) alert row. */
export interface DeliveredAlert {
  kind: OpsAlertKind;
  /** '' = a personal row (the assignee's own `due_soon`/`late` pulse); non-empty = a station broadcast. */
  station: OpsAlertStation;
  createdAt: Date | string;
}

/** Rows older than this pulse but never chime (brief, "Chime policy"). */
const CHIME_MAX_AGE_MS = 2 * 60_000;

/**
 * Highest severity wins, one chime per delivery, at most. Brief, "Chime
 * policy": "customer_waiting > late > assigned > new_unassigned > due_soon";
 * "rows older than 2 min pulse but never chime"; "the assignee's own
 * due_soon / late never chime" — that last rule is `station === ''` on a
 * `due_soon`/`late` row, since those two kinds are the only ones ever
 * addressed personally with no chime (every other kind's personal row still
 * chimes — `assigned` and `customer_waiting`'s "assignee, else station" both
 * chime either way, per the brief's own table).
 *
 * Returns `null` when nothing in `delivered` should chime — silence is the
 * default outcome, not an edge case.
 */
export function chimeFor(delivered: DeliveredAlert[], now: Date): OpsAlertKind | null {
  const eligible = delivered.filter((alert) => {
    const createdAt = toDate(alert.createdAt);
    if (!createdAt || now.getTime() - createdAt.getTime() > CHIME_MAX_AGE_MS) return false;
    if ((alert.kind === "due_soon" || alert.kind === "late") && alert.station === "") return false;
    return true;
  });
  const bySeverity: OpsAlertKind[] = ["customer_waiting", "late", "assigned", "new_unassigned", "due_soon"];
  for (const kind of bySeverity) {
    if (eligible.some((alert) => alert.kind === kind)) return kind;
  }
  return null;
}
