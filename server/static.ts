import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { isUnmatchedApiPath, sendApiNotFound } from "./apiNotFound";

/** Built client assets (Vite outDir). PM2 cwd should be repo root. */
export function getDistPublicPath(): string {
  return path.resolve(process.cwd(), "dist", "public");
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * A request the static middleware could not satisfy that is clearly for a
 * built file (anything under /assets/, or a last path segment with a file
 * extension) — not an SPA route. Answering these with index.html and a 200
 * turned every stale chunk after a deploy into "text/html is not a valid
 * JavaScript MIME type", and the service worker then cached that HTML under
 * the chunk's URL. They get a real 404 instead.
 */
export function isMissingStaticFilePath(reqPath: string): boolean {
  if (reqPath.startsWith("/assets/")) return true;
  const last = reqPath.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]{1,8}$/.test(last) && last !== "index.html";
}

export function serveStatic(app: Express, serviceWorkerScope = "/") {
  const distPath = getDistPublicPath();

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Production client build not found at ${distPath}. Run: npm run build`,
    );
  }

  const swScope = serviceWorkerScope.endsWith("/")
    ? serviceWorkerScope
    : `${serviceWorkerScope}/`;

  app.use(
    express.static(distPath, {
      index: false,
      // index:false + redirect:true (default) 301s mounted `/` → `/midnight/` forever (ERR_TOO_MANY_REDIRECTS)
      redirect: false,
      maxAge: "1d",
      setHeaders(res, filePath) {
        if (filePath.endsWith("sw.js")) {
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.setHeader("Service-Worker-Allowed", swScope);
        }
      },
    }),
  );

  // Express 5 / path-to-regexp v8: bare "*" is invalid; pathless middleware catches SPA fallback.
  app.use((req, res, next) => {
    // See apiNotFound.ts: an unmatched /api path is a miss, not a page route.
    // Serving the SPA shell with 200 made a failed call look successful.
    if (isUnmatchedApiPath(req.path)) {
      return sendApiNotFound(res, req.method, req.path);
    }
    if (req.path === "/sw.js" || req.path === "/manifest.json") {
      return res.status(404).type("text/plain").send("Not found — run npm run build");
    }
    if (isMissingStaticFilePath(req.path)) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).type("text/plain").send("Not found");
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
