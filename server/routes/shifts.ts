import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  shifts,
  orders,
  orderItems,
  products,
  locations,
  refunds,
  orderCredit,
  creditPayments,
} from "../../shared/schema";
import { and, eq, desc, gte, lte, inArray, or } from "drizzle-orm";
import { requireRole } from "../auth";
import { recordAdminAudit } from "../adminAudit";
import { buildZReport } from "@shared/reports/zReport";
import { resolveUserName, resolveUserNames } from "../services/userDisplayName";
import type { ZReportOrder, ZReportRefund } from "@shared/reports/zReport";

/** Default window for the shifts list, and the ceiling a caller may ask for. */
const DEFAULT_WINDOW_HOURS = 48;
const MAX_WINDOW_HOURS = 24 * 7;

const openBodySchema = z.object({
  locationId: z.string().uuid(),
  openingFloat: z.coerce.number().min(0),
});

const closeBodySchema = z.object({
  closingCount: z.coerce.number().min(0),
  notes: z.string().max(2000).optional(),
});

const reopenBodySchema = z.object({
  reason: z.string().min(3).max(2000),
});

async function loadShiftReportData(shiftId: string, orgId: string) {
  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.orgId, orgId)))
    .limit(1);
  if (!shift) return null;

  const [location] = await db
    .select({ name: locations.name })
    .from(locations)
    .where(eq(locations.id, shift.locationId))
    .limit(1);

  const cashierName = await resolveUserName(shift.userId);

  const shiftOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.shiftId, shiftId));

  const zOrders: ZReportOrder[] = [];
  for (const order of shiftOrders) {
    const items = await db
      .select({
        productId: orderItems.productId,
        productName: products.name,
        sku: products.productId,
        quantity: orderItems.quantity,
        lineTotal: orderItems.totalPrice,
      })
      .from(orderItems)
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, order.id));

    zOrders.push({
      id: order.id,
      total: parseFloat(String(order.total)),
      paymentMethod: order.paymentMethod,
      createdAt: order.createdAt?.toISOString() ?? "",
      items: items.map((i) => ({
        productId: i.productId ?? "",
        productName: i.productName ?? "Item",
        sku: i.sku ?? undefined,
        quantity: i.quantity,
        lineTotal: parseFloat(String(i.lineTotal)),
      })),
    });
  }

  const shiftRefunds = await db
    .select()
    .from(refunds)
    .where(eq(refunds.shiftId, shiftId));

  const zRefunds: ZReportRefund[] = shiftRefunds.map((r) => ({
    id: r.id,
    total: parseFloat(String(r.total)),
    refundMethod: r.refundMethod,
    createdAt: r.createdAt?.toISOString() ?? "",
  }));

  // Credit handed out on this shift, and credit settled on it. Both come from
  // the credit records: an order's status cannot say whether money arrived.
  const orderIds = shiftOrders.map((o) => o.id);
  const creditGiven = orderIds.length
    ? await db
        .select({ orderId: orderCredit.orderId, amountGiven: orderCredit.amountGiven })
        .from(orderCredit)
        .where(inArray(orderCredit.orderId, orderIds))
    : [];

  // Settlements taken while this shift was open, whatever day the debt was
  // given — that is the whole point of the line.
  const shiftWindowEnd = shift.closedAt ?? new Date();
  const creditPaid = shift.openedAt
    ? await db
        .select({
          amount: creditPayments.amount,
          method: creditPayments.method,
          givenOn: orderCredit.givenOn,
        })
        .from(creditPayments)
        .innerJoin(orderCredit, eq(orderCredit.orderId, creditPayments.orderId))
        .where(
          and(
            eq(creditPayments.orgId, orgId),
            gte(creditPayments.createdAt, shift.openedAt),
            lte(creditPayments.createdAt, shiftWindowEnd),
          ),
        )
    : [];

  const report = buildZReport(
    {
      id: shift.id,
      openingFloat: parseFloat(String(shift.openingFloat ?? 0)),
      closingCount:
        shift.closingCount != null ? parseFloat(String(shift.closingCount)) : null,
      expectedCash:
        shift.expectedCash != null ? parseFloat(String(shift.expectedCash)) : null,
      variance: shift.variance != null ? parseFloat(String(shift.variance)) : null,
      openedAt: shift.openedAt?.toISOString() ?? "",
      closedAt: shift.closedAt?.toISOString() ?? null,
      cashierName,
      locationName: location?.name ?? "Location",
      status: shift.status,
      notes: shift.notes,
    },
    zOrders,
    zRefunds,
    creditGiven.map((c) => ({
      orderId: c.orderId,
      amountGiven: parseFloat(String(c.amountGiven)),
    })),
    creditPaid.map((p) => ({
      amount: parseFloat(String(p.amount)),
      givenOn: String(p.givenOn),
      method: p.method,
    })),
  );

  return { shift, report };
}

export function registerShiftRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/shifts/current", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null };
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const locationId = ctx.locationId;
      if (!locationId) {
        return res.json({ shift: null });
      }
      const [open] = await db
        .select()
        .from(shifts)
        .where(
          and(
            eq(shifts.orgId, ctx.orgId),
            eq(shifts.locationId, locationId),
            eq(shifts.userId, userId),
            eq(shifts.status, "open"),
          ),
        )
        .limit(1);
      res.json({ shift: open ?? null });
    } catch (error) {
      console.error("[Shifts] current:", error);
      res.status(500).json({ message: "Failed to fetch current shift" });
    }
  });

  app.get("/api/shifts", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null };
      const status = (req.query.status as string) || undefined;

      /**
       * A rolling window, not "since midnight". The page used to show today
       * only, so at ten past midnight it was empty and the shift that closed
       * twenty minutes earlier had vanished — exactly when someone asks who was
       * on. Bounded at a week so a wide window cannot be used to pull the whole
       * table.
       */
      const requestedHours = Number(req.query.hours);
      const hours = Number.isFinite(requestedHours)
        ? Math.min(Math.max(Math.trunc(requestedHours), 1), MAX_WINDOW_HOURS)
        : DEFAULT_WINDOW_HOURS;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const conditions = [
        eq(shifts.orgId, ctx.orgId),
        // An open shift older than the window is still on now, and "who is on"
        // is the first question this page answers.
        or(gte(shifts.openedAt, since), eq(shifts.status, "open"))!,
      ];
      if (status === "open" || status === "closed" || status === "reopened") {
        conditions.push(eq(shifts.status, status));
      }
      if (ctx.locationId) {
        conditions.push(eq(shifts.locationId, ctx.locationId));
      }

      const rows = await db
        .select({
          id: shifts.id,
          userId: shifts.userId,
          locationId: shifts.locationId,
          locationName: locations.name,
          status: shifts.status,
          openingFloat: shifts.openingFloat,
          closingCount: shifts.closingCount,
          expectedCash: shifts.expectedCash,
          variance: shifts.variance,
          openedAt: shifts.openedAt,
          closedAt: shifts.closedAt,
          notes: shifts.notes,
        })
        .from(shifts)
        .leftJoin(locations, eq(locations.id, shifts.locationId))
        .where(and(...conditions))
        .orderBy(desc(shifts.openedAt))
        .limit(200);

      // The page's whole question is "who was on". Sending only the user id
      // meant it could never answer that, which is what it did.
      const names = await resolveUserNames(rows.map((row) => row.userId));

      res.json(
        rows.map((row) => ({
          ...row,
          userName: names.get(row.userId) ?? row.userId,
        })),
      );
    } catch (error) {
      console.error("[Shifts] list:", error);
      res.status(500).json({ message: "Failed to list shifts" });
    }
  });

  app.post(
    "/api/shifts/open",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });
        const body = openBodySchema.parse(req.body ?? {});

        const [existing] = await db
          .select()
          .from(shifts)
          .where(
            and(
              eq(shifts.orgId, ctx.orgId),
              eq(shifts.locationId, body.locationId),
              eq(shifts.userId, userId),
              eq(shifts.status, "open"),
            ),
          )
          .limit(1);
        if (existing) {
          return res.status(409).json({
            message: "You already have an open shift at this location",
            shift: existing,
          });
        }

        const [created] = await db
          .insert(shifts)
          .values({
            orgId: ctx.orgId,
            locationId: body.locationId,
            userId,
            openingFloat: String(body.openingFloat),
            status: "open",
          })
          .returning();

        await recordAdminAudit(req, {
          actorUserId: userId,
          actorRole: req.orgContext?.role ?? "CASHIER",
          action: "shift.opened",
          targetType: "shift",
          targetId: created.id,
          orgId: ctx.orgId,
          metadata: { locationId: body.locationId, openingFloat: body.openingFloat },
        });

        res.status(201).json(created);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        console.error("[Shifts] open:", error);
        res.status(500).json({ message: "Failed to open shift" });
      }
    },
  );

  app.post(
    "/api/shifts/:id/close",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const userId = req.user?.id;
        const body = closeBodySchema.parse(req.body ?? {});

        const [shift] = await db
          .select()
          .from(shifts)
          .where(and(eq(shifts.id, req.params.id), eq(shifts.orgId, ctx.orgId)))
          .limit(1);
        if (!shift) return res.status(404).json({ message: "Shift not found" });
        if (shift.status !== "open" && shift.status !== "reopened") {
          return res.status(400).json({ message: "Shift is not open" });
        }
        if (
          req.orgContext?.role === "CASHIER" &&
          shift.userId !== userId
        ) {
          return res.status(403).json({ message: "Cannot close another cashier's shift" });
        }

        const loaded = await loadShiftReportData(shift.id, ctx.orgId);
        if (!loaded) return res.status(404).json({ message: "Shift not found" });

        const expectedCash = loaded.report.cashSummary.expectedCash;
        const variance = Math.round((body.closingCount - expectedCash) * 100) / 100;
        const now = new Date();

        const [closed] = await db
          .update(shifts)
          .set({
            status: "closed",
            closedAt: now,
            closingCount: String(body.closingCount),
            expectedCash: String(expectedCash),
            variance: String(variance),
            notes: body.notes ?? shift.notes,
          })
          .where(eq(shifts.id, shift.id))
          .returning();

        const finalReport = await loadShiftReportData(shift.id, ctx.orgId);

        await recordAdminAudit(req, {
          actorUserId: userId ?? "unknown",
          actorRole: req.orgContext?.role ?? "CASHIER",
          action: "shift.closed",
          targetType: "shift",
          targetId: shift.id,
          orgId: ctx.orgId,
          metadata: { closingCount: body.closingCount, expectedCash, variance },
        });

        res.json({ shift: closed, report: finalReport?.report });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        console.error("[Shifts] close:", error);
        res.status(500).json({ message: "Failed to close shift" });
      }
    },
  );

  app.post(
    "/api/shifts/:id/reopen",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string; role: string };
        const userId = req.user?.id;
        const body = reopenBodySchema.parse(req.body ?? {});

        const [shift] = await db
          .select()
          .from(shifts)
          .where(and(eq(shifts.id, req.params.id), eq(shifts.orgId, ctx.orgId)))
          .limit(1);
        if (!shift) return res.status(404).json({ message: "Shift not found" });
        if (shift.status !== "closed") {
          return res.status(400).json({ message: "Only closed shifts can be reopened" });
        }

        const [reopened] = await db
          .update(shifts)
          .set({
            status: "reopened",
            closedAt: null,
            closingCount: null,
            expectedCash: null,
            variance: null,
            reopenReason: body.reason,
          })
          .where(eq(shifts.id, shift.id))
          .returning();

        await recordAdminAudit(req, {
          actorUserId: userId ?? "unknown",
          actorRole: ctx.role,
          action: "shift.reopened",
          targetType: "shift",
          targetId: shift.id,
          orgId: ctx.orgId,
          metadata: { reason: body.reason },
        });

        res.json(reopened);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        console.error("[Shifts] reopen:", error);
        res.status(500).json({ message: "Failed to reopen shift" });
      }
    },
  );

  app.get("/api/shifts/:id/report", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const loaded = await loadShiftReportData(req.params.id, ctx.orgId);
      if (!loaded) return res.status(404).json({ message: "Shift not found" });
      res.json({ shift: loaded.shift, report: loaded.report });
    } catch (error) {
      console.error("[Shifts] report:", error);
      res.status(500).json({ message: "Failed to build Z-report" });
    }
  });
}
