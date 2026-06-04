import express, { type Express } from "express";
import fs from "fs";
import path from "path";

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

  app.use("*", (req, res, next) => {
    if (req.path === "/sw.js" || req.path === "/manifest.json") {
      return res.status(404).type("text/plain").send("Not found — run npm run build");
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
