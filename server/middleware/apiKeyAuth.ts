/**
 * Bearer-token (API key) authentication middleware for the /v1 public API.
 * Sets req.apiKeyContext = { orgId, scopes } on success.
 * Responds 401/403 on failure.
 */
import type { RequestHandler } from "express";
import { storage } from "../storage";

export type ApiKeyContext = {
  orgId: string;
  scopes: string[];
};

declare module "express-serve-static-core" {
  interface Request {
    apiKeyContext?: ApiKeyContext;
  }
}

/** Resolve Bearer token from Authorization header and attach context. */
export const requireApiKey: RequestHandler = async (req, res, next) => {
  const auth = req.headers.authorization ?? "";
  const match = auth.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Authorization: Bearer <api_key> header required",
    });
  }
  const verified = await storage.verifyApiKeyAndGetOrg(match[1]).catch(() => null);
  if (!verified) {
    return res.status(403).json({ error: "forbidden", message: "Invalid or revoked API key" });
  }
  req.apiKeyContext = verified;
  return next();
};

/** Check that the authenticated key has the required scope. */
export function requireScope(scope: string): RequestHandler {
  return (req, res, next) => {
    const ctx = req.apiKeyContext;
    if (!ctx) return res.status(401).json({ error: "unauthorized", message: "No API key context" });
    if (!ctx.scopes.includes(scope) && !ctx.scopes.includes("*")) {
      return res.status(403).json({
        error: "forbidden",
        message: `API key missing required scope: ${scope}`,
      });
    }
    return next();
  };
}
