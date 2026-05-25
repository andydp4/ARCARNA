import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { validateProductionEnv } from "./validateProductionEnv";

validateProductionEnv();

const app = express();

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
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

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  let workerInstance: any = null;
  
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, async () => {
    log(`serving on port ${port}`);
    
    // Start analytics worker if database is available (non-blocking)
    if (process.env.DATABASE_URL) {
      try {
        const workerModule = await import('../apps/server/src/workers/analytics.worker');
        workerInstance = workerModule.analyticsWorker;
        await workerInstance.start();
        log('Analytics worker started');
      } catch (error) {
        // Worker is optional - app works without it
        log('Analytics worker not available (non-critical)');
      }
      
      // Start event-driven worker runner
      try {
        const { startWorkerRunner } = await import('./workers');
        startWorkerRunner({
          dispatchIntervalMs: 1000,
          processIntervalMs: 200,
          concurrency: 3,
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
    if (workerInstance) {
      try {
        workerInstance.stop();
      } catch (error) {
        // Ignore shutdown errors
      }
    }
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
