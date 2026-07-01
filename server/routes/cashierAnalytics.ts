import type { Express, RequestHandler } from "express";
import { db } from "../db";
import {
  cashierProfiles,
  cashierShifts,
  cashierShiftSummaries,
  cashierCommissionPayments,
  orders,
} from "../../shared/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { requireRole } from "../auth";

const VIEW_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"] as const;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseRange(req: { query: Record<string, unknown> }): { from: Date; to: Date } {
  const now = new Date();
  const to = req.query.to ? new Date(String(req.query.to)) : now;
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export function registerCashierAnalyticsRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/cashier-analytics", ...scoped, requireRole(...VIEW_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const { from, to } = parseRange(req);
      const cashierId = req.query.cashierId as string | undefined;

      const cashiers = await db
        .select()
        .from(cashierProfiles)
        .where(and(eq(cashierProfiles.orgId, ctx.orgId), ...(cashierId ? [eq(cashierProfiles.id, cashierId)] : [])));

      const summaryConditions = [
        eq(cashierShiftSummaries.orgId, ctx.orgId),
        gte(cashierShiftSummaries.closedAt, from),
        lte(cashierShiftSummaries.closedAt, to),
        ...(cashierId ? [eq(cashierShiftSummaries.cashierId, cashierId)] : []),
      ];
      const summaries = await db.select().from(cashierShiftSummaries).where(and(...summaryConditions));

      const shiftConditions = [
        eq(cashierShifts.orgId, ctx.orgId),
        gte(cashierShifts.openedAt, from),
        lte(cashierShifts.openedAt, to),
        ...(cashierId ? [eq(cashierShifts.cashierId, cashierId)] : []),
      ];
      const shifts = await db.select().from(cashierShifts).where(and(...shiftConditions));

      const paymentConditions = [
        eq(cashierCommissionPayments.orgId, ctx.orgId),
        gte(cashierCommissionPayments.paidAt, from),
        lte(cashierCommissionPayments.paidAt, to),
        ...(cashierId ? [eq(cashierCommissionPayments.cashierId, cashierId)] : []),
      ];
      const payments = await db.select().from(cashierCommissionPayments).where(and(...paymentConditions));

      const orderAgg = await db
        .select({
          cashierId: orders.cashierId,
          orderCount: sql<number>`COUNT(*)`,
          totalSales: sql<number>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)), 0)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.orgId, ctx.orgId),
            gte(orders.createdAt, from),
            lte(orders.createdAt, to),
            sql`${orders.cashierId} IS NOT NULL`,
            ...(cashierId ? [eq(orders.cashierId, cashierId)] : []),
          ),
        )
        .groupBy(orders.cashierId);

      const summaryByCashier = new Map<string, typeof summaries>();
      for (const s of summaries) {
        const list = summaryByCashier.get(s.cashierId) ?? [];
        list.push(s);
        summaryByCashier.set(s.cashierId, list);
      }
      const shiftsByCashier = new Map<string, typeof shifts>();
      for (const s of shifts) {
        const list = shiftsByCashier.get(s.cashierId) ?? [];
        list.push(s);
        shiftsByCashier.set(s.cashierId, list);
      }
      const paidByCashier = new Map<string, number>();
      for (const p of payments) {
        paidByCashier.set(p.cashierId, (paidByCashier.get(p.cashierId) ?? 0) + parseFloat(String(p.amountPaid)));
      }
      const orderAggByCashier = new Map(orderAgg.map((o) => [o.cashierId as string, o]));

      const metrics = cashiers.map((cashier) => {
        const cashierSummaries = summaryByCashier.get(cashier.id) ?? [];
        const cashierShiftsList = shiftsByCashier.get(cashier.id) ?? [];
        const orderStats = orderAggByCashier.get(cashier.id);

        const totalSales = roundMoney(cashierSummaries.reduce((s, r) => s + parseFloat(String(r.grossSales)), 0));
        const paidSalesReceived = roundMoney(
          cashierSummaries.reduce((s, r) => s + parseFloat(String(r.grossSales)) - parseFloat(String(r.unpaidCreditSales)), 0),
        );
        const creditSales = roundMoney(cashierSummaries.reduce((s, r) => s + parseFloat(String(r.creditSales)), 0));
        const netSalesProfit = roundMoney(cashierSummaries.reduce((s, r) => s + parseFloat(String(r.netSalesProfit)), 0));
        const commissionEarned = roundMoney(cashierSummaries.reduce((s, r) => s + parseFloat(String(r.commissionAmount)), 0));
        const commissionPaid = roundMoney(paidByCashier.get(cashier.id) ?? 0);
        const commissionUnpaid = roundMoney(Math.max(0, commissionEarned - commissionPaid));

        const shiftDurationMs = cashierShiftsList.reduce((s, sh) => {
          const end = sh.closedAt ? new Date(sh.closedAt).getTime() : Date.now();
          const start = sh.openedAt ? new Date(sh.openedAt).getTime() : end;
          return s + Math.max(0, end - start);
        }, 0);
        const shiftHours = shiftDurationMs / (1000 * 60 * 60);

        const orderCount = Number(orderStats?.orderCount ?? 0);
        const orderTotalSales = Number(orderStats?.totalSales ?? 0);

        return {
          cashierId: cashier.id,
          cashierCode: cashier.cashierCode,
          cashierName: cashier.displayName,
          isActive: cashier.isActive,
          totalSales,
          paidSalesReceived,
          creditSales,
          netSalesProfit,
          commissionEarned,
          commissionPaid,
          commissionUnpaid,
          shiftCount: cashierShiftsList.length,
          shiftDurationHours: roundMoney(shiftHours),
          salesPerHour: shiftHours > 0 ? roundMoney(orderTotalSales / shiftHours) : 0,
          profitPerHour: shiftHours > 0 ? roundMoney(netSalesProfit / shiftHours) : 0,
          orderCount,
          averageOrderValue: orderCount > 0 ? roundMoney(orderTotalSales / orderCount) : 0,
        };
      });

      const top = (key: keyof (typeof metrics)[number], limit = 5) =>
        [...metrics].sort((a, b) => Number(b[key]) - Number(a[key])).slice(0, limit);

      const shiftStatusCounts = {
        open: shifts.filter((s) => s.status === "open").length,
        closed: shifts.filter((s) => s.status === "closed").length,
        autoClosed: shifts.filter((s) => s.status === "auto_closed").length,
        manualClosed: shifts.filter((s) => s.status === "closed" && s.closeReason === "manual").length,
        shiftsWithUnpaidCommission: metrics.filter((m) => m.commissionUnpaid > 0).length,
      };

      res.json({
        range: { from: from.toISOString(), to: to.toISOString() },
        metrics,
        leaderboards: {
          topSales: top("totalSales"),
          topNetProfit: top("netSalesProfit"),
          topCommission: top("commissionEarned"),
          longestShifts: top("shiftDurationHours"),
          bestSalesPerHour: top("salesPerHour"),
          mostOrders: top("orderCount"),
        },
        shiftStatus: shiftStatusCounts,
      });
    } catch (error) {
      console.error("[CashierAnalytics] summary:", error);
      res.status(500).json({ message: "Failed to load cashier analytics" });
    }
  });

  app.get("/api/cashier-analytics/export.csv", ...scoped, requireRole(...VIEW_ROLES), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const { from, to } = parseRange(req);
      const summaries = await db
        .select({
          summary: cashierShiftSummaries,
          cashierCode: cashierProfiles.cashierCode,
          cashierName: cashierProfiles.displayName,
        })
        .from(cashierShiftSummaries)
        .innerJoin(cashierProfiles, eq(cashierShiftSummaries.cashierId, cashierProfiles.id))
        .where(
          and(
            eq(cashierShiftSummaries.orgId, ctx.orgId),
            gte(cashierShiftSummaries.closedAt, from),
            lte(cashierShiftSummaries.closedAt, to),
          ),
        )
        .orderBy(cashierShiftSummaries.closedAt);

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
      const rows = summaries.map((row) =>
        [
          row.cashierCode,
          row.cashierName,
          row.summary.closedAt?.toISOString() ?? "",
          row.summary.grossSales,
          row.summary.netSalesProfit,
          row.summary.commissionRate,
          row.summary.commissionAmount,
          row.summary.businessRetainedProfit,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );
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
