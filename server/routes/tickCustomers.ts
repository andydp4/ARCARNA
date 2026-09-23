import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { isAuthenticated, isOwner, requireRole, requireOrgContext, requireOrgScope, requireSuperAdminMfa } from "../auth";
import { getAuthRuntimeSnapshot, getAuthProvider } from "../authRuntime";
import { canAssignRole, canManageUser, isRole } from "@shared/rbac";
import type { Role } from "@shared/schema";
import { recordAdminAudit } from "../adminAudit";
import {
  insertLoyaltyTierSchema,
  insertPromotionSchema,
  insertOrderSchema,
  insertCustomerSchema,
  insertProductSchema,
  insertOverheadExpenseSchema,
  insertOrderExpenseSchema,
} from "@shared/schema";
import { rolesAtLeast } from "@shared/accessPolicy";
import { CREDIT_MIN_ROLE, checkClearWholeTab } from "@shared/creditPolicy";
import { creditPaymentTerms, signalCreditPayment } from "../services/creditPaymentRules";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function registerTickCustomerRoutes(app: Express, scoped: RequestHandler[]): void {
  // The Credit List is manager and above (owner decision Q11), on the menu and
  // here: a hidden menu entry does not stop the till's session calling these.
  const creditRoles = requireRole(...rolesAtLeast(CREDIT_MIN_ROLE));

  app.get("/api/tick-customers", ...scoped, creditRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) return res.status(403).json({ message: 'Organization scope required' });

      const allCustomers = await storage.getCustomers(ctx.orgId);
      // What is owed comes from the credit records, not from order status. An
      // order's status says whether the goods have gone; only the credit record
      // knows whether the money has arrived, and a part-paid account owes the
      // remainder rather than the whole invoice.
      const { db: appDb } = await import('../db');
      const { orderCredit } = await import('@shared/schema');
      const { eq, and, inArray, desc } = await import('drizzle-orm');
      const creditRows = await appDb
        .select({
          customerId: orderCredit.customerId,
          orderId: orderCredit.orderId,
          amountGiven: orderCredit.amountGiven,
          amountOutstanding: orderCredit.amountOutstanding,
          status: orderCredit.status,
          givenOn: orderCredit.givenOn,
        })
        .from(orderCredit)
        .where(and(
          eq(orderCredit.orgId, ctx.orgId),
          inArray(orderCredit.status, ['outstanding', 'partial']),
        ))
        .orderBy(desc(orderCredit.givenOn));

      // Two or more credit sales against the same customer are one account, not
      // separate rows — grouped here so the list totals what they actually owe
      // instead of listing every tick sparsely, and so the click-through detail
      // has the order numbers that make up the total.
      const rowsByCustomer = new Map<string, typeof creditRows>();
      for (const row of creditRows) {
        if (!row.customerId) continue;
        const list = rowsByCustomer.get(row.customerId) ?? [];
        list.push(row);
        rowsByCustomer.set(row.customerId, list);
      }

      const tickCustomers = Array.from(rowsByCustomer.entries()).map(([customerId, rows]) => {
        const customer = allCustomers.find(c => c.id === customerId);
        return {
          id: customerId,
          name: customer?.name || 'Unknown Customer',
          email: customer?.email || '',
          phone: customer?.phone || '',
          totalDebt: roundMoney(rows.reduce((sum, r) => sum + Number(r.amountOutstanding), 0)),
          // `rows` is already newest-first (query is ordered desc(givenOn)).
          lastOrderDate: rows[0].givenOn,
          orders: rows.map(r => ({
            id: r.orderId,
            shortCode: r.orderId.slice(0, 8),
            date: r.givenOn,
            amountGiven: Number(r.amountGiven),
            amountOutstanding: Number(r.amountOutstanding),
            status: r.status === 'partial' ? ('partial' as const) : ('pending' as const),
          })),
        };
      });

      res.json(tickCustomers);
    } catch (error) {
      console.error("Error fetching credit customers:", error);
      res.status(500).json({ message: "Failed to fetch credit customers" });
    }
  });

  app.delete(
    "/api/tick-customers/:id",
    ...scoped,
    creditRoles,
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
        if (!ctx?.orgId) return res.status(403).json({ message: 'Organization scope required' });
        const customer = await storage.getCustomer(req.params.id, ctx.orgId);
        if (!customer) return res.status(404).json({ message: 'Customer not found' });

        const { db } = await import('../db');
        const { orderCredit } = await import('@shared/schema');
        const { and, eq, inArray } = await import('drizzle-orm');
        const { writeOffCredit } = await import('../services/creditLedger');

        const owing = await db
          .select({ orderId: orderCredit.orderId })
          .from(orderCredit)
          .where(and(
            eq(orderCredit.orgId, ctx.orgId),
            eq(orderCredit.customerId, req.params.id),
            inArray(orderCredit.status, ['outstanding', 'partial']),
          ));

        for (const row of owing) {
          await writeOffCredit(ctx.orgId, row.orderId);
        }

        res.json({
          message: "Customer removed from the credit list",
          ordersWrittenOff: owing.length,
        });
      } catch (error) {
        if ((error as { status?: number })?.status) {
          const err = error as { status: number; message?: string; code?: string };
          return res.status(err.status).json({ message: err.message, code: err.code });
        }
        console.error("Error removing credit customer:", error);
        res.status(500).json({ message: "Failed to remove customer from the credit list" });
      }
    },
  );

  /**
   * A part payment against a customer's account.
   *
   * Customers pay an account, not an invoice — "here's £150 off what I owe" —
   * so the amount is allocated across their outstanding orders oldest first.
   * That is both what a shop does by hand and what keeps the oldest debt from
   * ageing indefinitely while newer ones get cleared.
   */
  app.post("/api/tick-customers/:id/payments", ...scoped, creditRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; role?: string };
      if (!ctx?.orgId) return res.status(403).json({ message: 'Organization scope required' });

      let remaining = Math.round(Number(req.body?.amount) * 100) / 100;
      if (!Number.isFinite(remaining) || remaining <= 0) {
        return res.status(400).json({ message: "Enter how much the customer paid." });
      }
      const role = ctx.role ?? req.user?.role;
      const checked = await creditPaymentTerms(ctx.orgId, req.body, role);
      if (!checked.ok) return res.status(checked.status).json({ message: checked.message, code: checked.code });

      const { db } = await import('../db');
      const { orderCredit } = await import('@shared/schema');
      const { and, asc, eq, inArray } = await import('drizzle-orm');
      const { recordCreditPayment } = await import('../services/creditLedger');

      const owing = await db
        .select({ orderId: orderCredit.orderId, outstanding: orderCredit.amountOutstanding })
        .from(orderCredit)
        .where(and(
          eq(orderCredit.orgId, ctx.orgId),
          eq(orderCredit.customerId, req.params.id),
          inArray(orderCredit.status, ['outstanding', 'partial']),
        ))
        .orderBy(asc(orderCredit.givenOn));

      const owed = owing.reduce((sum, r) => sum + parseFloat(String(r.outstanding)), 0);
      if (remaining > Math.round(owed * 100) / 100) {
        return res.status(400).json({
          message: `That is more than this customer owes. £${owed.toFixed(2)} is outstanding.`,
          code: "CREDIT_OVERPAYMENT",
        });
      }

      const applied: Array<{ orderId: string; amount: number }> = [];
      for (const row of owing) {
        if (remaining <= 0) break;
        const outstanding = parseFloat(String(row.outstanding));
        const amount = Math.round(Math.min(outstanding, remaining) * 100) / 100;
        if (amount <= 0) continue;
        await recordCreditPayment({
          orgId: ctx.orgId,
          orderId: row.orderId,
          amount,
          method: checked.terms.method,
          paidOn: checked.terms.paidOn,
          recordedByUserId: req.user?.id ?? null,
          note: req.body?.note ?? null,
        });
        applied.push({ orderId: row.orderId, amount });
        remaining = Math.round((remaining - amount) * 100) / 100;
      }

      const customer = await storage.getCustomer(req.params.id, ctx.orgId);
      await signalCreditPayment({
        orgId: ctx.orgId,
        recorderUserId: req.user?.id,
        recorderRole: role,
        method: checked.terms.method,
        amount: roundMoney(applied.reduce((sum, a) => sum + a.amount, 0)),
        customerName: customer?.name ?? null,
        orderIds: applied.map((a) => a.orderId),
        paidOn: checked.terms.paidOn ?? null,
      }).catch((e) => console.error("[Credit] payment Signal failed", e));

      res.status(201).json({
        applied,
        amountApplied: applied.reduce((sum, a) => sum + a.amount, 0),
        remainingOwed: Math.round((owed - applied.reduce((sum, a) => sum + a.amount, 0)) * 100) / 100,
      });
    } catch (error: any) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      console.error("Error recording credit payment:", error);
      res.status(500).json({ message: "Failed to record the payment" });
    }
  });

  // Clearing a customer's whole account, kept because the button exists and
  // people use it. It no longer works by flipping every order to "completed" —
  // that used order status to mean "the money arrived", which is what made
  // every credit sale read as paid the moment the goods left. It now posts a
  // real payment against each outstanding order, which is what releases the
  // commission those sales earned.
  app.post("/api/tick-customers/:id/mark-paid", ...scoped, creditRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string; locationId: string | null; role: string };
      if (!ctx?.orgId) return res.status(403).json({ message: 'Organization scope required' });
      const customer = await storage.getCustomer(req.params.id, ctx.orgId);
      if (!customer) return res.status(404).json({ message: 'Customer not found' });
      const role = ctx.role ?? req.user?.role;
      const checked = await creditPaymentTerms(ctx.orgId, req.body, role);
      if (!checked.ok) return res.status(checked.status).json({ message: checked.message, code: checked.code });

      const { db } = await import('../db');
      const { orderCredit } = await import('@shared/schema');
      const { and, eq, inArray } = await import('drizzle-orm');
      const { recordCreditPayment } = await import('../services/creditLedger');

      const owing = await db
        .select({ orderId: orderCredit.orderId, outstanding: orderCredit.amountOutstanding })
        .from(orderCredit)
        .where(and(
          eq(orderCredit.orgId, ctx.orgId),
          eq(orderCredit.customerId, req.params.id),
          inArray(orderCredit.status, ['outstanding', 'partial']),
        ));

      // Clearing the whole tab needs the exact balance the person was shown.
      const owed = owing.reduce((sum, r) => sum + parseFloat(String(r.outstanding)), 0);
      const exact = checkClearWholeTab(req.body?.expectedBalance, owed);
      if (!exact.ok) return res.status(exact.status).json({ message: exact.message, code: exact.code });

      let settled = 0;
      for (const row of owing) {
        const amount = parseFloat(String(row.outstanding));
        if (!(amount > 0)) continue;
        await recordCreditPayment({
          orgId: ctx.orgId,
          orderId: row.orderId,
          amount,
          method: checked.terms.method,
          paidOn: checked.terms.paidOn,
          recordedByUserId: req.user?.id ?? null,
          note: 'Account cleared in full',
        });
        settled += amount;
      }

      await signalCreditPayment({
        orgId: ctx.orgId,
        recorderUserId: req.user?.id,
        recorderRole: role,
        method: checked.terms.method,
        amount: roundMoney(settled),
        customerName: customer.name,
        orderIds: owing.map((r) => r.orderId),
        paidOn: checked.terms.paidOn ?? null,
      }).catch((e) => console.error("[Credit] payment Signal failed", e));

      res.json({
        message: "Customer debt marked as paid",
        ordersSettled: owing.length,
        amountSettled: Math.round(settled * 100) / 100,
      });
    } catch (error: any) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      console.error("Error marking customer as paid:", error);
      res.status(500).json({ message: "Failed to mark customer as paid" });
    }
  });

}
