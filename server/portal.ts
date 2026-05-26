import express, { type Express, type Request, type Response } from "express";
import fs from "fs";
import path from "path";

function portalDir(): string {
  return path.resolve(process.cwd(), "dist", "portal");
}

export function registerPortalRoutes(app: Express): void {
  const dir = portalDir();
  if (!fs.existsSync(dir)) {
    console.warn(`[portal] Missing ${dir} — run npm run build:portal`);
    return;
  }

  const page = (file: string) => (_req: Request, res: Response) => {
    res.sendFile(path.join(dir, file));
  };

  app.get("/", page("index.html"));
  app.get("/files", page("files.html"));
  app.get("/files/", page("files.html"));
  app.get("/backups", page("backups.html"));
  app.get("/backups/", page("backups.html"));
  app.use("/portal-assets", express.static(path.join(dir, "portal-assets")));
}
