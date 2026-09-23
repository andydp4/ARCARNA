/**
 * Keep database internals out of API responses (FIX-11).
 *
 * Drizzle wraps driver errors as "Failed query: <SQL> params: <values>", and
 * Postgres errors name tables, columns and constraints. Route catches used to
 * send `error.message` straight back, so a till toast could show the SQL and
 * the parameters — which include customer data from the same request.
 *
 * Two layers:
 *  - scrubErrorResponseBody(): a safety net applied to EVERY JSON error
 *    response (server/index.ts), replacing database text with a plain message
 *    and the request's reference.
 *  - sendServerError(): what a route catch should call for a 5xx.
 * scripts/audit-db-error-echo.mjs (CI) refuses new `status(5xx).json({ …
 * error.message })` echoes.
 */
import type { Response } from "express";

const DB_TEXT_PATTERNS: RegExp[] = [
  /Failed query:/i,
  /\bparams:\s/i,
  /relation "[^"]*" does not exist/i,
  /column "[^"]*" (of relation "[^"]*" )?does not exist/i,
  /violates (foreign key|unique|not-null|check|exclusion) constraint/i,
  /duplicate key value/i,
  /null value in column/i,
  /syntax error at or near/i,
  /invalid input (syntax|value) for (type|enum)/i,
  /value too long for type/i,
  /out of range for type/i,
  /deadlock detected/i,
  /could not serialize access/i,
  /current transaction is aborted/i,
  /password authentication failed/i,
  /terminating connection/i,
  /Connection terminated/i,
  /\bECONNREFUSED\b/,
  // SQL as drizzle/pg print it (quoted identifiers), not English like
  // "select a customer from the list".
  /\bselect\s+(distinct\s+)?("|\*|count\(|coalesce\(|sum\()/i,
  /\binsert into\s+"/i,
  /\bupdate\s+"[^"]+"\s+set\b/i,
  /\bdelete from\s+"/i,
  /"[a-z_]+"\."[a-z_]+"/i, // "table"."column"
];

export function looksLikeDatabaseErrorText(text: unknown): boolean {
  if (typeof text !== "string" || !text) return false;
  return DB_TEXT_PATTERNS.some((re) => re.test(text));
}

/** A pg DatabaseError, a DrizzleQueryError, or anything whose text reads like one. */
export function isDatabaseError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; severity?: unknown; query?: unknown; message?: unknown; cause?: unknown };
  if (e.name === "DrizzleQueryError" || typeof e.query === "string") return true;
  if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) && typeof e.severity === "string") return true;
  if (looksLikeDatabaseErrorText(e.message)) return true;
  return e.cause !== undefined && e.cause !== err ? isDatabaseError(e.cause) : false;
}

export function genericServerMessage(reference?: string): string {
  return reference
    ? `Something went wrong on our side. Reference: ${reference}`
    : "Something went wrong on our side.";
}

/**
 * The message a catch may show a person: the error's own text when it is a
 * plain domain message, otherwise the fallback. Never database text.
 */
export function safeErrorMessage(err: unknown, fallback: string): string {
  const message = err && typeof err === "object" ? (err as { message?: unknown }).message : undefined;
  if (typeof message !== "string" || !message.trim() || isDatabaseError(err)) return fallback;
  return message;
}

const SCRUBBED_KEYS = ["message", "error", "detail", "details", "hint"] as const;

/**
 * Replace database text in an error body. Returns the same object when there
 * is nothing to scrub. Only string fields are inspected; `errors`/`details`
 * arrays from zod validation carry field names, not SQL, and pass through
 * unless a string inside reads like SQL.
 */
export function scrubErrorResponseBody<T>(body: T, reference?: string): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const src = body as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const key of SCRUBBED_KEYS) {
    const value = src[key];
    const dirty =
      looksLikeDatabaseErrorText(value) ||
      (Array.isArray(value) && value.some((v) => looksLikeDatabaseErrorText(typeof v === "string" ? v : (v as { message?: unknown })?.message)));
    if (!dirty) continue;
    out ??= { ...src };
    if (key === "message") out.message = genericServerMessage(reference);
    else delete out[key];
  }
  if (!out) return body;
  if (typeof out.message !== "string") out.message = genericServerMessage(reference);
  if (reference) out.requestId = reference;
  return out as T;
}

/** Send a 5xx without echoing the error. Logs the real error server-side. */
export function sendServerError(
  res: Response,
  err: unknown,
  fallback: string,
  opts: { status?: number; log?: string; extra?: Record<string, unknown> } = {},
): void {
  if (opts.log !== undefined) console.error(opts.log, err);
  const reference = (res.req as { requestId?: string } | undefined)?.requestId;
  if (res.headersSent) return;
  res.status(opts.status ?? 500).json({
    ...(opts.extra ?? {}),
    message: fallback,
    ...(reference ? { requestId: reference } : {}),
  });
}
