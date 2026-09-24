import express, { type Request, Response, NextFunction } from "express";
import { trustProxySetting } from "./lib/trustProxy";
import { registerUuidParamGuards } from "./lib/uuidParams";
import compression from "compression";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import {
  apiResponseHardening,
  applySecurityMiddleware,
  createJsonBodyParser,
  mountTieredApiRateLimits,
  rejectCrossSiteMutations,
} from "./security";
import { serveStatic, log } from "./static";
import { validateProductionEnv } from "./validateProductionEnv";
import { APP_BASE_PATH } from "./appBase";
import { registerLegacyEposRedirects, registerDefaultLegacyBasePathRedirects } from "./legacyRedirects";
import { withAppBase } from "@shared/appPaths";
import { BRAND_PRODUCT_NAME } from "@shared/brand";
import { requestIdMiddleware, type RequestWithId } from "./requestId";
import { sentryRequestContextMiddleware } from "./sentryRequestContext";
import { httpLogMiddleware, SENTRY_CAPTURED } from "./httpLog";
import { genericServerMessage, safeErrorMessage } from "./lib/errorScrub";

validateProductionEnv();

if (process.env.SENTRY_DSN?.trim()) {
  import("@sentry/node")
    .then((Sentry) => {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV ?? "development",
        tracesSampleRate: Math.min(
          1,
          Math.max(0, Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0)),
        ),
      });
    })
    .catch(() => {});
}

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const isWmSuppliesCustomerSite = process.env.WM_SUPPLIES_CUSTOMER_SITE === "1";
const workersEnabled =
  process.env.WORKERS_ENABLED !== "0" && process.env.DISABLE_WORKERS !== "1";

/** Behind reverse proxies (Nginx, Fly, etc.) so rate limits use client IP. */
if (isProduction) {
  app.set("trust proxy", trustProxySetting());
}

applySecurityMiddleware(app, isProduction);
app.use(compression());

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(requestIdMiddleware);
app.use(sentryRequestContextMiddleware);
// JSON bodies only (v1.2.1 SEC-CSRF-FORM): nothing inbound is form-encoded,
// and parsing application/x-www-form-urlencoded let a plain HTML form on
// another site post to the API. The 25 MB import limit applies to the import
// and bulk routes alone (SEC-BODY-PREAUTH): every other route is parsed with
// a small limit, so an anonymous caller cannot make the server parse 25 MB
// before auth refuses it.
app.use(createJsonBodyParser(APP_BASE_PATH));

app.use(httpLogMiddleware);

process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection:", reason);
});

(async () => {
  if (!isWmSuppliesCustomerSite) {
    // The Viger portal is a separate project (repo: andydp4/VigerPortal), served
    // statically by nginx on viger.cloud — it is no longer served by this app.
    registerLegacyEposRedirects(app, APP_BASE_PATH);
    registerDefaultLegacyBasePathRedirects(app, APP_BASE_PATH);
  }

  // Root-level aliases for bookmarks / old links that omit APP_BASE_PATH
  if (APP_BASE_PATH) {
    app.get("/api/login", (_req, res) => {
      res.redirect(302, withAppBase(APP_BASE_PATH, "/sign-in"));
    });
    app.get("/api/logout", (_req, res) => {
      res.redirect(302, withAppBase(APP_BASE_PATH, "/api/logout"));
    });
  }

  const eposApp = express();

  eposApp.use(apiResponseHardening);
  mountTieredApiRateLimits(eposApp, isProduction);
  eposApp.use(rejectCrossSiteMutations);
  registerUuidParamGuards(eposApp);

  await registerRoutes(eposApp);

  const mount = APP_BASE_PATH || "/";
  if (APP_BASE_PATH) {
    // Redirect ONLY bare `/midnight` (no trailing slash) to `/midnight/`.
    // Using `req.originalUrl` (not the route pattern) avoids Express's default
    // "trailing slash insensitive" matching, which previously caused requests
    // to `/midnight/` to be 301-redirected to themselves → ERR_TOO_MANY_REDIRECTS.
    // 302 (not 301) so browsers don't cache the redirect aggressively.
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      const url = req.originalUrl;
      if (url === APP_BASE_PATH) {
        return res.redirect(302, `${APP_BASE_PATH}/`);
      }
      const qIdx = url.indexOf("?");
      if (qIdx === APP_BASE_PATH.length) {
        return res.redirect(302, `${APP_BASE_PATH}/${url.slice(qIdx)}`);
      }
      return next();
    });
  }
  app.use(mount, eposApp);

  const server = createServer(app);

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? Number((err as { status?: number }).status) || 500
        : typeof err === "object" && err !== null && "statusCode" in err
          ? Number((err as { statusCode?: number }).statusCode) || 500
          : 500;
    const requestId = (req as RequestWithId).requestId;
    // A 4xx from middleware (bad JSON, payload too large) keeps its own text
    // unless it reads like database output; a 5xx never echoes the error.
    const message =
      status >= 500
        ? genericServerMessage(requestId)
        : safeErrorMessage(err, "Request could not be processed");
    console.error("[express] Request error:", err);
    if (process.env.SENTRY_DSN?.trim()) {
      res.locals[SENTRY_CAPTURED] = true;
      import("@sentry/node")
        .then((Sentry) => Sentry.captureException(err, { tags: { request_id: requestId ?? "unknown" } }))
        .catch(() => {});
    }
    if (!res.headersSent) {
      res.status(status).json({ message, ...(requestId ? { requestId } : {}) });
    }
  });

  const swScope = APP_BASE_PATH ? withAppBase(APP_BASE_PATH, "/") : "/";

  if (isProduction) {
    serveStatic(eposApp, swScope);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(eposApp, server);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: process.platform === "linux",
  }, async () => {
    log(`serving on port ${port} (${BRAND_PRODUCT_NAME} at ${mount || "/"})`);
    
    if (process.env.DATABASE_URL && workersEnabled) {
      // domain_outbox / analytics.worker deprecated — use event_outbox + server/workers/*
      
      // Start event-driven worker runner.
      // The runner is now idle-aware: it polls fast while there is work and backs
      // off toward WORKER_IDLE_CEILING_MS when idle so Neon compute can scale to
      // zero. Reconciliation and the scheduled-report / RFM / cashier auto-close
      // tasks run as coarse housekeeping inside the same loop (no separate timers).
      try {
        const { startWorkerRunner } = await import('./workers');
        const processMs = Number(process.env.WORKER_PROCESS_INTERVAL_MS ?? 250);
        const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 3);
        const idleCeilingMs = Number(process.env.WORKER_IDLE_CEILING_MS ?? 15 * 60 * 1000);
        const housekeepingMs = Number(process.env.WORKER_HOUSEKEEPING_INTERVAL_MS ?? 15 * 60 * 1000);
        startWorkerRunner({
          processIntervalMs: processMs > 0 ? processMs : 250,
          concurrency: concurrency > 0 ? concurrency : 3,
          idleCeilingMs: idleCeilingMs > 0 ? idleCeilingMs : 15 * 60 * 1000,
          housekeepingIntervalMs: housekeepingMs > 0 ? housekeepingMs : 15 * 60 * 1000,
        });
        log('Event-driven worker runner started (idle-aware)');
      } catch (error) {
        log('Event-driven worker runner not available (non-critical)');
      }
    } else if (process.env.DATABASE_URL) {
      log("Background workers disabled for this process");
    }
  });
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    log('SIGTERM received, shutting down gracefully...');
    // Stop event-driven worker runner
    try {
      const { stopWorkerRunner } = await import('./workers');
      stopWorkerRunner();
    } catch (error) {
      // Ignore shutdown errors
    }
    process.exit(0);
  });
})();
