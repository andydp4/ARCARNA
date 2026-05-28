import type { Request } from "express";

/** Absolute app URL for redirects (Clerk sign-out return URL, etc.). */
export function appUrlFromRequest(req: Request, appPath: string): string {
  const configured = process.env.VITE_APP_URL?.trim()?.replace(/\/$/, "");
  if (configured) return `${configured}${appPath}`;
  const host = req.get("host");
  return `${req.protocol}://${host}${appPath}`;
}
