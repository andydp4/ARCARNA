import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import { CUSTOMER_CREDIT_MIN_ROLE, checkTillCreditPayment } from "@shared/customerCredit";
import { requireOpenShift } from "../middleware/requireOpenShift";
import { getCustomerForRole } from "../services/customerView";
import { CreditError } from "../services/creditLedger";
import { customerCreditSummary, payCustomerCredit } from "../services/customerCredit";
import { signalCreditPayment } from "../services/creditPaymentRules";

/**
 * "This customer already owes" at order start, and Take a payment at the till
 * (v1.2.1 credit). Every member of staff who can start an order can read
 * this one customer's total, tab count and oldest date, and record a cash or
 * card payment against it. The Credit List itself stays manager and above
 * (Q11): nothing here lists other customers, order numbers or contact details.
 */
export function registerCustomerCreditRoutes(app: Express, scoped: RequestHandler[]): void {
  const tillRoles = requireRole(...rolesAtLeast(CUSTOMER_CREDIT_MIN_ROLE));

  function fail(res: any, error: unknown, fallback: string) {
    if (error instanceof CreditError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    console.error(`[CustomerCredit] ${fallback}`, error);
    return res.status(500).json({ message: fallback });
  }

  app.get("/api/customers/:id/credit-summary", ...scoped, tillRoles, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null };
      if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });
      // The customer must be this org's: another org's id is simply not found.
      const customer = await getCustomerForRole(ctx.orgId, req.params.id, "CASHIER");
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      res.json(await customerCreditSummary(ctx.orgId, req.params.id));
    } catch (error) {
      fail(res, error, "Could not load what this customer owes");
    }
  });

  /**
   * Take a payment. The drawer is the recorder's till shift (opened on first
   * use, as the first sale opens it), so a cash payment raises that drawer's
   * expected cash and shows on its shift summary; a card one does not, and
   * below admin it tells the managers, as a Credit List card payment does.
   */
  app.post(
    "/api/customers/:id/credit-payments",
    ...scoped,
    tillRoles,
    requireOpenShift,
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string | null; role?: string };
        if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });
        const customer = await getCustomerForRole(ctx.orgId, req.params.id, "CASHIER");
        if (!customer) return res.status(404).json({ message: "Customer not found" });

        const before = await customerCreditSummary(ctx.orgId, req.params.id);
        const checked = checkTillCreditPayment(req.body, before.owed);
        if (!checked.ok) return res.status(checked.status).json({ message: checked.message, code: checked.code });

        const shiftId: string | null = req.shift?.id ?? null;
        const result = await payCustomerCredit({
          orgId: ctx.orgId,
          customerId: req.params.id,
          amount: checked.amount,
          method: checked.method,
          recordedByUserId: req.user?.id ?? null,
          note: "Taken at the till",
          shiftId,
        });

        const role = ctx.role ?? req.user?.role;
        await signalCreditPayment({
          orgId: ctx.orgId,
          recorderUserId: req.user?.id,
          recorderRole: role,
          method: checked.method,
          amount: result.amountApplied,
          customerName: customer.name ?? null,
          orderIds: result.applied.map((a) => a.orderId),
          paidOn: null,
        }).catch((e) => console.error("[CustomerCredit] payment Signal failed", e));

        const after = await customerCreditSummary(ctx.orgId, req.params.id);
        res.status(201).json({
          amountPaid: result.amountApplied,
          method: checked.method,
          tabsPaid: result.applied.length,
          drawerShiftId: shiftId,
          summary: after,
        });
      } catch (error) {
        fail(res, error, "Could not record the payment");
      }
    },
  );
}
