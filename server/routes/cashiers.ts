import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  cashierProfiles,
  cashierShifts,
  cashierShiftSummaries,
  cashierCommissionPayments,
  organizations,
  users,
} from "../../shared/schema";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { requireRole } from "../auth";
import { recordAdminAudit } from "../adminAudit";
import {
  closeCashierShift,
  getOpenCashierShift,
  computeCashierShiftBalanceSheet,
  CashierShiftError,
} from "../services/cashierShiftEngine";
import { createCashierShiftReplayToken } from "../services/cashierShiftReplayToken";
import { resolveUserName } from "../services/userDisplayName";
import { notify } from "../services/signals";
import { loadStaffRole, loadStaffRoles } from "../services/staffRoles";
import { rolesAtLeast } from "@shared/accessPolicy";
import { canSeePayRow } from "@shared/reports/payroll";
import {
  STAFF_LIST_MIN_ROLE,
  canSeeCommissionRates,
  cashierProfileForRole,
  mayConfirmCommissionPayment,
  maySeeShiftSheet,
  type ShiftSheetOwner,
} from "@shared/staffPolicy";
import type { Role } from "@shared/rbac";

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

/**
 * ARC-004: a shift opened lazily on first sale (migration 058) has no
 * cashier code, so `cashierId` can no longer be required here — the client
 * has nothing to send for it and every "Confirm paid" on such a shift 400'd
 * before this fix. `cashierId` is now the LEGACY identifier (kept exactly as
 * it worked before, for shifts that do have a code); `userId` is the
 * migration-057 identifier for shifts that don't. `shiftId` alone is also
 * enough — the handler resolves whichever identity that shift actually
 * carries — since every "Confirm paid" click already has a shift in hand.
 * The refine just keeps a payment from being recorded for literally nobody.
 */
const commissionPaymentSchema = z
  .object({
    cashierId: z.string().uuid("cashierId must be a uuid").optional().nullable(),
    userId: z.string().trim().min(1).max(255).optional().nullable(),
    shiftId: z.string().uuid().optional().nullable(),
    amountPaid: z.coerce.number().positive("Amount paid must be positive"),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((v) => !!v.cashierId || !!v.userId || !!v.shiftId, {
    message: "One of cashierId, userId or shiftId is required to identify who is being paid",
  });

type CashierShiftRow = typeof cashierShifts.$inferSelect;

/**
 * Whose shift sheet this is. A lazy shift belongs to its user. A legacy
 * coded shift has no user, only a cashier code — codes were only ever
 * cashiers — and belongs to whoever opened it under that code.
 */
function shiftOwner(shift: CashierShiftRow, roles: Map<string, Role | null>): ShiftSheetOwner {
  if (shift.userId) return { userId: shift.userId, role: roles.get(shift.userId) ?? null };
  return { userId: shift.openedByUserId, role: "CASHIER" };
}

function viewerOf(req: any): { userId: string | null; role: string | null } {
  return { userId: req.user?.id ?? null, role: req.orgContext?.role ?? req.user?.role ?? null };
}

async function canViewShiftSheet(req: any, orgId: string, shift: CashierShiftRow): Promise<boolean> {
  const viewer = viewerOf(req);
  if (viewer.role === "SUPER_ADMIN" || viewer.role === "ADMIN") return true;
  const roles = await loadStaffRoles(orgId, [shift.userId]);
  return maySeeShiftSheet(viewer, shiftOwner(shift, roles));
}

const NOT_YOUR_SHIFT = "You can only see your own shift sheet.";

function formatMoney(amount: number, currency = "GBP"): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return `£${amount.toFixed(2)}`;
  }
}

function cashierShiftWithReplayToken(shift: typeof cashierShifts.$inferSelect) {
  // Offline replay is keyed on the cashier code, so a shift that has none gets
  // no token. Issuing one with an empty code would sign a claim the validator
  // can never match, which fails obscurely later instead of plainly here.
  if (!shift.cashierId) return { ...shift, replayToken: null };
  return {
    ...shift,
    replayToken: createCashierShiftReplayToken({
      orgId: shift.orgId,
      cashierId: shift.cashierId,
      cashierShiftId: shift.id,
      openedAt: shift.openedAt.toISOString(),
      openedByUserId: shift.openedByUserId,
    }),
  };
}

export function registerCashierRoutes(app: Express, scoped: RequestHandler[]): void {
  // ---------------- Cashier profiles ----------------

  // The staff list is manager and above. PINs never leave the server, and the
  // commission override is admin only (cashierProfileForRole).
  app.get("/api/cashiers", ...scoped, requireRole(...rolesAtLeast(STAFF_LIST_MIN_ROLE)), async (req: any, res) => {
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
      res.json(rows.map((row) => cashierProfileForRole(row, viewerOf(req).role)));
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
        metadata: {
          cashierCode: created.cashierCode,
          defaultCommissionRate: created.defaultCommissionRate,
          pinSet: !!created.pinCode,
        },
      });

      res.status(201).json(cashierProfileForRole(created, viewerOf(req).role));
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

      // The old rate goes on the log beside the new one: a rate change is a pay change.
      const [before] = await db
        .select({ defaultCommissionRate: cashierProfiles.defaultCommissionRate })
        .from(cashierProfiles)
        .where(and(eq(cashierProfiles.id, req.params.id), eq(cashierProfiles.orgId, ctx.orgId)))
        .limit(1);

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
        // Never the PIN itself: the audit log is read by more people than set it.
        metadata: {
          patch: { ...body, pinCode: undefined },
          pinChanged: body.pinCode !== undefined,
          ...(body.defaultCommissionRate !== undefined
            ? { commissionRate: { from: before?.defaultCommissionRate ?? null, to: updated.defaultCommissionRate } }
            : {}),
        },
      });

      res.json(cashierProfileForRole(updated, viewerOf(req).role));
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

      res.json(cashierProfileForRole(updated, viewerOf(req).role));
    } catch (error) {
      console.error("[Cashiers] deactivate:", error);
      res.status(500).json({ message: "Failed to deactivate cashier profile" });
    }
  });

  // ---------------- Cashier shifts ----------------

  app.get("/api/cashier-shifts", ...scoped, requireRole(...ALL_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const viewer = viewerOf(req);
      const conditions = [eq(cashierShifts.orgId, ctx.orgId)];
      if (req.query.cashierId) conditions.push(eq(cashierShifts.cashierId, req.query.cashierId as string));
      if (req.query.status) conditions.push(eq(cashierShifts.status, req.query.status as string));
      // A cashier's list is their own shifts, filtered in the query so the
      // 200-row cap is theirs too rather than the whole team's.
      if (viewer.role === "CASHIER") {
        const me = viewer.userId ?? "";
        conditions.push(
          or(eq(cashierShifts.userId, me), and(isNull(cashierShifts.userId), eq(cashierShifts.openedByUserId, me)))!,
        );
      }
      const rows = await db
        .select()
        .from(cashierShifts)
        .where(and(...conditions))
        .orderBy(desc(cashierShifts.openedAt))
        .limit(200);
      const roles = await loadStaffRoles(ctx.orgId, rows.map((r) => r.userId));
      res.json(rows.filter((row) => maySeeShiftSheet(viewer, shiftOwner(row, roles))));
    } catch (error) {
      console.error("[CashierShifts] list:", error);
      res.status(500).json({ message: "Failed to list cashier shifts" });
    }
  });

  // POST /api/cashier-shifts/start is retired (STF-FN1). It opened a shift
  // under a cashier code, which nothing in the app does any more: shifts open
  // lazily on first sale, keyed by the person. Left in place it let any role
  // open coded shifts through the API, which is what emptied the staff
  // Evidence in the first place.

  app.post("/api/cashier-shifts/:id/end", ...scoped, requireRole(...ALL_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role?: string };
      const userId = req.user?.id ?? "unknown";

      const { shift, summary } = await closeCashierShift(ctx.orgId, req.params.id, {
        closedByUserId: userId,
        closeReason: "manual",
        // Cashiers may only close their own shift; managers/admins can close any.
        requireOwnerUserId: ctx.role === "CASHIER" ? userId : null,
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
      if (!(await canViewShiftSheet(req, ctx.orgId, shift))) {
        return res.status(403).json({ message: NOT_YOUR_SHIFT });
      }

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

  // ARC-012: "current/:cashierId" (above) is keyed on a cashier CODE, which a
  // shift opened lazily on first sale (058) does not have — there is no code
  // for a codeless cashier to pass it. This is the user-keyed equivalent: the
  // logged-in person's own open shift, found without opening one (a GET must
  // not have that side effect) and with no code required at all.
  app.get("/api/cashier-shifts/mine", ...scoped, requireRole(...ALL_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const [open] = await db
        .select()
        .from(cashierShifts)
        .where(and(eq(cashierShifts.orgId, ctx.orgId), eq(cashierShifts.userId, userId), eq(cashierShifts.status, "open")))
        .orderBy(desc(cashierShifts.openedAt))
        .limit(1);
      res.json({ shift: open ?? null });
    } catch (error) {
      console.error("[CashierShifts] mine:", error);
      res.status(500).json({ message: "Failed to fetch current shift" });
    }
  });

  app.get("/api/cashier-shifts/current/:cashierId", ...scoped, requireRole(...ALL_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const shift = await getOpenCashierShift(ctx.orgId, req.params.cashierId);
      if (shift && !(await canViewShiftSheet(req, ctx.orgId, shift))) {
        return res.status(403).json({ message: NOT_YOUR_SHIFT });
      }
      res.json({ shift: shift ? cashierShiftWithReplayToken(shift) : null });
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

      // LEFT joins, both of them.
      //
      // This was an INNER JOIN on cashier_profiles, which silently emptied the
      // payroll list of every shift taken since L2: a shift opened on first
      // sale has no cashier code, so `cashierId` is null, and an inner join on
      // a null matches nothing. Commission accrued correctly and simply never
      // appeared on the screen that says who is owed it.
      const summaries = await db
        .select({
          summary: cashierShiftSummaries,
          cashierCode: cashierProfiles.cashierCode,
          cashierDisplayName: cashierProfiles.displayName,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userEmail: users.email,
        })
        .from(cashierShiftSummaries)
        .leftJoin(cashierProfiles, eq(cashierShiftSummaries.cashierId, cashierProfiles.id))
        .leftJoin(users, eq(cashierShiftSummaries.userId, users.id))
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

      // Only the rows whose pay this viewer may see (Q12, Q13a), and the rate
      // each was paid at only for admins (Q16).
      const viewer = viewerOf(req);
      const payRoles = await loadStaffRoles(ctx.orgId, summaries.map((row) => row.summary.userId));
      const showRates = canSeeCommissionRates(viewer.role);
      const visible = summaries.filter((row) => {
        const key = row.summary.userId ?? `code:${row.summary.cashierId ?? ""}`;
        return canSeePayRow(viewer, { key, role: row.summary.userId ? payRoles.get(row.summary.userId) ?? null : null });
      });

      res.json(
        visible.map((row) => {
          const commissionAmount = parseFloat(String(row.summary.commissionAmount));
          const paid = paidMap.get(row.summary.shiftId) ?? 0;
          // Whoever the shift belonged to, named however we can name them: the
          // cashier code's display name for historic shifts, the user account
          // for everything since. Falling back to the email rather than to
          // nothing, because an unnamed row on a payroll screen is unusable.
          const userName = [row.userFirstName, row.userLastName]
            .filter(Boolean)
            .join(" ")
            .trim();
          const { commissionRate, ...summary } = row.summary;
          return {
            ...summary,
            ...(showRates ? { commissionRate } : {}),
            cashierCode: row.cashierCode,
            cashierName:
              row.cashierDisplayName || userName || row.userEmail || "Unknown",
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
      // A codeless payment (ARC-004) has no cashierId to filter on — userId is
      // its identity, so it needs its own filter rather than being invisible
      // to every query that only ever thought to ask for a cashierId.
      if (req.query.userId) conditions.push(eq(cashierCommissionPayments.userId, req.query.userId as string));

      const rows = await db
        .select()
        .from(cashierCommissionPayments)
        .where(and(...conditions))
        .orderBy(desc(cashierCommissionPayments.paidAt))
        .limit(500);
      const viewer = viewerOf(req);
      const payRoles = await loadStaffRoles(ctx.orgId, rows.map((r) => r.userId));
      res.json(
        rows.filter((r) =>
          canSeePayRow(viewer, { key: r.userId ?? `code:${r.cashierId ?? ""}`, role: r.userId ? payRoles.get(r.userId) ?? null : null }),
        ),
      );
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

      // Legacy path, UNCHANGED: a cashier code was named, so it must resolve
      // to a real profile in this org exactly as it always has.
      let cashier: typeof cashierProfiles.$inferSelect | null = null;
      let payeeCashierId: string | null = body.cashierId ?? null;
      let payeeUserId: string | null = body.userId ?? null;

      if (payeeCashierId) {
        const [found] = await db
          .select()
          .from(cashierProfiles)
          .where(and(eq(cashierProfiles.id, payeeCashierId), eq(cashierProfiles.orgId, ctx.orgId)))
          .limit(1);
        if (!found) return res.status(404).json({ message: "Cashier profile not found" });
        cashier = found;
      } else if (!payeeUserId && body.shiftId) {
        // ARC-004: no code and no userId were sent, but a shift was — the
        // shift itself is the source of truth for who it belongs to, whether
        // that is a legacy code or (since migration 057/058) a user.
        const [shift] = await db
          .select({ cashierId: cashierShifts.cashierId, userId: cashierShifts.userId })
          .from(cashierShifts)
          .where(and(eq(cashierShifts.id, body.shiftId), eq(cashierShifts.orgId, ctx.orgId)))
          .limit(1);
        if (!shift) return res.status(404).json({ message: "Cashier shift not found" });
        payeeCashierId = shift.cashierId;
        payeeUserId = shift.userId;
        if (payeeCashierId) {
          const [found] = await db
            .select()
            .from(cashierProfiles)
            .where(and(eq(cashierProfiles.id, payeeCashierId), eq(cashierProfiles.orgId, ctx.orgId)))
            .limit(1);
          cashier = found ?? null;
        }
      }

      if (!payeeCashierId && !payeeUserId) {
        return res.status(400).json({ message: "Could not identify who this payment is for" });
      }

      // No one confirms their own pay; below the owner, only cashiers' (Q13a).
      const verdict = mayConfirmCommissionPayment(viewerOf(req), {
        userId: payeeUserId,
        role: await loadStaffRole(ctx.orgId, payeeUserId),
      });
      if (!verdict.ok) return res.status(verdict.status).json({ message: verdict.message, code: "COMMISSION_CONFIRM_FORBIDDEN" });

      const [payment] = await db
        .insert(cashierCommissionPayments)
        .values({
          orgId: ctx.orgId,
          cashierId: payeeCashierId,
          userId: payeeUserId,
          shiftId: body.shiftId ?? null,
          amountPaid: String(body.amountPaid),
          confirmedByUserId: userId,
          notes: body.notes ?? null,
        })
        .returning();

      const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1);
      const amountLabel = formatMoney(body.amountPaid, org?.currency ?? "GBP");
      // Named by whichever identity the payment actually carries — the
      // cashier code when there is one, else the user's own name, so a
      // codeless shift's payment notification reads as well as a coded one's.
      const payeeLabel = cashier
        ? `Cashier ${cashier.cashierCode}`
        : await resolveUserName(payeeUserId ?? "unknown");
      const message = `Commission paid — ${payeeLabel} received ${amountLabel}`;

      // Pay is admin business: this goes to admins (and the owner), never
      // team-wide, and not to the person paid (shared/signals.ts).
      await notify({
        orgId: ctx.orgId,
        title: "Cashier commission paid",
        message,
        severity: "info",
        source: "cashier_commission",
        subjectUserId: payeeUserId ?? null,
        metadata: {
          cashierId: payeeCashierId,
          cashierCode: cashier?.cashierCode ?? null,
          userId: payeeUserId,
          amountPaid: body.amountPaid,
          shiftId: body.shiftId ?? null,
        },
      });

      await recordAdminAudit(req, {
        actorUserId: userId,
        actorRole: req.orgContext?.role ?? "MANAGER",
        action: "cashier_commission.paid",
        targetType: "cashier_commission_payment",
        targetId: payment.id,
        orgId: ctx.orgId,
        metadata: { cashierId: payeeCashierId, userId: payeeUserId, amountPaid: body.amountPaid, shiftId: body.shiftId ?? null },
      });

      res.status(201).json(payment);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", errors: error.errors });
      console.error("[CashierCommission] payment create:", error);
      res.status(500).json({ message: "Failed to record commission payment" });
    }
  });
}
