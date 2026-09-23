/**
 * The shop's customer privacy notice and complaints contact, readable without
 * signing in (PRV-15): a shop customer must be able to see how their data is
 * used before they sign in or order, and a receipt links here. Only what the
 * owner chose to publish is returned. The org comes from the shop site's
 * WM_SUPPLIES_ORG_ID, or from ?orgId= on a receipt link.
 */
import type { Express, Request, RequestHandler } from "express";
import { z } from "zod";
import { APP_BASE_PATH } from "../appBase";
import { withAppBase } from "@shared/appPaths";
import { shopPrivacyFromOrg } from "@shared/shopPrivacy";

const uuidSchema = z.string().uuid();

export function resolvePrivacyOrgId(req: Request): string | null {
  const envOrgId =
    process.env.WM_SUPPLIES_ORG_ID?.trim() || process.env.WM_SUPPLIES_WEBSITE_ORG_ID?.trim() || "";
  if (envOrgId && uuidSchema.safeParse(envOrgId).success) return envOrgId;
  const raw = String(req.query.orgId ?? "").trim();
  return raw && uuidSchema.safeParse(raw).success ? raw : null;
}

/** Absolute URL of arcarna's page that shows the owner's privacy notice text. */
export function privacyTextPageUrl(orgId: string): string {
  const base = process.env.VITE_APP_URL?.trim()?.replace(/\/$/, "") || "http://localhost:5000";
  return `${base}${withAppBase(APP_BASE_PATH, `/privacy?orgId=${encodeURIComponent(orgId)}`)}`;
}

type OrgLookup = (orgId: string) => Promise<Record<string, unknown> | null | undefined>;

export function createPrivacyNoticeHandler(lookup?: OrgLookup): RequestHandler {
  return async (req, res) => {
    try {
      const orgId = resolvePrivacyOrgId(req);
      if (!orgId) return res.status(404).json({ message: "Not found" });
      const getOrg: OrgLookup =
        lookup ?? (async (id) => (await import("../storage")).storage.getOrganization(id) as never);
      const org = await getOrg(orgId);
      if (!org) return res.status(404).json({ message: "Not found" });
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({
        businessName: String(org.tradingName || org.name || ""),
        ...shopPrivacyFromOrg(org as never),
      });
    } catch (error) {
      console.error("[privacy] notice lookup failed:", error);
      res.status(500).json({ message: "Failed to load the privacy notice" });
    }
  };
}

export function registerPrivacyNoticeRoutes(app: Express, lookup?: OrgLookup): void {
  app.get("/api/public/privacy-notice", createPrivacyNoticeHandler(lookup));
}
