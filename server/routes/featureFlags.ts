import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { recordAdminAudit } from "../adminAudit";
import {
  assertKnownFlag,
  invalidateFeatureFlagCache,
} from "../featureFlags";
import { KNOWN_FEATURE_FLAGS } from "@shared/featureFlags";
import { storage } from "../storage";

export function registerFeatureFlagRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/feature-flags", ...scoped, async (req: any, res) => {
    try {
      const orgId = req.orgContext.orgId as string;
      const rows = await storage.listFeatureFlagsForOrg(orgId);
      const byFlag = new Map(rows.map((r) => [r.flag, r.enabled]));
      type FlagDto = {
        flag: string;
        label: string;
        description: string;
        enabled: boolean;
        known: boolean;
      };
      const flags: FlagDto[] = KNOWN_FEATURE_FLAGS.map((def) => ({
        flag: def.key,
        label: def.label,
        description: def.description,
        enabled: byFlag.get(def.key) ?? def.defaultEnabled,
        known: true,
      }));
      const knownKeys = new Set<string>(KNOWN_FEATURE_FLAGS.map((f) => f.key));
      for (const row of rows) {
        if (!knownKeys.has(row.flag)) {
          flags.push({
            flag: row.flag,
            label: row.flag,
            description: "Unknown flag (read-only)",
            enabled: row.enabled,
            known: false,
          });
        }
      }
      res.json({ flags });
    } catch (e) {
      console.error("[feature-flags] list:", e);
      res.status(500).json({ message: "Failed to list feature flags" });
    }
  });

  app.put(
    "/api/feature-flags/:flag",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: any, res) => {
      try {
        const orgId = req.orgContext.orgId as string;
        const flag = String(req.params.flag ?? "").trim();
        assertKnownFlag(flag);
        const enabled = Boolean(req.body?.enabled);
        await storage.upsertFeatureFlag(orgId, flag, enabled);
        invalidateFeatureFlagCache(orgId, flag);

        const actorUserId = req.user.claims?.sub ?? req.user.id;
        const actorRole =
          req.orgContext?.role ?? (req.user.isOwner ? "SUPER_ADMIN" : "ADMIN");
        await recordAdminAudit(req, {
          actorUserId,
          actorRole,
          action: "feature_flag.updated",
          targetType: "feature_flag",
          targetId: flag,
          orgId,
          metadata: { enabled },
        });

        res.json({ flag, enabled });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to update feature flag";
        const status = msg.startsWith("Unknown feature flag") ? 400 : 500;
        console.error("[feature-flags] put:", e);
        res.status(status).json({ message: msg });
      }
    },
  );
}
