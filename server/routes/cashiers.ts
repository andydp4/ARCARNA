import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  cashierProfiles,
  cashierShifts,
  cashierShiftSummaries,
  cashierCommissionPayments,
  organizations,
  orgNotifications,
} from "../../shared/schema";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { requireRole } from "../auth";
import { recordAdminAudit } from "../adminAudit";
import {
  startCashierShift,
  closeCashierShift,
  getOpenCashierShift,
  computeCashierShiftBalanceSheet,
  effectiveCommissionRate,
  CashierShiftError,
} from "../services/cashierShiftEngine";

const MANAGE_CASHIERS_ROLES = ["SUPER_ADMIN", "ADMIN"] as const;
const ALL_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"] as const;
const CONFIRM_PAYMENT_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

const createCashierSchema = z.object({
  cashierCode: z.string().trim().min(1, "Cashier code is required").max(20),
  displayName: z.string().trim().min(1, "Display name is required").max(255),
  pinCode: z.string().trim().max(16).optional().nullable(),
  defaultCommissionRate: z.coerce.number().min(0).max(100).optional().nullable(),
});

const updateCashierSchema = z.object({
  displayName: z.string().trim().min(1).max(255).optional(),
  pinCode: z.string().trim().max(16).optional().nullable(),
  defaultCommissionRate: z.coerce.number().min(0).max(100).optional().nullable(),
  isActive: z.boolean().optional(),
});

const startShiftSchema = z.object({
  cashierId: z.string().uuid("Valid cashierId is required"),
});

const commissionPaymentSchema = z.object({
  cashierId: z.string().uuid("Valid cashierId is required"),
  shiftId: z.string().uuid().optional().nullable(),
  amountPaid: z.coerce.number().positive("Amount paid must be positive"),
  notes: z.string().max(2000).optional().nullable(),
});

function formatMoney(amount: number, currency = "GBP"): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return `£${amount.toFixed(2)}`;
  }
}

export function registerCashierRoutes(app: Express, scoped: RequestHandler[]): void {
  // ---------------- Cashier profiles ----------------

  app.get("/api/cashiers", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const includeInactive = req.query.includeInactive === "true";
      const conditions = [eq(cashierProfiles.orgId, ctx.orgId)];
      if (!includeInactive) conditions.push(eq(cashierProfiles.isActive, true));
      const rows = await db
        .select()
        .from(cashierProfiles)
        .where(and(...conditions))
        .orderBy(cashierProfiles.cashierCode);
      res.json(rows);
    } catch (error) {
      console.error("[Cashiers] list:", error);
      res.status(500).json({ message: "Failed to list cashier profiles" });
    }
  });

  app.post("/api/cashiers", ...scoped, requireRole(...MANAGE_CASHIERS_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const body = createCashierSchema.parse(req.body ?? {});

      const [existing] = await db
        .select({ id: cashierProfiles.id })
        .from(cashierProfiles)
        .where(and(eq(cashierProfiles.orgId, ctx.orgId), eq(cashierProfiles.cashierCode, body.cashierCode)))
        .limit(1);
      if (existing) {
        return res.status(409).json({ message: `Cashier code ${body.cashierCode} is already in use` });
      }

      const [created] = await db
        .insert(cashierProfiles)
        .values({
          orgId: ctx.orgId,
          cashierCode: body.cashierCode,
          displayName: body.displayName,
          pinCode: body.pinCode ?? null,
          defaultCommissionRate: body.defaultCommissionRate != null ? String(body.defaultCommissionRate) : null,
        })
        .returning();

      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: req.orgContext?.role ?? "ADMIN",
        action: "cashier.created",
        targetType: "cashier_profile",
        targetId: created.id,
        orgId: ctx.orgId,
        metadata: { cashierCode: created.cashierCode },
      });

      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", errors: error.errors });
      console.error("[Cashiers] create:", error);
      res.status(500).json({ message: "Failed to create cashier profile" });
    }
  });

  app.patch("/api/cashiers/:id", ...scoped, requireRole(...MANAGE_CASHIERS_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const body = updateCashierSchema.parse(req.body ?? {});

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (body.displayName !== undefined) patch.displayName = body.displayName;
      if (body.pinCode !== undefined) patch.pinCode = body.pinCode;
      if (body.defaultCommissionRate !== undefined) {
        patch.defaultCommissionRate = body.defaultCommissionRate != null ? String(body.defaultCommissionRate) : null;
      }
      if (body.isActive !== undefined) patch.isActive = body.isActive;

      const [updated] = await db
        .update(cashierProfiles)
        .set(patch)
        .where(and(eq(cashierProfiles.id, req.params.id), eq(cashierProfiles.orgId, ctx.orgId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Cashier profile not found" });

      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: req.orgContext?.role ?? "ADMIN",
        action: "cashier.updated",
        targetType: "cashier_profile",
        targetId: updated.id,
        orgId: ctx.orgId,
        metadata: { patch: body },
      });

      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", errors: error.errors });
      console.error("[Cashiers] update:", error);
      res.status(500).json({ message: "Failed to update cashier profile" });
    }
  });

  // Deactivation is preferred over hard deletion once a cashier has shifts/orders.
  app.delete("/api/cashiers/:id", ...scoped, requireRole(...MANAGE_CASHIERS_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const [updated] = await db
        .update(cashierProfiles)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(cashierProfiles.id, req.params.id), eq(cashierProfiles.orgId, ctx.orgId)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Cashier profile not found" });

      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: req.orgContext?.role ?? "ADMIN",
        action: "cashier.deactivated",
        targetType: "cashier_profile",
        targetId: updated.id,
        orgId: ctx.orgId,
      });

      res.json(updated);
    } catch (error) {
      console.error("[Cashiers] deactivate:", error);
      res.status(500).json({ message: "Failed to deactivate cashier profile" });
    }
  });

  // ---------------- Cashier shifts ----------------

  app.get("/api/cashier-shifts", ...scoped, requireRole(...ALL_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const conditions = [eq(cashierShifts.orgId, ctx.orgId)];
      if (req.query.cashierId) conditions.push(eq(cashierShifts.cashierId, req.query.cashierId as string));
      if (req.query.status) conditions.push(eq(cashierShifts.status, req.query.status as string));
      const rows = await db
        .select()
        .from(cashierShifts)
        .where(and(...conditions))
        .orderBy(desc(cashierShifts.openedAt))
        .limit(200);
      res.json(rows);
    } catch (error) {
      console.error("[CashierShifts] list:", error);
      res.status(500).json({ message: "Failed to list cashier shifts" });
    }
  });

  app.post("/api/cashier-shifts/start", ...scoped, requireRole(...ALL_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id ?? "unknown";
      const body = startShiftSchema.parse(req.body ?? {});

      const shift = await startCashierShift(ctx.orgId, body.cashierId, userId);

      await recordAdminAudit(req, {
        actorUserId: userId,
        actorRole: req.orgContext?.role ?? "CASHIER",
        action: "cashier_shift.opened",
        targetType: "cashier_shift",
        targetId: shift.id,
        orgId: ctx.orgId,
        metadata: { cashierId: body.cashierId },
      });

      res.status(201).json(shift);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", errors: error.errors });
      if (error instanceof CashierShiftError) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("[CashierShifts] start:", error);
      res.status(500).json({ message: "Failed to start cashier shift" });
    }
  });

  app.post("/api/cashier-shifts/:id/end", ...scoped, requireRole(...ALL_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id ?? "unknown";

      const { shift, summary } = await closeCashierShift(ctx.orgId, req.params.id, {
        closedByUserId: userId,
        closeReason: "manual",
      });

      await recordAdminAudit(req, {
        actorUserId: userId,
        actorRole: req.orgContext?.role ?? "CASHIER",
        action: "cashier_shift.closed",
        targetType: "cashier_shift",
        targetId: shift.id,
        orgId: ctx.orgId,
        metadata: { commissionAmount: summary.commissionAmount, netSalesProfit: summary.netSalesProfit },
      });

      res.json({ shift, summary });
    } catch (error) {
      if (error instanceof CashierShiftError) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("[CashierShifts] end:", error);
      res.status(500).json({ message: "Failed to end cashier shift" });
    }
  });

  app.get("/api/cashier-shifts/:id/summary", ...scoped, requireRole(...ALL_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const [shift] = await db
        .select()
        .from(cashierShifts)
        .where(and(eq(cashierShifts.id, req.params.id), eq(cashierShifts.orgId, ctx.orgId)))
        .limit(1);
      if (!shift) return res.status(404).json({ message: "Cashier shift not found" });

      if (shift.status === "open") {
        const { sheet } = await computeCashierShiftBalanceSheet(ctx.orgId, shift);
        return res.json({ shift, summary: sheet, live: true });
      }

      const [summary] = await db
        .select()
        .from(cashierShiftSummaries)
        .where(eq(cashierShiftSummaries.shiftId, shift.id))
        .limit(1);
      res.json({ shift, summary: summary ?? null, live: false });
    } catch (error) {
      if (error instanceof CashierShiftError) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("[CashierShifts] summary:", error);
      res.status(500).json({ message: "Failed to build cashier shift summary" });
    }
  });

  app.get("/api/cashier-shifts/current/:cashierId", ...scoped, requireRole(...ALL_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const shift = await getOpenCashierShift(ctx.orgId, req.params.cashierId);
      res.json({ shift });
    } catch (error) {
      console.error("[CashierShifts] current:", error);
      res.status(500).json({ message: "Failed to fetch current cashier shift" });
    }
  });

  // ---------------- Commission ----------------

  app.get("/api/cashier-commission", ...scoped, requireRole(...CONFIRM_PAYMENT_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const conditions = [eq(cashierShiftSummaries.orgId, ctx.orgId)];
      if (req.query.cashierId) conditions.push(eq(cashierShiftSummaries.cashierId, req.query.cashierId as string));
      if (req.query.from) conditions.push(gte(cashierShiftSummaries.closedAt, new Date(req.query.from as string)));
      if (req.query.to) conditions.push(lte(cashierShiftSummaries.closedAt, new Date(req.query.to as string)));

      const summaries = await db
        .select({
          summary: cashierShiftSummaries,
          cashierCode: cashierProfiles.cashierCode,
          cashierName: cashierProfiles.displayName,
        })
        .from(cashierShiftSummaries)
        .innerJoin(cashierProfiles, eq(cashierShiftSummaries.cashierId, cashierProfiles.id))
        .where(and(...conditions))
        .orderBy(desc(cashierShiftSummaries.closedAt))
        .limit(500);

      const paidByShift = await db
        .select({ shiftId: cashierCommissionPayments.shiftId, amountPaid: cashierCommissionPayments.amountPaid })
        .from(cashierCommissionPayments)
        .where(eq(cashierCommissionPayments.orgId, ctx.orgId));
      const paidMap = new Map<string, number>();
      for (const row of paidByShift) {
        if (!row.shiftId) continue;
        paidMap.set(row.shiftId, (paidMap.get(row.shiftId) ?? 0) + parseFloat(String(row.amountPaid)));
      }

      res.json(
        summaries.map((row) => {
          const commissionAmount = parseFloat(String(row.summary.commissionAmount));
          const paid = paidMap.get(row.summary.shiftId) ?? 0;
          return {
            ...row.summary,
            cashierCode: row.cashierCode,
            cashierName: row.cashierName,
            amountPaid: paid,
            amountUnpaid: Math.max(0, Math.round((commissionAmount - paid) * 100) / 100),
            paidStatus: paid >= commissionAmount && commissionAmount > 0 ? "paid" : paid > 0 ? "partial" : "unpaid",
          };
        }),
      );
    } catch (error) {
      console.error("[CashierCommission] list:", error);
      res.status(500).json({ message: "Failed to load cashier commission" });
    }
  });

  app.get("/api/cashier-commission/payments", ...scoped, requireRole(...CONFIRM_PAYMENT_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const conditions = [eq(cashierCommissionPayments.orgId, ctx.orgId)];
      if (req.query.cashierId) conditions.push(eq(cashierCommissionPayments.cashierId, req.query.cashierId as string));

      const rows = await db
        .select()
        .from(cashierCommissionPayments)
        .where(and(...conditions))
        .orderBy(desc(cashierCommissionPayments.paidAt))
        .limit(500);
      res.json(rows);
    } catch (error) {
      console.error("[CashierCommission] payments list:", error);
      res.status(500).json({ message: "Failed to load commission payments" });
    }
  });

  app.post("/api/cashier-commission/payments", ...scoped, requireRole(...CONFIRM_PAYMENT_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id ?? "unknown";
      const body = commissionPaymentSchema.parse(req.body ?? {});

      const [cashier] = await db
        .select()
        .from(cashierProfiles)
        .where(and(eq(cashierProfiles.id, body.cashierId), eq(cashierProfiles.orgId, ctx.orgId)))
        .limit(1);
      if (!cashier) return res.status(404).json({ message: "Cashier profile not found" });

      const [payment] = await db
        .insert(cashierCommissionPayments)
        .values({
          orgId: ctx.orgId,
          cashierId: body.cashierId,
          shiftId: body.shiftId ?? null,
          amountPaid: String(body.amountPaid),
          confirmedByUserId: userId,
          notes: body.notes ?? null,
        })
        .returning();

      const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
      const amountLabel = formatMoney(body.amountPaid, org?.currency ?? "GBP");
      const message = `Commission paid — Cashier ${cashier.cashierCode} received ${amountLabel}`;

      await db.insert(orgNotifications).values({
        orgId: ctx.orgId,
        title: "Cashier commission paid",
        message,
        severity: "info",
        source: "cashier_commission",
        metadata: { cashierId: cashier.id, cashierCode: cashier.cashierCode, amountPaid: body.amountPaid, shiftId: body.shiftId ?? null },
      });

      await recordAdminAudit(req, {
        actorUserId: userId,
        actorRole: req.orgContext?.role ?? "MANAGER",
        action: "cashier_commission.paid",
        targetType: "cashier_commission_payment",
        targetId: payment.id,
        orgId: ctx.orgId,
        metadata: { cashierId: body.cashierId, amountPaid: body.amountPaid, shiftId: body.shiftId ?? null },
      });

      res.status(201).json(payment);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", errors: error.errors });
      console.error("[CashierCommission] payment create:", error);
      res.status(500).json({ message: "Failed to record commission payment" });
    }
  });
}
