/**
 * The shift rota: a 14-day-forward grid built from recurring weekly patterns
 * plus one-off overrides, day-off requests (which become "off" overrides once
 * approved), and a busy-times overlay.
 *
 * Viewing is open to every member of staff. Editing patterns and overrides,
 * and deciding time off, is manager and above — and nobody but the owner
 * decides their own request (the same rule as confirming commission). A
 * cashier requests, and may cancel, only their own time off.
 */
import type { Express, RequestHandler, Response } from "express";
import { requireRole } from "../auth";
import { insertShiftPatternSchema, insertShiftOverrideSchema, insertTimeOffRequestSchema } from "@shared/schema";
import { localCalendarDate } from "@shared/time/tradingDay";
import { orgTimeZone } from "../services/tradingDayShift";
import * as rota from "../services/rotaService";

const MANAGER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
const manageRoles = requireRole(...MANAGER_ROLES);

function currentUserId(req: any): string | null {
  return req.user?.id ?? null;
}

/** Staff names and who is off when: never kept by a browser, a proxy or the service worker. */
function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store, private");
}

function fail(res: Response, error: any, what: string) {
  if (error instanceof rota.RotaError) return res.status(error.status).json({ message: error.message });
  if (error?.name === "ZodError") return res.status(400).json({ message: "Validation error", details: error.errors });
  console.error(`[rota] ${what}:`, error);
  return res.status(500).json({ message: `Failed to ${what}` });
}

export function registerRotaRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/rota", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 14, 1), 42);
      // The shop's own date, not the server's UTC one: between midnight and
      // 01:00 in summer the UTC date is still yesterday.
      const from =
        typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
          ? req.query.from
          : localCalendarDate(new Date(), await orgTimeZone(ctx.orgId));
      noStore(res);
      res.json(await rota.getRotaGrid(ctx.orgId, from, days));
    } catch (error) {
      fail(res, error, "load the rota");
    }
  });

  app.get("/api/rota/busy", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const weeks = Math.min(Math.max(parseInt(req.query.weeks as string, 10) || 8, 1), 52);
      res.json({ byDayOfWeek: await rota.getBusyByDayOfWeek(ctx.orgId, weeks), weeks });
    } catch (error) {
      fail(res, error, "load busy-times data");
    }
  });

  app.get("/api/rota/patterns", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
      noStore(res);
      res.json(await rota.listPatterns(ctx.orgId, userId));
    } catch (error) {
      fail(res, error, "fetch shift patterns");
    }
  });

  app.post("/api/rota/patterns", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = insertShiftPatternSchema.parse(req.body ?? {});
      const member = await rota.requireRosterMember(ctx.orgId, parsed.userId);
      res.json(await rota.createPattern(ctx.orgId, member.userId, parsed, currentUserId(req)));
    } catch (error) {
      fail(res, error, "create the shift pattern");
    }
  });

  app.patch("/api/rota/patterns/:id", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = insertShiftPatternSchema.partial().parse(req.body ?? {});
      const pattern = await rota.updatePattern(ctx.orgId, req.params.id, parsed);
      if (!pattern) return res.status(404).json({ message: "Shift pattern not found" });
      res.json(pattern);
    } catch (error) {
      fail(res, error, "update the shift pattern");
    }
  });

  app.delete("/api/rota/patterns/:id", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      if (!(await rota.deletePattern(ctx.orgId, req.params.id))) return res.status(404).json({ message: "Shift pattern not found" });
      res.status(204).send();
    } catch (error) {
      fail(res, error, "delete the shift pattern");
    }
  });

  app.post("/api/rota/overrides", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = insertShiftOverrideSchema.parse(req.body ?? {});
      const member = await rota.requireRosterMember(ctx.orgId, parsed.userId);
      res.json(await rota.upsertOverride(ctx.orgId, member.userId, parsed, currentUserId(req)));
    } catch (error) {
      fail(res, error, "save the shift override");
    }
  });

  app.delete("/api/rota/overrides/:id", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      if (!(await rota.deleteOverride(ctx.orgId, req.params.id))) return res.status(404).json({ message: "Override not found" });
      res.status(204).send();
    } catch (error) {
      fail(res, error, "delete the shift override");
    }
  });

  // Any member of staff can request their own time off.
  app.post("/api/rota/time-off", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = currentUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const parsed = insertTimeOffRequestSchema.parse(req.body ?? {});
      res.json(await rota.createTimeOffRequest(ctx.orgId, userId, parsed));
    } catch (error) {
      fail(res, error, "create the time-off request");
    }
  });

  // A cashier sees only their own requests; manager and above see everyone's.
  app.get("/api/rota/time-off", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const userId = currentUserId(req);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      let userIds: string[] | undefined;
      if (!MANAGER_ROLES.includes(ctx.role)) {
        // Both of this person's ids: a request written before Clerk linking may carry the legacy one.
        const me = userId ? (await rota.getRosterForOrg(ctx.orgId)).find((m) => m.aliases.includes(userId)) : undefined;
        userIds = me ? me.aliases : userId ? [userId] : [];
      }
      noStore(res);
      res.json(await rota.listTimeOffRequests(ctx.orgId, { userIds, status }));
    } catch (error) {
      fail(res, error, "fetch time-off requests");
    }
  });

  app.post("/api/rota/time-off/:id/decide", ...scoped, manageRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const decision = req.body?.decision;
      if (decision !== "approved" && decision !== "declined" && decision !== "revoked") {
        return res.status(400).json({ message: 'decision must be "approved", "declined" or "revoked"' });
      }
      const deciderId = currentUserId(req);
      if (!deciderId) return res.status(401).json({ message: "Unauthorized" });
      const request = await rota.getTimeOffRequest(ctx.orgId, req.params.id);
      if (!request) return res.status(404).json({ message: "Time-off request not found" });
      if (ctx.role !== "SUPER_ADMIN") {
        const decider = (await rota.getRosterForOrg(ctx.orgId)).find((m) => m.aliases.includes(deciderId));
        const ownIds = decider ? decider.aliases : [deciderId];
        if (ownIds.includes(request.userId)) {
          return res.status(403).json({ message: "You cannot decide your own time-off request. Ask someone else to." });
        }
      }
      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : undefined;
      res.json(await rota.decideTimeOffRequest(ctx.orgId, req.params.id, decision, deciderId, note));
    } catch (error) {
      fail(res, error, "decide the time-off request");
    }
  });

  // The requester can cancel their own still-pending request; manager and above can cancel anyone's pending one.
  app.post("/api/rota/time-off/:id/cancel", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const userId = currentUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const request = await rota.getTimeOffRequest(ctx.orgId, req.params.id);
      if (!request) return res.status(404).json({ message: "Time-off request not found" });
      if (!MANAGER_ROLES.includes(ctx.role)) {
        const me = (await rota.getRosterForOrg(ctx.orgId)).find((m) => m.aliases.includes(userId));
        if (!(me ? me.aliases : [userId]).includes(request.userId)) {
          return res.status(403).json({ message: "You can only cancel your own request" });
        }
      }
      res.json(await rota.decideTimeOffRequest(ctx.orgId, req.params.id, "cancelled", userId));
    } catch (error) {
      fail(res, error, "cancel the time-off request");
    }
  });
}
