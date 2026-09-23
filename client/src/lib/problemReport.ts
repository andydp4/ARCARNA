/**
 * The till's side of the "Problem?" button (v1.2 Phase 8A, UXA-09).
 *
 * Kept free of React and the Sentry SDK so the rules (device name, what a
 * report carries, keeping it until the till is back online) can be unit
 * tested. Every storage read and write tolerates storage being unavailable.
 */
import { STORAGE_DEVICE_NAME, STORAGE_PROBLEM_QUEUE } from "@shared/storageKeys";
import {
  isDeviceName,
  screenFor,
  UNNAMED_DEVICE,
  type DeviceName,
  type ProblemChip,
  type ProblemReportInput,
} from "@shared/problemReports";

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Fired on window when the device name changes, so Sentry's tag follows. */
export const DEVICE_NAME_EVENT = "arcarna:device-name";
/** Fired on window to open the Problem? sheet from anywhere. */
export const OPEN_PROBLEM_EVENT = "arcarna:problem-open";

export function openProblemSheet(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_PROBLEM_EVENT));
}

export function deviceName(store: KeyValueStore | null = browserStore()): DeviceName | null {
  try {
    const v = store?.getItem(STORAGE_DEVICE_NAME);
    return isDeviceName(v) ? v : null;
  } catch {
    return null;
  }
}

export function deviceTag(store: KeyValueStore | null = browserStore()): string {
  return deviceName(store) ?? UNNAMED_DEVICE;
}

export function setDeviceName(name: DeviceName | null, store: KeyValueStore | null = browserStore()): void {
  try {
    if (name && isDeviceName(name)) store?.setItem(STORAGE_DEVICE_NAME, name);
    else store?.removeItem(STORAGE_DEVICE_NAME);
  } catch {
    /* storage unavailable: the device stays "Not named" */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEVICE_NAME_EVENT));
}

export function makeClientRef(random: () => number = Math.random, now: number = Date.now()): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return `p${now.toString(36)}-${out}`;
}

export type ProblemContext = {
  path: string;
  search: string;
  device: string | null;
  appVersion: string;
  online: boolean;
  queue: { waiting: number; failed: number; needsAttention: number };
};

export function buildProblemReport(
  chip: ProblemChip,
  note: string,
  ctx: ProblemContext,
  opts: { clientRef?: string; now?: Date } = {},
): ProblemReportInput {
  const trimmed = note.trim();
  return {
    clientRef: opts.clientRef ?? makeClientRef(),
    chip,
    note: trimmed ? trimmed : null,
    // Shaped on the till too, so the raw URL (a search, an id) never leaves it.
    screen: screenFor(ctx.path, ctx.search),
    device: ctx.device,
    appVersion: ctx.appVersion,
    online: ctx.online,
    queue: ctx.queue,
    reportedAt: (opts.now ?? new Date()).toISOString(),
  };
}

type Queued = { orgId: string | null; report: ProblemReportInput };

/** At most this many reports wait on one device; the oldest go first. */
export const PROBLEM_QUEUE_MAX = 20;

export function queuedProblems(store: KeyValueStore | null = browserStore()): Queued[] {
  try {
    const raw = store?.getItem(STORAGE_PROBLEM_QUEUE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((q) => q && typeof q === "object" && q.report) : [];
  } catch {
    return [];
  }
}

function saveQueue(list: Queued[], store: KeyValueStore | null): void {
  try {
    if (list.length === 0) store?.removeItem(STORAGE_PROBLEM_QUEUE);
    else store?.setItem(STORAGE_PROBLEM_QUEUE, JSON.stringify(list.slice(-PROBLEM_QUEUE_MAX)));
  } catch {
    /* storage unavailable: the report is lost, which the sheet says */
  }
}

export function queueProblem(orgId: string | null, report: ProblemReportInput, store: KeyValueStore | null = browserStore()): void {
  saveQueue([...queuedProblems(store), { orgId, report }], store);
}

/** The server answered, and said no (or not now). */
export class ProblemSendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Worth keeping and sending later: no network (fetch throws a TypeError), a
 * server that is down, or "slow down". A 4xx refusal will not change on retry.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ProblemSendError) return error.status === 429 || error.status >= 500;
  return true;
}

/**
 * Send what is waiting for this org. Sent reports and ones the server refused
 * outright (a 4xx other than rate limiting) leave the queue; network failures
 * stay for next time. Another org's reports wait until that org is chosen.
 */
export async function flushProblemQueue(
  orgId: string | null,
  send: (report: ProblemReportInput) => Promise<void>,
  store: KeyValueStore | null = browserStore(),
): Promise<number> {
  const list = queuedProblems(store);
  const keep: Queued[] = [];
  let sent = 0;
  for (const q of list) {
    if (q.orgId !== orgId) {
      keep.push(q);
      continue;
    }
    try {
      await send(q.report);
      sent++;
    } catch (e) {
      if (isRetryable(e)) keep.push(q);
    }
  }
  saveQueue(keep, store);
  return sent;
}
