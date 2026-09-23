/**
 * Sending a till sale, and what happens when it does not go (v1.2 Phase 1A).
 *
 * Every sale carries its reference (`clientOrderId`) from the moment it starts,
 * on every attempt, so the server records it once however many times it is
 * sent. A send that times out while online first asks the server "did it
 * land?"; only if the answer is no (or no answer) is the sale kept on the till.
 * Kept sales are retried with a growing gap, never more than 15 minutes; a
 * sale the server refuses goes to a manager (Needs attention) rather than
 * being retried for ever or dropped.
 */
import {
  SALE_LANDED_CHECK_TIMEOUT_MS,
  SALE_SUBMIT_TIMEOUT_MS,
  classifySaleSendFailure,
  isValidClientOrderId,
  nextSaleRetryDelayMs,
} from "@shared/orders/saleReference";
import { apiFetch } from "./appPaths";

export type QueuedSaleFields = {
  clientOrderId?: string;
  /** Failed sends so far. */
  attempts?: number;
  /** Epoch ms; not sent again before this unless a person asks. */
  nextAttemptAt?: number;
  /** `refused`: the server said no, and it has not reached Needs attention yet. */
  state?: "waiting" | "refused";
  lastError?: string;
  httpStatus?: number | null;
  /** Who was signed in when the sale was rung. It is only ever sent in their name. */
  queuedByUserId?: string;
};

type Mutationish = QueuedSaleFields & { type?: string; synced?: number; timestamp?: number };

export function newClientOrderId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Old WebViews without randomUUID: still unique enough for one org's sales.
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `sale-${Date.now().toString(36)}-${rand()}${rand()}`;
}

/** The reference a queued sale is sent under — its own, or one made now for a sale queued before 1A. */
export function referenceFor(data: { clientOrderId?: unknown } | null | undefined, stored?: string): string | null {
  if (stored && isValidClientOrderId(stored)) return stored;
  const fromData = data?.clientOrderId;
  return isValidClientOrderId(fromData) ? fromData : null;
}

/**
 * A sale rung by someone else who has since signed out waits for them: sent
 * now it would be recorded as this person's sale. (Sales from before 1A carry
 * no name and are sent as before.)
 */
export function isSaleMine(m: Mutationish, activeUserId: string | null): boolean {
  return !m.queuedByUserId || !activeUserId || m.queuedByUserId === activeUserId;
}

export function isSaleDue(m: Mutationish, now: number, force = false): boolean {
  if (m.state === "refused") return true; // only reporting it is left, and that is cheap
  if (force) return true;
  return !m.nextAttemptAt || m.nextAttemptAt <= now;
}

/** What to store after a send that did not record the sale. */
export function afterFailedSend(
  m: Mutationish,
  httpStatus: number | null,
  message: string,
  now: number,
): QueuedSaleFields {
  if (classifySaleSendFailure(httpStatus) === "refused") {
    return { state: "refused", lastError: message, httpStatus };
  }
  const attempts = (m.attempts ?? 0) + 1;
  return {
    state: "waiting",
    attempts,
    nextAttemptAt: now + nextSaleRetryDelayMs(attempts),
    lastError: message,
    httpStatus,
  };
}

/** The body a queued sale is sent with: its reference, and when it was really rung. */
export function replayPayload(data: Record<string, unknown>, timestamp: number, clientOrderId: string) {
  return {
    ...data,
    clientOrderId,
    _offlineOrderReplay: true,
    _offlineQueuedAt: new Date(timestamp).toISOString(),
  };
}

/** Unsent sales on this till: waiting to go, and refused but not yet handed to a manager. */
export function countSaleQueue(mutations: readonly Mutationish[]): { waiting: number; failed: number } {
  let waiting = 0;
  let failed = 0;
  for (const m of mutations) {
    if (m.type !== "ORDER_CREATE" || m.synced) continue;
    if (m.state === "refused") failed += 1;
    else waiting += 1;
  }
  return { waiting, failed };
}

export type SendOutcome =
  | { ok: true; body: any }
  | { ok: false; status: number | null; message: string; timedOut: boolean };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function readMessage(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")) || res.statusText;
  try {
    const body = JSON.parse(text);
    const detail = Array.isArray(body?.details) ? body.details[0]?.message : undefined;
    if (typeof detail === "string" && detail) return detail;
    if (typeof body?.message === "string" && body.message) return body.message;
  } catch {
    /* not JSON */
  }
  return text ? `${res.status}: ${text.slice(0, 300)}` : `HTTP ${res.status}`;
}

async function withTimeout(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ res: Response } | { error: unknown; timedOut: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return { res: await fetcher(url, { ...init, signal: controller.signal }) };
  } catch (error) {
    return { error, timedOut: controller.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

/** POST a sale. Never throws: a network failure or timeout comes back as status null. */
export async function sendSale(
  payload: unknown,
  opts: { timeoutMs?: number; fetcher?: Fetcher } = {},
): Promise<SendOutcome> {
  const attempt = await withTimeout(
    opts.fetcher ?? apiFetch,
    "/api/orders",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    opts.timeoutMs ?? SALE_SUBMIT_TIMEOUT_MS,
  );
  if ("error" in attempt) {
    return {
      ok: false,
      status: null,
      timedOut: attempt.timedOut,
      message: attempt.timedOut ? "arcarna did not answer in time" : "No connection",
    };
  }
  if (!attempt.res.ok) {
    return { ok: false, status: attempt.res.status, timedOut: false, message: await readMessage(attempt.res) };
  }
  return { ok: true, body: await attempt.res.json().catch(() => ({})) };
}

/**
 * "Did it land?" — asked after a send timed out. `landed` carries the order
 * the server recorded; `unknown` means the question itself got no answer.
 */
export async function checkSaleLanded(
  clientOrderId: string,
  opts: { timeoutMs?: number; fetcher?: Fetcher } = {},
): Promise<{ result: "landed"; body: any } | { result: "not_found" } | { result: "unknown" }> {
  const attempt = await withTimeout(
    opts.fetcher ?? apiFetch,
    `/api/orders/by-reference/${encodeURIComponent(clientOrderId)}`,
    { method: "GET" },
    opts.timeoutMs ?? SALE_LANDED_CHECK_TIMEOUT_MS,
  );
  if ("error" in attempt || !attempt.res.ok) return { result: "unknown" };
  const body = await attempt.res.json().catch(() => null);
  if (body?.found === true) return { result: "landed", body };
  if (body?.found === false) return { result: "not_found" };
  return { result: "unknown" };
}

/** Hand a sale to Needs attention. True once the server holds it (or already recorded it). */
export async function reportSaleIssue(
  input: {
    clientOrderId: string;
    payload: Record<string, unknown>;
    reason: string;
    httpStatus?: number | null;
    queuedAt?: number;
    source?: "refused" | "signed_out";
    rungByUserId?: string;
  },
  opts: { fetcher?: Fetcher } = {},
): Promise<boolean> {
  const attempt = await withTimeout(
    opts.fetcher ?? apiFetch,
    "/api/sale-issues",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientOrderId: input.clientOrderId,
        payload: input.payload,
        reason: input.reason.slice(0, 2000) || "Refused",
        httpStatus: input.httpStatus ?? null,
        queuedAt: input.queuedAt ? new Date(input.queuedAt).toISOString() : null,
        source: input.source ?? "refused",
        ...(input.rungByUserId ? { rungByUserId: input.rungByUserId } : {}),
      }),
    },
    SALE_SUBMIT_TIMEOUT_MS,
  );
  return !("error" in attempt) && attempt.res.ok;
}
