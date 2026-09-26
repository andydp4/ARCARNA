/**
 * The shift rota: a 14-day-forward grid built from recurring weekly patterns
 * plus one-off overrides, day-off requests (which resolve to "off" overrides
 * once approved), and a busy-times overlay so a manager can see, at a
 * glance, whether a quiet Tuesday needs three people on or one.
 *
 * View is open to any signed-in staff member (everyone benefits from seeing
 * who's on); editing patterns/overrides and deciding time-off is manager+.
 * A cashier may only request their own time off and cancel their own
 * pending request.
 */
import type { Express } from "express";
import type { RequestHandler } from "express";
import { requireRole } from "../auth";
import { insertShiftPatternSchema, insertShiftOverrideSchema, insertTimeOffRequestSchema } from "@shared/schema";
import * as rota from "../services/rotaService";

const manageRoles = requireRole("SUPER_ADMIN", "ADMIN", "MANAGER");

function currentUserId(req: any): string | null {
  return req.user?.id ?? null;
}

export function registerRotaRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/rota", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 14, 1), 42);
      const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : new Date().toISOString().slice(0, 10);
      const grid = await rota.getRotaGrid(ctx.orgId, from, days);
      res.json(grid);
    } catch (error) {
      console.error("Error building rota grid:", error);
      res.status(500).json({ message: "Failed to load the rota" });
    }
  });

  app.get("/api/rota/busy", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const weeks = Math.min(Math.max(parseInt(req.query.weeks as string, 10) || 8, 1), 52);
      const byDayOfWeek = await rota.getBusyByDayOfWeek(ctx.orgId, weeks);
      res.json({ byDayOfWeek, weeks });
    } catch (error) {
      console.error("Error building busy-times overlay:", error);
      res.status(500).json({ message: "Failed to load busy-times data" });
    }
  });

  app.get("/api/rota/patterns", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
      const patterns = await rota.listPatterns(ctx.orgId, userId);
      res.json(patterns);
    } catch (error) {
      console.error("Error fetching shift patterns:", error);
      res.status(500).json({ message: "Failed to fetch shift patterns" });
    }
  });

  app.post("/api/rota/patterns", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = insertShiftPatternSchema.parse(req.body ?? {});
      const pattern = await rota.createPattern(ctx.orgId, parsed.userId, parsed, currentUserId(req));
      res.json(pattern);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ message: "Validation error", details: error.errors });
      } else {
        console.error("Error creating shift pattern:", error);
        res.status(500).json({ message: "Failed to create shift pattern" });
      }
    }
  });

  app.patch("/api/rota/patterns/:id", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = insertShiftPatternSchema.partial().parse(req.body ?? {});
      const pattern = await rota.updatePattern(ctx.orgId, req.params.id, parsed);
      if (!pattern) {
        res.status(404).json({ message: "Shift pattern not found" });
        return;
      }
      res.json(pattern);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ message: "Validation error", details: error.errors });
      } else {
        console.error("Error updating shift pattern:", error);
        res.status(500).json({ message: "Failed to update shift pattern" });
      }
    }
  });

  app.delete("/api/rota/patterns/:id", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const ok = await rota.deletePattern(ctx.orgId, req.params.id);
      if (!ok) {
        res.status(404).json({ message: "Shift pattern not found" });
        return;
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting shift pattern:", error);
      res.status(500).json({ message: "Failed to delete shift pattern" });
    }
  });

  app.post("/api/rota/overrides", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = insertShiftOverrideSchema.parse(req.body ?? {});
      const override = await rota.upsertOverride(ctx.orgId, parsed.userId, parsed, currentUserId(req));
      res.json(override);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ message: "Validation error", details: error.errors });
      } else {
        console.error("Error saving shift override:", error);
        res.status(500).json({ message: "Failed to save shift override" });
      }
    }
  });

  app.delete("/api/rota/overrides/:id", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const ok = await rota.deleteOverride(ctx.orgId, req.params.id);
      if (!ok) {
        res.status(404).json({ message: "Override not found" });
        return;
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting shift override:", error);
      res.status(500).json({ message: "Failed to delete shift override" });
    }
  });

  // Any signed-in staff member can request their own time off.
  app.post("/api/rota/time-off", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = currentUserId(req);
      if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const parsed = insertTimeOffRequestSchema.parse(req.body ?? {});
      if (parsed.endDate < parsed.startDate) {
        res.status(400).json({ message: "End date cannot be before start date" });
        return;
      }
      const request = await rota.createTimeOffRequest(ctx.orgId, userId, parsed);
      res.json(request);
    } catch (error: any) {
      if (error.name === "ZodError") {
        res.status(400).json({ message: "Validation error", details: error.errors });
      } else {
        console.error("Error creating time-off request:", error);
        res.status(500).json({ message: "Failed to create time-off request" });
      }
    }
  });

  // A cashier sees only their own requests; manager+ sees everyone's.
  app.get("/api/rota/time-off", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const isManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(ctx.role);
      const userId = currentUserId(req);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const requests = await rota.listTimeOffRequests(ctx.orgId, {
        userId: isManager ? (typeof req.query.userId === "string" ? req.query.userId : undefined) : userId ?? undefined,
        status,
      });
      res.json(requests);
    } catch (error) {
      console.error("Error fetching time-off requests:", error);
      res.status(500).json({ message: "Failed to fetch time-off requests" });
    }
  });

  app.post("/api/rota/time-off/:id/decide", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const decision = req.body?.decision;
      if (decision !== "approved" && decision !== "declined") {
        res.status(400).json({ message: 'decision must be "approved" or "declined"' });
        return;
      }
      const decidedByUserId = currentUserId(req);
      if (!decidedByUserId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : undefined;
      const request = await rota.decideTimeOffRequest(ctx.orgId, req.params.id, decision, decidedByUserId, note);
      if (!request) {
        res.status(404).json({ message: "Time-off request not found" });
        return;
      }
      res.json(request);
    } catch (error) {
      console.error("Error deciding time-off request:", error);
      res.status(500).json({ message: "Failed to decide time-off request" });
    }
  });

  // The requester can cancel their own still-pending request; manager+ can cancel any.
  app.post("/api/rota/time-off/:id/cancel", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const isManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(ctx.role);
      const userId = currentUserId(req);
      if (!userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const existing = (await rota.listTimeOffRequests(ctx.orgId, { userId: isManager ? undefined : userId })).find(
        (r) => r.id === req.params.id,
      );
      if (!existing) {
        res.status(404).json({ message: "Time-off request not found" });
        return;
      }
      if (!isManager && existing.userId !== userId) {
        res.status(403).json({ message: "You can only cancel your own request" });
        return;
      }
      if (existing.status !== "pending") {
        res.status(400).json({ message: "Only a pending request can be cancelled" });
        return;
      }
      const request = await rota.decideTimeOffRequest(ctx.orgId, req.params.id, "cancelled", userId);
      res.json(request);
    } catch (error) {
      console.error("Error cancelling time-off request:", error);
      res.status(500).json({ message: "Failed to cancel time-off request" });
    }
  });
}
