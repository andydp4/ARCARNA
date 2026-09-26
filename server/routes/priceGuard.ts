import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireRole } from "../auth";
import { rolesAtLeast, PRICE_GUARD_SWITCH_MIN_ROLE } from "@shared/accessPolicy";
import { organizations } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import { answerManagerCheck, listGuardManagers, ManagerAnswerError } from "../services/priceGuard";

/**
 * Price guard at the till (v1.2 Phase 4: PRC-02, CMP-05).
 *
 *  - The switch: admins only, and every change is logged (owner decision).
 *  - The managers a cashier can name under "Manager agreed": names and ids
 *    only, so the till can list them (and keep them for offline selling).
 *  - The named manager's "Yes, I agreed / No".
 */
export function registerPriceGuardRoutes(app: Express, scoped: RequestHandler[]): void {
  app.put(
    "/api/settings/price-guard",
    ...scoped,
    requireRole(...rolesAtLeast(PRICE_GUARD_SWITCH_MIN_ROLE)),
    async (req: any, res) => {
      const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Say whether the price guard is on or off." });
      try {
        const orgId = req.orgContext.orgId as string;
        const { db } = await import("../db");
        const [before] = await db
          .select({ enabled: organizations.priceGuardEnabled })
          .from(organizations)
          .where(eq(organizations.id, orgId));
        if (!before) return res.status(404).json({ message: "Organization not found" });
        await db
          .update(organizations)
          .set({ priceGuardEnabled: parsed.data.enabled })
          .where(eq(organizations.id, orgId));
        if (before.enabled !== parsed.data.enabled) {
          await recordAdminAudit(req, {
            actorUserId: req.user?.id ?? "unknown",
            actorRole: req.orgContext?.role ?? req.user?.role ?? "ADMIN",
            action: "price_guard.updated",
            targetType: "organization",
            targetId: orgId,
            orgId,
            metadata: { from: before.enabled, to: parsed.data.enabled },
          });
        }
        res.json({ priceGuardEnabled: parsed.data.enabled });
      } catch (error) {
        console.error("[PriceGuard] switch:", error);
        res.status(500).json({ message: "Failed to change the price guard" });
      }
    },
  );

  app.get(
    "/api/price-guard/managers",
    ...scoped,
    requireRole(...rolesAtLeast("CASHIER")),
    async (req: any, res) => {
      try {
        const managers = await listGuardManagers(req.orgContext.orgId);
        // Names only: a role or an email is not the till's business.
        res.json(managers.map((m) => ({ id: m.id, name: m.name })));
      } catch (error) {
        console.error("[PriceGuard] managers:", error);
        res.status(500).json({ message: "Failed to load managers" });
      }
    },
  );

  app.post(
    "/api/price-guard/checks/:id/answer",
    ...scoped,
    requireRole(...rolesAtLeast("MANAGER")),
    async (req: any, res) => {
      const parsed = z.object({ answer: z.enum(["yes", "no"]) }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Answer Yes or No." });
      if (!z.string().uuid().safeParse(req.params.id).success) {
        return res.status(404).json({ message: "There is nothing here for you to answer." });
      }
      try {
        const out = await answerManagerCheck({
          orgId: req.orgContext.orgId,
          guardId: req.params.id,
          userId: req.user?.id,
          answer: parsed.data.answer,
        });
        res.json(out);
      } catch (error) {
        if (error instanceof ManagerAnswerError) {
          return res.status(error.status).json({ message: error.message, code: error.code });
        }
        console.error("[PriceGuard] answer:", error);
        res.status(500).json({ message: "Failed to record the answer" });
      }
    },
  );
}
