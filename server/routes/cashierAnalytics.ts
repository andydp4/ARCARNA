import type { Express, RequestHandler } from "express";
import { db } from "../db";
import {
  allowedUsers,
  cashierProfiles,
  cashierShifts,
  cashierShiftSummaries,
  cashierCommissionPayments,
  orders,
  users,
} from "../../shared/schema";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { requireRole } from "../auth";
import { recordAdminAudit } from "../adminAudit";
import { EXPORT_MIN_ROLE, rolesAtLeast } from "@shared/accessPolicy";
import { csvRow } from "@shared/csv";
import { isRole, type Role } from "@shared/rbac";
import { currentTradingDay, shiftIsoDate, tradingDayBounds } from "@shared/time/tradingDay";
import {
  buildPayrollMetrics,
  canSeePayRow,
  personKey,
  type PayrollPerson,
} from "@shared/reports/payroll";
import { orgTimeZone } from "../services/tradingDayShift";
import { shiftsInRange, tradingDayRange } from "../services/payrollRange";

const VIEW_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;
// Exports are admin only and every one is logged (Q12).
const exportRoles = requireRole(...rolesAtLeast(EXPORT_MIN_ROLE));

/**
 * Name and role for every row key. A person is named from their org login
 * (allowed_users), then their user record; a code-only row from its code. No
 * email fallback — pay rows are not a contact list.
 */
async function loadPeople(orgId: string, keys: string[]): Promise<Map<string, PayrollPerson>> {
  const people = new Map<string, PayrollPerson>();
  const userIds = keys.filter((k) => !k.startsWith("code:"));
  const codeIds = keys.filter((k) => k.startsWith("code:")).map((k) => k.slice(5));
  if (userIds.length) {
    const [logins, userRows] = await Promise.all([
      db
        .select({
          authUserId: allowedUsers.authUserId,
          replitUserId: allowedUsers.replitUserId,
          name: allowedUsers.name,
          role: allowedUsers.role,
          orgId: allowedUsers.orgId,
        })
        .from(allowedUsers)
        .where(
          and(
            or(inArray(allowedUsers.authUserId, userIds), inArray(allowedUsers.replitUserId, userIds)),
            or(eq(allowedUsers.orgId, orgId), isNull(allowedUsers.orgId)),
          ),
        ),
      db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
        .from(users)
        .where(inArray(users.id, userIds)),
    ]);
    const loginBySubject = new Map<string, (typeof logins)[number]>();
    for (const l of logins) {
      if (l.authUserId) loginBySubject.set(l.authUserId, l);
      loginBySubject.set(l.replitUserId, l);
    }
    const userById = new Map(userRows.map((u) => [u.id, u]));
    for (const id of userIds) {
      const login = loginBySubject.get(id);
      const user = userById.get(id);
      const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
      const rawRole = String(login?.role ?? user?.role ?? "");
      people.set(id, {
        key: id,
        name: login?.name?.trim() || fullName || "Unnamed",
        role: isRole(rawRole) ? (rawRole as Role) : null,
      });
    }
  }
  if (codeIds.length) {
    const codes = await db
      .select({ id: cashierProfiles.id, code: cashierProfiles.cashierCode, name: cashierProfiles.displayName })
      .from(cashierProfiles)
      .where(and(eq(cashierProfiles.orgId, orgId), inArray(cashierProfiles.id, codeIds)));
    for (const c of codes) {
      people.set(`code:${c.id}`, { key: `code:${c.id}`, name: `${c.name} (code ${c.code})`, role: null });
    }
  }
  return people;
}

export function registerCashierAnalyticsRoutes(app: Express, scoped: RequestHandler[]): void {
  /**
   * The Payroll table, one row per person (STF-FN3). Every figure in a row
   * uses the same trading days: shifts by their trading day, their summaries
   * and payments through the shift, and orders by who completed them, settled
   * inside those days. Rows are limited to whose pay the viewer may see
   * (canSeePayRow: Q12, Q13a).
   */
  app.get("/api/cashier-analytics", ...scoped, requireRole(...VIEW_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      const timeZone = await orgTimeZone(ctx.orgId);
      const range = tradingDayRange(req.query, timeZone);
      const staffId = typeof req.query.staffId === "string" && req.query.staffId ? req.query.staffId : null;

      const shifts = await shiftsInRange(ctx.orgId, range);
      const shiftIds = shifts.map((s) => s.id);

      const [summaries, payments, orderAgg] = await Promise.all([
        shiftIds.length
          ? db
              .select()
              .from(cashierShiftSummaries)
              .where(and(eq(cashierShiftSummaries.orgId, ctx.orgId), inArray(cashierShiftSummaries.shiftId, shiftIds)))
          : Promise.resolve([]),
        db
          .select()
          .from(cashierCommissionPayments)
          .where(
            and(
              eq(cashierCommissionPayments.orgId, ctx.orgId),
              or(
                ...(shiftIds.length ? [inArray(cashierCommissionPayments.shiftId, shiftIds)] : []),
                and(
                  isNull(cashierCommissionPayments.shiftId),
                  gte(cashierCommissionPayments.paidAt, range.start),
                  lt(cashierCommissionPayments.paidAt, range.end),
                ),
              ),
            ),
          ),
        // A completed-work measure: only orders this person finished and that
        // settled in the window. Personal use is stock leaving as a write-off,
        // not a sale, so it is left out wherever its status ends up.
        db
          .select({
            userId: orders.completedUserId,
            orderCount: sql<number>`COUNT(*)::int`,
            sales: sql<number>`COALESCE(SUM(COALESCE(${orders.settledTotal}, ${orders.total})::numeric), 0)::float8`,
          })
          .from(orders)
          .where(
            and(
              eq(orders.orgId, ctx.orgId),
              eq(orders.status, "completed"),
              ne(orders.paymentMethod, "personal_use"),
              isNotNull(orders.completedUserId),
              gte(orders.settledAt, range.start),
              lt(orders.settledAt, range.end),
            ),
          )
          .groupBy(orders.completedUserId),
      ]);

      const keys = new Set<string>();
      for (const r of [...shifts, ...summaries, ...payments]) {
        const k = personKey(r.userId, r.cashierId);
        if (k) keys.add(k);
      }
      for (const o of orderAgg) if (o.userId) keys.add(o.userId);
      const people = await loadPeople(ctx.orgId, [...keys]);

      const viewer = { userId: (req.user?.id as string | undefined) ?? null, role: ctx.role };
      const all = buildPayrollMetrics({
        people,
        shifts,
        summaries,
        payments,
        orders: orderAgg.filter((o): o is typeof o & { userId: string } => !!o.userId),
      });
      const metrics = all.filter((m) => canSeePayRow(viewer, m) && (!staffId || m.key === staffId));
      const visible = new Set(metrics.map((m) => m.key));
      const visibleShifts = shifts.filter((s) => visible.has(personKey(s.userId, s.cashierId) ?? ""));

      res.json({
        range: { from: range.fromIso, to: range.toIso },
        metrics,
        shiftStatus: {
          open: visibleShifts.filter((s) => s.status === "open").length,
          closed: visibleShifts.filter((s) => s.status === "closed").length,
          autoClosed: visibleShifts.filter((s) => s.status === "auto_closed").length,
          manualClosed: visibleShifts.filter((s) => s.status === "closed" && s.closeReason === "manual").length,
          shiftsWithUnpaidCommission: metrics.filter((m) => m.commissionUnpaid > 0).length,
        },
      });
    } catch (error) {
      console.error("[CashierAnalytics] summary:", error);
      res.status(500).json({ message: "Failed to load cashier analytics" });
    }
  });

  app.get("/api/cashier-analytics/export.csv", ...scoped, exportRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role: string };
      // The same trading days and the same shifts as the Payroll table, so the
      // export's total matches the screen it was exported from (the whole `to`
      // day included, not only up to its midnight).
      const range = tradingDayRange(req.query, await orgTimeZone(ctx.orgId));
      const shiftIds = (await shiftsInRange(ctx.orgId, range)).map((s) => s.id);
      // LEFT join for the same reason /api/cashier-commission uses one: a
      // shift opened on first sale has no cashier code, and an inner join on
      // that null would drop every shift taken since L2 out of the export —
      // quietly, leaving a CSV that looks complete and is not.
      const summaries = shiftIds.length
        ? await db
            .select({ summary: cashierShiftSummaries, cashierCode: cashierProfiles.cashierCode })
            .from(cashierShiftSummaries)
            .leftJoin(cashierProfiles, eq(cashierShiftSummaries.cashierId, cashierProfiles.id))
            .where(and(eq(cashierShiftSummaries.orgId, ctx.orgId), inArray(cashierShiftSummaries.shiftId, shiftIds)))
            .orderBy(cashierShiftSummaries.closedAt)
        : [];

      const header = [
        "cashierCode",
        "cashierName",
        "closedAt",
        "grossSales",
        "netSalesProfit",
        "commissionRate",
        "commissionAmount",
        "businessRetainedProfit",
      ];
      // Names and roles resolved the same way as the table, and the same rule
      // applied: an admin exports cashiers' pay and their own, never managers'
      // (Q13a).
      const keyOf = (row: (typeof summaries)[number]) => personKey(row.summary.userId, row.summary.cashierId) ?? "";
      const people = await loadPeople(ctx.orgId, [...new Set(summaries.map(keyOf).filter(Boolean))]);
      const viewer = { userId: (req.user?.id as string | undefined) ?? null, role: ctx.role };
      const visible = summaries.filter((row) => {
        const key = keyOf(row);
        return canSeePayRow(viewer, { key, role: people.get(key)?.role ?? null });
      });
      const rows = visible.map((row) =>
        csvRow([
          row.cashierCode ?? "",
          people.get(keyOf(row))?.name ?? "Unknown",
          row.summary.closedAt?.toISOString() ?? "",
          row.summary.grossSales,
          row.summary.netSalesProfit,
          row.summary.commissionRate,
          row.summary.commissionAmount,
          row.summary.businessRetainedProfit,
        ]),
      );
      await recordAdminAudit(req, {
        actorUserId: req.user?.id ?? "unknown",
        actorRole: ctx.role,
        action: "export.payroll",
        targetType: "payroll",
        orgId: ctx.orgId,
        metadata: { from: range.fromIso, to: range.toIso, rows: rows.length },
      });
      const csv = [header.join(","), ...rows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="cashier-payroll-export.csv"');
      res.send(csv);
    } catch (error) {
      console.error("[CashierAnalytics] export:", error);
      res.status(500).json({ message: "Failed to export cashier payroll" });
    }
  });
}
