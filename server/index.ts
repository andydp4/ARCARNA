import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { applySecurityMiddleware, mountTieredApiRateLimits } from "./security";
import { serveStatic, log } from "./static";
import { validateProductionEnv } from "./validateProductionEnv";
import { IMPORT_JSON_BODY_LIMIT } from "@shared/importLimits";
import { APP_BASE_PATH } from "./appBase";
import { registerPortalRoutes } from "./portal";
import { registerLegacyEposRedirects, registerDefaultLegacyBasePathRedirects } from "./legacyRedirects";
import { withAppBase } from "@shared/appPaths";
import { BRAND_PRODUCT_NAME } from "@shared/brand";
import { requestIdMiddleware, type RequestWithId } from "./requestId";
import { sentryRequestContextMiddleware } from "./sentryRequestContext";
import { logApiJson } from "./structuredLog";

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

/** Behind reverse proxies (Nginx, Fly, etc.) so rate limits use client IP. */
if (isProduction) {
  app.set("trust proxy", 1);
}

applySecurityMiddleware(app, isProduction);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(requestIdMiddleware);
app.use(sentryRequestContextMiddleware);
app.use(
  express.json({
    limit: IMPORT_JSON_BODY_LIMIT,
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: IMPORT_JSON_BODY_LIMIT }));

app.use((req: RequestWithId, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      logApiJson({
        msg: "http_request",
        requestId: req.requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: duration,
        responseSnippet:
          capturedJsonResponse !== undefined
            ? JSON.stringify(capturedJsonResponse).slice(0, 200)
            : undefined,
      });
    } else {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });

  next();
});

process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection:", reason);
});

(async () => {
  registerPortalRoutes(app);
  registerLegacyEposRedirects(app, APP_BASE_PATH);
  registerDefaultLegacyBasePathRedirects(app, APP_BASE_PATH);

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

  mountTieredApiRateLimits(eposApp, isProduction);

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

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? Number((err as { status?: number }).status) || 500
        : typeof err === "object" && err !== null && "statusCode" in err
          ? Number((err as { statusCode?: number }).statusCode) || 500
          : 500;
    const message =
      err instanceof Error ? err.message : "Internal Server Error";
    console.error("[express] Request error:", err);
    if (process.env.SENTRY_DSN?.trim()) {
      import("@sentry/node")
        .then((Sentry) => Sentry.captureException(err))
        .catch(() => {});
    }
    if (!res.headersSent) {
      res.status(status).json({ message });
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
    reusePort: true,
  }, async () => {
    log(`serving on port ${port} (portal at /, ${BRAND_PRODUCT_NAME} at ${mount || "/"})`);
    
    if (process.env.DATABASE_URL) {
      // domain_outbox / analytics.worker deprecated — use event_outbox + server/workers/*
      
      // Start event-driven worker runner
      try {
        const { startWorkerRunner } = await import('./workers');
        const dispatchMs = Number(process.env.WORKER_DISPATCH_INTERVAL_MS ?? 1000);
        const processMs = Number(process.env.WORKER_PROCESS_INTERVAL_MS ?? 200);
        const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 3);
        startWorkerRunner({
          dispatchIntervalMs: dispatchMs > 0 ? dispatchMs : 1000,
          processIntervalMs: processMs > 0 ? processMs : 200,
          concurrency: concurrency > 0 ? concurrency : 3,
        });
        log('Event-driven worker runner started');
      } catch (error) {
        log('Event-driven worker runner not available (non-critical)');
      }
      
      // Start reconciliation job for stuck events
      try {
        const { startReconciliationJob } = await import('./eventBus');
        startReconciliationJob(5 * 60 * 1000); // Every 5 minutes
        log('Reconciliation job started');
      } catch (error) {
        log('Reconciliation job not available (non-critical)');
      }
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
    // Stop reconciliation job
    try {
      const { stopReconciliationJob } = await import('./eventBus');
      stopReconciliationJob();
    } catch (error) {
      // Ignore shutdown errors
    }
    process.exit(0);
  });
})();
