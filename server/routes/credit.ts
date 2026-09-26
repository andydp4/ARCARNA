import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import { CREDIT_MIN_ROLE } from "@shared/creditPolicy";
import {
  CreditError,
  outstandingCredit,
  recordCreditPayment,
  voidCredit,
  writeOffCredit,
} from "../services/creditLedger";
import { creditPaymentTerms, drawerForCreditPayment, signalCreditPayment } from "../services/creditPaymentRules";

/**
 * Credit (tick) — what is owed, and what has been paid against it.
 *
 * Settling is per order and per amount, rather than the old "clear this
 * customer's whole debt" button. A trade customer on account rarely pays an
 * invoice in one hit, and commission is released in proportion to what has
 * actually arrived, so the amount and the date both have to be real.
 */
export function registerCreditRoutes(app: Express, scoped: RequestHandler[]): void {
  // The Credit List is manager and above (owner decision Q11): a cashier
  // cannot read who owes what or record money against it.
  const creditRoles = requireRole(...rolesAtLeast(CREDIT_MIN_ROLE));
  function fail(res: any, error: unknown, fallback: string) {
    if (error instanceof CreditError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    console.error(`[Credit] ${fallback}`, error);
    return res.status(500).json({ message: fallback });
  }

  app.get("/api/credit/outstanding", ...scoped, creditRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null };
      if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });
      res.json(await outstandingCredit(ctx.orgId));
    } catch (error) {
      fail(res, error, "Failed to load outstanding credit");
    }
  });

  app.post("/api/credit/:orderId/payments", ...scoped, creditRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null; role?: string };
      if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });

      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount)) {
        return res.status(400).json({ message: "A payment amount is required" });
      }
      const role = ctx.role ?? req.user?.role;
      const checked = await creditPaymentTerms(ctx.orgId, req.body, role);
      if (!checked.ok) return res.status(checked.status).json({ message: checked.message, code: checked.code });

      const drawerShiftId = await drawerForCreditPayment(ctx.orgId, req.user?.id, checked.terms);
      const credit = await recordCreditPayment({
        orgId: ctx.orgId,
        orderId: req.params.orderId,
        amount,
        method: checked.terms.method,
        paidOn: checked.terms.paidOn,
        recordedByUserId: req.user?.id ?? null,
        note: req.body?.note ?? null,
        shiftId: drawerShiftId,
      });
      await signalCreditPayment({
        orgId: ctx.orgId,
        recorderUserId: req.user?.id,
        recorderRole: role,
        method: checked.terms.method,
        amount: Math.round(amount * 100) / 100,
        orderIds: [req.params.orderId],
        paidOn: checked.terms.paidOn ?? null,
      }).catch((e) => console.error("[Credit] payment Signal failed", e));
      res.status(201).json({ ...credit, drawerShiftId });
    } catch (error) {
      fail(res, error, "Failed to record the payment");
    }
  });

  // Writing a debt off is a loss the business takes, so it sits with the people
  // who answer for the numbers rather than with whoever is on the till.
  app.post(
    "/api/credit/:orderId/write-off",
    ...scoped,
    creditRoles,
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string | null };
        if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });
        res.json(await writeOffCredit(ctx.orgId, req.params.orderId));
      } catch (error) {
        fail(res, error, "Failed to write off the credit");
      }
    },
  );

  app.post(
    "/api/credit/:orderId/void",
    ...scoped,
    creditRoles,
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string | null };
        if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });
        res.json(await voidCredit(ctx.orgId, req.params.orderId));
      } catch (error) {
        fail(res, error, "Failed to void the credit");
      }
    },
  );
}
