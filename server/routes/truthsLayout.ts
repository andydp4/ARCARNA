import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { adminAuditRow } from "../adminAudit";
import { rolesAtLeast } from "@shared/accessPolicy";
import {
  TRUTHS_LAYOUT_EDIT_MIN_ROLE,
  TRUTHS_LAYOUT_VIEW_MIN_ROLE,
  parseTruthsLayout,
  truthsLayoutForRole,
} from "@shared/truthsLayout";
import { getTruthsLayout, saveTruthsLayout } from "../services/truthsLayout";

/**
 * Truths at a glance (v1.2 Phase 3). One layout per org, set by admins (owner
 * decision). Everyone who reaches the Truths Centre (manager and above) reads
 * it; the widgets their role may not see — Profit Truths below admin — are
 * removed here, on the server, so a manager's response never names them.
 */
export function registerTruthsLayoutRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get(
    "/api/truths/layout",
    ...scoped,
    requireRole(...rolesAtLeast(TRUTHS_LAYOUT_VIEW_MIN_ROLE)),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string; role: string };
        const role = ctx.role ?? req.user?.role;
        const layout = await getTruthsLayout(ctx.orgId);
        res.json({
          widgets: truthsLayoutForRole(layout.widgets, role),
          isDefault: layout.isDefault,
          updatedAt: layout.updatedAt,
        });
      } catch (error) {
        console.error("[TruthsLayout] read:", error);
        res.status(500).json({ message: "Failed to load Truths at a glance" });
      }
    },
  );

  app.put(
    "/api/truths/layout",
    ...scoped,
    requireRole(...rolesAtLeast(TRUTHS_LAYOUT_EDIT_MIN_ROLE)),
    async (req: any, res) => {
      const parsed = parseTruthsLayout(req.body?.widgets);
      if (!parsed.ok) return res.status(400).json({ code: "VALIDATION_ERROR", message: parsed.error });
      try {
        const ctx = req.orgContext as { orgId: string; role: string };
        const userId: string = req.user?.id ?? req.user?.claims?.sub ?? "unknown";
        const describe = (list: typeof parsed.layout) => list.map((w) => `${w.id}:${w.size}:${w.window}`);
        await saveTruthsLayout(ctx.orgId, parsed.layout, userId, (previous) =>
          adminAuditRow(req, {
            actorUserId: userId,
            actorRole: ctx.role ?? req.user?.role ?? "ADMIN",
            action: "truths_layout.saved",
            targetType: "truths_layout",
            targetId: ctx.orgId,
            orgId: ctx.orgId,
            metadata: { widgets: describe(parsed.layout), previous: previous ? describe(previous) : null },
          }),
        );
        res.json({ widgets: parsed.layout, isDefault: false, updatedAt: new Date().toISOString() });
      } catch (error) {
        console.error("[TruthsLayout] save:", error);
        res.status(500).json({ message: "Failed to save Truths at a glance" });
      }
    },
  );
}
