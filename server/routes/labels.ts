/**
 * Settings → Labels: the shop's label template settings.
 *
 * GET is open to every member of staff — every till reads it to print the
 * same labels. PUT is manager and above, like the receipt template editor.
 */
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { recordAdminAudit } from "../adminAudit";
import { requireRole } from "../auth";
import { labelSettingsInputSchema, mergeLabelSettings, normalizeLabelSettings } from "@shared/labelSettings";

export function registerLabelRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/labels/settings", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrgProfile(ctx.orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json(normalizeLabelSettings(org.labelSettings));
    } catch (error) {
      console.error("[Labels] get settings:", error);
      res.status(500).json({ message: "Failed to fetch label settings" });
    }
  });

  app.put("/api/labels/settings", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const patch = labelSettingsInputSchema.parse(req.body ?? {});
      const org = await storage.getOrgProfile(ctx.orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const next = mergeLabelSettings(org.labelSettings, patch);
      await storage.updateOrgProfile(ctx.orgId, { labelSettings: next });
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: ctx.role,
        orgId: ctx.orgId,
        action: "label.settings.updated",
        targetType: "organization",
        targetId: ctx.orgId,
      });
      res.json(next);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid label settings", errors: error.errors });
      }
      console.error("[Labels] update settings:", error);
      res.status(500).json({ message: "Failed to update label settings" });
    }
  });
}
