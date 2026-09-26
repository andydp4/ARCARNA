/**
 * My run (v1.2): the driver's phone view. Three routes, all in ACCESS_POLICY:
 *
 * - GET  /api/my-run                    your own run; a manager may add ?driver=
 * - PUT  /api/my-run/order              save the order of your own stops for today
 * - POST /api/orders/:id/couldnt-deliver  back to ready, board note, Signal
 *
 * Start run and Delivered are the existing POST /api/orders/:id/transition
 * (out_for_delivery; complete with label "delivered"), and Call is the
 * existing logged reveal, POST /api/orders/:id/customer-phone. No customer
 * phone is ever in these responses.
 */
import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import { couldntDeliverSchema, runOrderSchema, type RunPayload } from "@shared/orders/myRun";
import { recordAdminAudit } from "../adminAudit";
import { publishOpsEvent } from "../services/opsBus";

export function registerMyRunRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/my-run", ...scoped, requireRole(...rolesAtLeast("CASHIER")), async (req: any, res) => {
    // Names and addresses: never kept by a browser cache or the service worker.
    res.setHeader("Cache-Control", "no-store, private");
    try {
      const ctx = req.orgContext as { orgId: string | null; role: string };
      const me: string | undefined = req.user?.id;
      if (!ctx?.orgId || !me) return res.status(400).json({ message: "Org context required" });
      const { isManagerPlus, listDrivers, loadRun } = await import("../services/myRun");
      const manager = isManagerPlus(ctx.role);
      const asked = typeof req.query.driver === "string" && req.query.driver.trim() ? req.query.driver.trim() : me;
      // A person only ever sees their own run; managers may look at anyone's.
      if (asked !== me && !manager) {
        return res.status(403).json({ message: "You can only see your own run.", code: "NOT_YOUR_RUN" });
      }
      const { resolveUserNames } = await import("../services/userDisplayName");
      const [run, names, drivers] = await Promise.all([
        loadRun(ctx.orgId, asked),
        resolveUserNames([asked]),
        manager ? listDrivers(ctx.orgId, me) : Promise.resolve(undefined),
      ]);
      const payload: RunPayload = {
        day: run.day,
        timezone: run.timezone,
        driver: { userId: asked, name: names.get(asked) ?? asked },
        viewingOther: asked !== me,
        stops: run.stops,
        ...(drivers ? { drivers } : {}),
      };
      res.json(payload);
    } catch (error) {
      console.error("Error loading a delivery run:", error);
      res.status(500).json({ message: "Failed to load the run" });
    }
  });

  app.put("/api/my-run/order", ...scoped, requireRole(...rolesAtLeast("CASHIER")), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null };
      const me: string | undefined = req.user?.id;
      if (!ctx?.orgId || !me) return res.status(400).json({ message: "Org context required" });
      const parsed = runOrderSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid stop order", errors: parsed.error.errors });
      }
      // Always the signed-in person's own row: nobody reorders someone else's run.
      const { saveRunOrder } = await import("../services/myRun");
      res.json(await saveRunOrder(ctx.orgId, me, parsed.data.orderIds));
    } catch (error) {
      console.error("Error saving a delivery run order:", error);
      res.status(500).json({ message: "Failed to save the order of your stops" });
    }
  });

  app.post("/api/orders/:id/couldnt-deliver", ...scoped, requireRole(...rolesAtLeast("CASHIER")), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null; role: string };
      const me: string | undefined = req.user?.id;
      if (!ctx?.orgId || !me) return res.status(400).json({ message: "Org context required" });
      const parsed = couldntDeliverSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          message: parsed.error.errors[0]?.message ?? "Invalid request",
          code: "COULDNT_DELIVER_INVALID",
          errors: parsed.error.errors,
        });
      }
      const { couldntDeliver, RunError } = await import("../services/myRun");
      try {
        const result = await couldntDeliver(ctx.orgId, req.params.id, { userId: me, role: ctx.role }, parsed.data);
        await recordAdminAudit(req, {
          actorUserId: me,
          actorRole: ctx.role,
          action: "order.delivery_failed",
          targetType: "order",
          targetId: req.params.id,
          orgId: ctx.orgId,
          metadata: { reason: parsed.data.reason },
        });
        const { getOpsBoardOrder } = await import("../services/opsBoard");
        const card = await getOpsBoardOrder(ctx.orgId, req.params.id);
        if (card) publishOpsEvent(ctx.orgId, { type: "order", order: card });
        res.json(result);
      } catch (error) {
        if (error instanceof RunError) {
          return res.status(error.status).json({ message: error.message, code: error.code });
        }
        throw error;
      }
    } catch (error) {
      console.error("Error recording a failed delivery:", error);
      res.status(500).json({ message: "Failed to record that the delivery did not happen" });
    }
  });
}
