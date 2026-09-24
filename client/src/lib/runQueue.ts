/**
 * My run offline (v1.2): the last loaded run, and Delivered / Couldn't deliver
 * taps made with no connection.
 *
 * Follows the till's sale queue (saleQueue.ts, v1.2 Phase 1A) rather than
 * sharing its IndexedDB store, which is built around whole sales: each tap
 * carries who made it and when, is sent only in that person's name, retried
 * with the same growing gap (never more than 15 minutes), and one the server
 * refuses is shown with its reason instead of being retried for ever.
 * Start run and Call are not queued: they need the server's answer there and
 * then, so the page blocks them offline and says so.
 *
 * Kept in localStorage, per org and person. The copy of the run holds names
 * and addresses — what every member of staff sees on the board while a
 * delivery is live (Q8a) — and never a phone number. Sign-out removes it.
 */
import { nextSaleRetryDelayMs } from "@shared/orders/saleReference";
import { deliveryIssueNote, type CouldntDeliverReason, type RunPayload, type RunStop } from "@shared/orders/myRun";

export const RUN_SNAPSHOT_PREFIX = "arcarna.myRun.snapshot.";
export const RUN_QUEUE_KEY = "arcarna.myRun.queue";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The last loaded run.
// ---------------------------------------------------------------------------

export type RunSnapshot = { savedAt: number; run: RunPayload };

export function snapshotKey(orgId: string, userId: string): string {
  return `${RUN_SNAPSHOT_PREFIX}${orgId}.${userId}`;
}

/** Only your own run is kept: a manager looking at someone else's leaves nothing behind. */
export function saveRunSnapshot(orgId: string, userId: string, run: RunPayload, now = Date.now(), store = storage()): void {
  if (!store || run.viewingOther) return;
  const { drivers: _drivers, ...own } = run;
  try {
    store.setItem(snapshotKey(orgId, userId), JSON.stringify({ savedAt: now, run: own } satisfies RunSnapshot));
  } catch {
    /* full or blocked: the page still works online */
  }
}

export function readRunSnapshot(orgId: string, userId: string, store = storage()): RunSnapshot | null {
  if (!store) return null;
  try {
    const raw = store.getItem(snapshotKey(orgId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunSnapshot;
    return parsed && Array.isArray(parsed.run?.stops) ? parsed : null;
  } catch {
    return null;
  }
}

/** Sign-out and session end: every person's copy of their run goes. */
export function clearRunSnapshots(store = storage()): void {
  if (!store) return;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(RUN_SNAPSHOT_PREFIX)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
}

// ---------------------------------------------------------------------------
// Queued taps.
// ---------------------------------------------------------------------------

export type QueuedRunTap = {
  id: string;
  orgId: string;
  /** Who tapped. Sent only while they are the one signed in. */
  userId: string;
  orderId: string;
  shortCode: string;
  kind: "delivered" | "couldnt_deliver";
  reason?: CouldntDeliverReason;
  note?: string;
  /** When it was tapped: Delivered sends it as the actual time, Couldn't deliver as the note's time. */
  tappedAt: string;
  attempts?: number;
  nextAttemptAt?: number;
  state?: "waiting" | "refused";
  lastError?: string;
};

export function readRunQueue(store = storage()): QueuedRunTap[] {
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(RUN_QUEUE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeRunQueue(queue: QueuedRunTap[], store = storage()): void {
  if (!store) return;
  try {
    if (queue.length === 0) store.removeItem(RUN_QUEUE_KEY);
    else store.setItem(RUN_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* nothing more can be done on this device */
  }
}

/** One tap per order: a second tap on the same stop replaces the first. */
export function enqueueRunTap(queue: readonly QueuedRunTap[], tap: QueuedRunTap): QueuedRunTap[] {
  return [...queue.filter((t) => !(t.orgId === tap.orgId && t.userId === tap.userId && t.orderId === tap.orderId)), tap];
}

export function tapsFor(queue: readonly QueuedRunTap[], orgId: string, userId: string): QueuedRunTap[] {
  return queue.filter((t) => t.orgId === orgId && t.userId === userId);
}

/** The request a tap is sent as — the same routes the page uses online. */
export function runTapRequest(tap: QueuedRunTap): { url: string; body: Record<string, unknown> } {
  if (tap.kind === "delivered") {
    return {
      url: `/api/orders/${tap.orderId}/transition`,
      // tapId ties the replay to this one tap: if it already completed the
      // order (the answer was lost) and a manager has since reopened it, the
      // server refuses rather than completing it again under the old time.
      body: { action: "complete", label: "delivered", actualAt: tap.tappedAt, tapId: tap.id },
    };
  }
  return {
    url: `/api/orders/${tap.orderId}/couldnt-deliver`,
    body: { reason: tap.reason ?? "other", note: tap.note ?? "", tappedAt: tap.tappedAt },
  };
}

/**
 * What a failed send means. No answer, the server busy, or signed out: try
 * again later. Any other 4xx is the server's verdict (reassigned, already
 * back to ready): stop and show it.
 */
export function runTapFailure(httpStatus: number | null): "retry" | "refused" {
  if (httpStatus == null || httpStatus >= 500) return "retry";
  if ([401, 408, 425, 429].includes(httpStatus)) return "retry";
  return httpStatus >= 400 ? "refused" : "retry";
}

/**
 * A Delivered that arrives after someone else already completed the order has
 * nothing left to do: the order is where the driver said it was.
 */
export function isAlreadyDone(tap: QueuedRunTap, httpStatus: number | null, code: string | undefined, message: string): boolean {
  if (tap.kind !== "delivered" || httpStatus !== 409) return false;
  // This very tap already completed the order (and it has been reopened since).
  if (code === "TAP_ALREADY_APPLIED") return true;
  return code === "ORDER_TRANSITION_INVALID" && /completed order/i.test(message);
}

/**
 * Start run must not send a stop out again while a Couldn't deliver tap for
 * it is still waiting: the tap would replay after the new dispatch and take a
 * live delivery off the road. Splits the chosen stops into those safe to
 * start and those held until their tap has gone.
 */
export function splitStartable(
  ids: readonly string[],
  taps: readonly QueuedRunTap[],
): { start: string[]; held: string[] } {
  const waiting = new Set(taps.filter((t) => t.state !== "refused").map((t) => t.orderId));
  return { start: ids.filter((id) => !waiting.has(id)), held: ids.filter((id) => waiting.has(id)) };
}

export function afterFailedTap(tap: QueuedRunTap, httpStatus: number | null, message: string, now: number): QueuedRunTap {
  if (runTapFailure(httpStatus) === "refused") return { ...tap, state: "refused", lastError: message };
  const attempts = (tap.attempts ?? 0) + 1;
  return { ...tap, state: "waiting", attempts, nextAttemptAt: now + nextSaleRetryDelayMs(attempts), lastError: message };
}

export function isTapDue(tap: QueuedRunTap, now: number, force = false): boolean {
  if (tap.state === "refused") return false;
  return force || !tap.nextAttemptAt || tap.nextAttemptAt <= now;
}

/**
 * The run as the driver should see it with taps still waiting: a Delivered
 * stop is gone, a Couldn't deliver stop is back to ready with its note.
 */
export function applyQueuedTaps(stops: readonly RunStop[], taps: readonly QueuedRunTap[]): RunStop[] {
  const waiting = new Map(taps.filter((t) => t.state !== "refused").map((t) => [t.orderId, t]));
  const out: RunStop[] = [];
  for (const stop of stops) {
    const tap = waiting.get(stop.id);
    if (!tap) out.push(stop);
    else if (tap.kind === "couldnt_deliver") {
      out.push({
        ...stop,
        outForDeliveryAt: null,
        deliveryIssue: deliveryIssueNote(tap.reason ?? "other", tap.note),
        deliveryIssueAt: tap.tappedAt,
      });
    }
  }
  return out;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Sends this person's due taps, oldest first. Returns the queue as it now
 * stands; the caller writes it back. One at a time, so a tap refused by the
 * server cannot race the one after it.
 */
export async function replayRunTaps(
  queue: readonly QueuedRunTap[],
  who: { orgId: string; userId: string },
  send: Fetcher,
  opts: { now?: number; force?: boolean } = {},
): Promise<QueuedRunTap[]> {
  const now = opts.now ?? Date.now();
  let next = [...queue];
  for (const tap of queue) {
    if (tap.orgId !== who.orgId || tap.userId !== who.userId) continue;
    if (!isTapDue(tap, now, opts.force)) continue;
    const { url, body } = runTapRequest(tap);
    let status: number | null = null;
    let message = "No connection";
    let code: string | undefined;
    try {
      const res = await send(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        next = next.filter((t) => t.id !== tap.id);
        continue;
      }
      status = res.status;
      const json = await res.json().catch(() => null);
      message = typeof json?.message === "string" ? json.message : `HTTP ${res.status}`;
      code = typeof json?.code === "string" ? json.code : undefined;
    } catch {
      /* no answer: retried later */
    }
    if (isAlreadyDone(tap, status, code, message)) {
      next = next.filter((t) => t.id !== tap.id);
      continue;
    }
    next = next.map((t) => (t.id === tap.id ? afterFailedTap(t, status, message, now) : t));
  }
  return next;
}

export function newTapId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `tap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
