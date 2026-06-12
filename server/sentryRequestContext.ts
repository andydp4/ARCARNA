import type { RequestHandler } from "express";
import type { RequestWithId } from "./requestId";

/** Attach request_id (and basic HTTP context) to Sentry so Issues correlate with structured logs. */
export const sentryRequestContextMiddleware: RequestHandler = (
  req: RequestWithId,
  _res,
  next,
) => {
  if (!process.env.SENTRY_DSN?.trim()) {
    return next();
  }

  void import("@sentry/node")
    .then((Sentry) => {
      Sentry.withIsolationScope((scope) => {
        const requestId = req.requestId ?? "unknown";
        scope.setTag("request_id", requestId);
        scope.setContext("request", {
          requestId,
          method: req.method,
          path: req.path,
        });
        next();
      });
    })
    .catch(() => next());
};
