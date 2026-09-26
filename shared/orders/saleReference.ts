/**
 * The till's sale reference and how a till sends a sale (v1.2 Phase 1A).
 *
 * Shared by the till (which makes the reference and decides what to do when a
 * send fails) and the server (which enforces one order per reference per org),
 * so the two cannot disagree about what a valid reference is.
 */

/** A uuid from the till, or anything similar: letters, digits, `-` and `_`. */
const CLIENT_ORDER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidClientOrderId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_ORDER_ID_RE.test(value);
}

/**
 * How long the till waits for the server before asking "did it land?".
 * It was 5 seconds, which a slow shop connection often exceeded while the
 * sale was in fact being recorded — the till then queued it as offline.
 */
export const SALE_SUBMIT_TIMEOUT_MS = 12_000;

/** The "did it land?" check is a small read; it gets a shorter wait. */
export const SALE_LANDED_CHECK_TIMEOUT_MS = 5_000;

/** First retry after 30 seconds, doubling, never more than 15 minutes apart. */
export const SALE_RETRY_BASE_MS = 30_000;
export const SALE_RETRY_MAX_MS = 15 * 60_000;

/** Wait before the next send, after `attempts` failed sends (1 = the first failed). */
export function nextSaleRetryDelayMs(attempts: number): number {
  const n = Math.max(1, Math.floor(Number.isFinite(attempts) ? attempts : 1));
  // 2^20 already dwarfs the cap; stop the exponent there so it stays finite.
  const delay = SALE_RETRY_BASE_MS * 2 ** Math.min(n - 1, 20);
  return Math.min(delay, SALE_RETRY_MAX_MS);
}

/**
 * What a failed send means for a queued sale.
 *
 * `retry`: nothing was decided — no connection, a timeout, the server busy or
 * broken, or the session needing a fresh sign-in. The sale waits and is sent
 * again. `refused`: the server looked at the sale and said no. Sending the same
 * thing again will get the same answer, so it goes to a manager instead.
 */
export type SaleSendOutcome = "retry" | "refused";

export function classifySaleSendFailure(httpStatus: number | null | undefined): SaleSendOutcome {
  if (httpStatus == null || !Number.isFinite(httpStatus)) return "retry";
  if (httpStatus >= 500) return "retry";
  // 401/403: signed out or the session lapsed — not a verdict on the sale.
  // 408/425/429: the server asked to be tried again later.
  if ([401, 403, 408, 425, 429].includes(httpStatus)) return "retry";
  if (httpStatus >= 400) return "refused";
  return "retry";
}

/** "2 waiting · 1 failed", leaving out a part that is zero. Empty when both are. */
export function formatSaleQueueStatus(waiting: number, failed: number): string {
  const parts: string[] = [];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}
