/**
 * Request logging, error-body scrubbing and 5xx reporting (UXA-03, FIX-11).
 *
 * The old middleware logged the first 200 characters of every /api JSON
 * response (and the whole body for non-/api paths). For GET /api/customers
 * that is a customer's name, phone and email, written to PM2 log files that
 * were never rotated. Now:
 *  - no response bodies are logged; a 4xx/5xx logs only its `code` and a
 *    redacted `message`;
 *  - paths are logged as templates (ids -> :id);
 *  - every JSON error body passes through scrubErrorResponseBody, so database
 *    text never reaches the browser whichever catch produced it;
 *  - every 5xx is sent to Sentry, including the ~200 route catches that
 *    answer res.status(500) themselves and so never reach the global handler.
 */
import type { NextFunction, Response } from "express";
import type { RequestWithId } from "./requestId";
import { logApiJson } from "./structuredLog";
import { log } from "./static";
import { scrubErrorResponseBody } from "./lib/errorScrub";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIdSegment(seg: string): boolean {
  if (!seg) return false;
  if (UUID_RE.test(seg)) return true;
  if (/^\d+$/.test(seg)) return true;
  // nanoid / cuid style ids: long, and mixing letters with digits.
  return seg.length >= 12 && /\d/.test(seg) && /[a-z]/i.test(seg) && /^[\w-]+$/.test(seg);
}

/** `/api/orders/3f1c…/refund` -> `/api/orders/:id/refund`. */
export function pathTemplate(path: string): string {
  return path
    .split("/")
    .map((seg) => (isIdSegment(seg) ? ":id" : seg))
    .join("/");
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// UK-ish phone numbers: +44 / 0 prefixed, 10-11 digits with optional spaces.
const PHONE_RE = /(?:\+44\s?|\b0)(?:\d[\s-]?){9,10}\b/g;
const POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;

export function redactPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]")
    .replace(POSTCODE_RE, "[postcode]");
}

export interface ErrorSummary {
  code?: string;
  message?: string;
}

/** What may be logged from an error body: its code and a short, redacted message. */
export function summariseErrorBody(body: unknown): ErrorSummary | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as { code?: unknown; error?: unknown; message?: unknown };
  const code = typeof b.code === "string" ? b.code : typeof b.error === "string" && b.error.length <= 64 ? b.error : undefined;
  const message = typeof b.message === "string" ? redactPii(b.message).slice(0, 200) : undefined;
  if (code === undefined && message === undefined) return undefined;
  return { code, message };
}

type SentryLike = {
  captureMessage: (msg: string, ctx?: Record<string, unknown>) => unknown;
};

let sentryPromise: Promise<SentryLike | null> | null = null;
function sentry(): Promise<SentryLike | null> {
  if (!process.env.SENTRY_DSN?.trim()) return Promise.resolve(null);
  sentryPromise ??= import("@sentry/node").then((m) => m as unknown as SentryLike).catch(() => null);
  return sentryPromise;
}

/** Set by the global error handler after it has already captured the exception. */
export const SENTRY_CAPTURED = "sentryCaptured";

export function report5xx(details: {
  method: string;
  pathTemplate: string;
  status: number;
  requestId?: string;
  error?: ErrorSummary;
}): void {
  void sentry().then((S) => {
    S?.captureMessage("http_5xx", {
      level: "error",
      tags: {
        path_template: details.pathTemplate,
        status: String(details.status),
        method: details.method,
        request_id: details.requestId ?? "unknown",
      },
      extra: { code: details.error?.code, message: details.error?.message },
      // Group by route, not by request id.
      fingerprint: ["http_5xx", details.method, details.pathTemplate, String(details.status)],
    });
  });
}

export function httpLogMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const start = Date.now();
  const path = req.path;
  let errorSummary: ErrorSummary | undefined;

  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (res.statusCode >= 400) {
      body = scrubErrorResponseBody(body, req.requestId);
      errorSummary = summariseErrorBody(body);
    }
    return originalJson(body);
  } as Response["json"];

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const template = pathTemplate(path);
    const status = res.statusCode;
    if (path.startsWith("/api") || path.includes("/api/")) {
      logApiJson({
        msg: "http_request",
        requestId: req.requestId,
        method: req.method,
        path: template,
        status,
        durationMs,
        ...(status >= 400 && errorSummary
          ? { errorCode: errorSummary.code, errorMessage: errorSummary.message }
          : {}),
      });
    } else {
      log(`${req.method} ${template} ${status} in ${durationMs}ms`);
    }
    if (status >= 500 && !res.locals[SENTRY_CAPTURED]) {
      report5xx({ method: req.method, pathTemplate: template, status, requestId: req.requestId, error: errorSummary });
    }
  });

  next();
}
