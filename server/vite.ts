import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import type { Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

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

export async function setupVite(app: Express, server: Server) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("setupVite must not run when NODE_ENV=production");
  }

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      const base = (viteConfig as { base?: string }).base ?? "/";
      const scriptSrc = `${base}src/main.tsx`.replace(/\/+/g, "/");
      template = template.replace(
        `src="${base}src/main.tsx"`,
        `src="${scriptSrc}?v=${nanoid()}"`,
      );
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="${scriptSrc}?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
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
