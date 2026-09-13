/**
 * `/api/operations/*` — staff and station endpoints for the Operations
 * Centre (Phase N, N3b; docs/briefs/PHASE_N_OPERATIONS_CENTRE.md, "API").
 *
 * Alert acknowledgement (`PATCH /alerts/:id/ack`, `POST /alerts/ack-all`) is
 * explicitly OUT of scope here — `ops_alerts` does not exist until migration
 * 066 (N5a). Only `GET /staff` and the two station endpoints are this
 * package's.
 */
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { OPS_STATIONS, opsStaff } from "@shared/schema";
import { requireRole } from "../auth";
import { recordAdminAudit } from "../adminAudit";

const stationBodySchema = z.object({
  station: z.enum(OPS_STATIONS).nullable().optional(),
  onBreak: z.boolean().optional(),
});

/**
 * Upserts the (org, user) row in `ops_staff` — sticky per person, per the
 * brief's "Stations & presence": setting `station` stamps `station_set_at`;
 * `onBreak` is independent of it (a break keeps the station but removes the
 * person from alert recipients and suggestions).
 */
async function setStation(
  orgId: string,
  userId: string,
  body: z.infer<typeof stationBodySchema>,
): Promise<void> {
  const { db } = await import("../db");
  const now = new Date();
  const patch: Record<string, unknown> = {};
  if (body.station !== undefined) {
    patch.station = body.station;
    patch.stationSetAt = now;
  }
  if (body.onBreak !== undefined) {
    patch.onBreak = body.onBreak;
  }
  if (Object.keys(patch).length === 0) return;

  await db
    .insert(opsStaff)
    .values({
      orgId,
      userId,
      station: body.station ?? null,
      stationSetAt: body.station !== undefined ? now : null,
      onBreak: body.onBreak ?? false,
    })
    .onConflictDoUpdate({ target: [opsStaff.orgId, opsStaff.userId], set: patch });
}

export function registerOperationsRoutes(app: Express, scoped: RequestHandler[]): void {
  /** The board's own staff list — same computation `GET /api/orders/board` uses, so the two can never disagree. */
  app.get("/api/operations/staff", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null } | undefined;
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Operations Centre routes require org context." });
      }
      const { getOpsBoard } = await import("../services/opsBoard");
      const board = await getOpsBoard(ctx.orgId, req.user?.id ?? null);
      res.json({ staff: board.staff, me: board.me });
    } catch (error) {
      console.error("Error loading operations staff:", error);
      res.status(500).json({ message: "Failed to load staff" });
    }
  });

  /** Self only — any signed-in CASHIER+ sets their own station and break state. */
  app.patch("/api/operations/station", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null } | undefined;
      if (!ctx?.orgId) {
        return res.status(400).json({ message: "Operations Centre routes require org context." });
      }
      const actorId = req.user?.id;
      if (!actorId) return res.status(401).json({ message: "Unauthorized" });
      const parsed = stationBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid station request", errors: parsed.error.errors });
      }
      await setStation(ctx.orgId, actorId, parsed.data);
      res.json({ userId: actorId, ...parsed.data });
    } catch (error) {
      console.error("Error setting own station:", error);
      res.status(500).json({ message: "Failed to set station" });
    }
  });

  /** Someone else's station — MANAGER+, audited. */
  app.patch(
    "/api/operations/station/:userId",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string | null } | undefined;
        if (!ctx?.orgId) {
          return res.status(400).json({ message: "Operations Centre routes require org context." });
        }
        const targetUserId = req.params.userId;
        const parsed = stationBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid station request", errors: parsed.error.errors });
        }
        await setStation(ctx.orgId, targetUserId, parsed.data);
        await recordAdminAudit(req, {
          actorUserId: req.user?.id ?? "unknown",
          actorRole: req.user?.role ?? "MANAGER",
          action: "ops.station_set",
          targetType: "user",
          targetId: targetUserId,
          orgId: ctx.orgId,
          metadata: { ...parsed.data },
        });
        res.json({ userId: targetUserId, ...parsed.data });
      } catch (error) {
        console.error("Error setting someone else's station:", error);
        res.status(500).json({ message: "Failed to set station" });
      }
    },
  );
}
