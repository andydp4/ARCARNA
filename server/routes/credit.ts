import type { Express, RequestHandler } from "express";
import { requireRole } from "../auth";
import {
  CreditError,
  outstandingCredit,
  recordCreditPayment,
  voidCredit,
  writeOffCredit,
} from "../services/creditLedger";

/**
 * Credit (tick) — what is owed, and what has been paid against it.
 *
 * Settling is per order and per amount, rather than the old "clear this
 * customer's whole debt" button. A trade customer on account rarely pays an
 * invoice in one hit, and commission is released in proportion to what has
 * actually arrived, so the amount and the date both have to be real.
 */
export function registerCreditRoutes(app: Express, scoped: RequestHandler[]): void {
  function fail(res: any, error: unknown, fallback: string) {
    if (error instanceof CreditError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    console.error(`[Credit] ${fallback}`, error);
    return res.status(500).json({ message: fallback });
  }

  app.get("/api/credit/outstanding", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null };
      if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });
      res.json(await outstandingCredit(ctx.orgId));
    } catch (error) {
      fail(res, error, "Failed to load outstanding credit");
    }
  });

  app.post("/api/credit/:orderId/payments", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string | null };
      if (!ctx?.orgId) return res.status(403).json({ message: "Organization scope required" });

      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount)) {
        return res.status(400).json({ message: "A payment amount is required" });
      }
      const credit = await recordCreditPayment({
        orgId: ctx.orgId,
        orderId: req.params.orderId,
        amount,
        method: String(req.body?.method ?? "cash"),
        paidOn: req.body?.paidOn,
        recordedByUserId: req.user?.id ?? null,
        note: req.body?.note ?? null,
      });
      res.status(201).json(credit);
    } catch (error) {
      fail(res, error, "Failed to record the payment");
    }
  });

  // Writing a debt off is a loss the business takes, so it sits with the people
  // who answer for the numbers rather than with whoever is on the till.
  app.post(
    "/api/credit/:orderId/write-off",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
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
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
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
