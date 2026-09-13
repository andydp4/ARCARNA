/**
 * Alert acknowledgement — `PATCH /api/operations/alerts/:id/ack`,
 * `POST /api/operations/alerts/ack-all` (Phase N, N5a;
 * docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "API": "`PATCH /alerts/:id/ack`,
 * `POST /alerts/ack-all` (own rows; N5a)").
 *
 * A separate file from `server/routes/operations.ts` on purpose: that file is
 * N3b's (station and presence), and this package's touch list does not
 * include it — the two mount routes under the same `/api/operations/*`
 * prefix without either owning the other's file, the same way several
 * `registerXRoutes` functions already share `/api/orders/*` in
 * `server/routes/orders.ts` and `server/routes/orderTransitions.ts`.
 *
 * Own rows only, always: neither route accepts acking on someone else's
 * behalf — a manager clearing a cashier's alert tray is not a feature this
 * phase asked for, and `ops_alerts.user_id` is the whole addressing scheme
 * (module doc, `server/services/opsAlerts.ts`).
 */
import type { Express, RequestHandler } from "express";

export function registerOpsAlertRoutes(app: Express, scoped: RequestHandler[]): void {
  app.patch("/api/operations/alerts/:id/ack", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null } | undefined;
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Operations Centre routes require org context." });
      }
      const actorId = req.user?.id;
      if (!actorId) return res.status(401).json({ message: "Unauthorized" });

      const { db } = await import("../db");
      const { opsAlerts } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");

      const [existing] = await db
        .select({ id: opsAlerts.id, ackedAt: opsAlerts.ackedAt })
        .from(opsAlerts)
        .where(and(eq(opsAlerts.id, req.params.id), eq(opsAlerts.orgId, ctx.orgId), eq(opsAlerts.userId, actorId)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Alert not found" });

      if (existing.ackedAt) {
        // Repeat ack — "no news", the same idempotent shape every transition
        // stamp in this phase already reports (server/services/orderTransitions.ts).
        return res.json({ id: existing.id, ackedAt: existing.ackedAt.toISOString(), changed: false });
      }

      const now = new Date();
      const [updated] = await db
        .update(opsAlerts)
        .set({ ackedAt: now, ackedByUserId: actorId })
        .where(eq(opsAlerts.id, existing.id))
        .returning({ id: opsAlerts.id });
      res.json({ id: updated.id, ackedAt: now.toISOString(), changed: true });
    } catch (error) {
      console.error("Error acknowledging alert:", error);
      res.status(500).json({ message: "Failed to acknowledge alert" });
    }
  });

  /** Clears the caller's whole tray in one tap — every currently-unacked row of theirs in this org. */
  app.post("/api/operations/alerts/ack-all", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null } | undefined;
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Operations Centre routes require org context." });
      }
      const actorId = req.user?.id;
      if (!actorId) return res.status(401).json({ message: "Unauthorized" });

      const { db } = await import("../db");
      const { opsAlerts } = await import("@shared/schema");
      const { and, eq, isNull } = await import("drizzle-orm");
      const now = new Date();

      const updated = await db
        .update(opsAlerts)
        .set({ ackedAt: now, ackedByUserId: actorId })
        .where(and(eq(opsAlerts.orgId, ctx.orgId), eq(opsAlerts.userId, actorId), isNull(opsAlerts.ackedAt)))
        .returning({ id: opsAlerts.id });
      res.json({ acked: updated.length });
    } catch (error) {
      console.error("Error acknowledging all alerts:", error);
      res.status(500).json({ message: "Failed to acknowledge alerts" });
    }
  });
}
