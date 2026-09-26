/**
 * Needs attention: till sales the server refused (v1.2 Phase 1A).
 *
 * The till reports a refused sale here instead of retrying it for ever or
 * losing it on sign-out; a manager then retries it, edits it in the till,
 * exports it, or discards it (logged). See `saleIssues` in shared/schema.ts.
 */
import type { RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { requireRole } from "../auth";
import { rolesAtLeast } from "@shared/accessPolicy";
import type { SaleIssue } from "@shared/schema";

declare module "express-serve-static-core" {
  interface Request {
    /** Set when a manager is resending a Needs attention sale (`saleIssueId`). */
    saleIssue?: SaleIssue;
    /** The till's sale reference for this request, validated. */
    clientOrderId?: string | null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requireManager = requireRole(...rolesAtLeast("MANAGER"));

type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/** Closes a Needs attention sale once the order it stood for exists. */
export async function markSaleIssueResolved(
  executor: Executor,
  params: { orgId: string; issueId: string; orderId: string; userId: string | null },
): Promise<void> {
  await executor.execute(sql`
    UPDATE sale_issues
    SET status = 'resolved',
        resolved_order_id = ${params.orderId},
        resolved_by_user_id = ${params.userId},
        resolved_at = now(),
        updated_at = now()
    WHERE id = ${params.issueId} AND org_id = ${params.orgId} AND status = 'open'
  `);
}

/**
 * `POST /api/orders` with `saleIssueId`: a manager sending a Needs attention
 * sale again, as it was (Retry) or after changing it in the till (Edit).
 *
 * The sale is still the person's who rang it, so it is recorded that way:
 *   - inputter: whoever rang it (the route reads `req.saleIssue`);
 *   - location: where it was rung, so stock comes off the right shelf;
 *   - received time: when it was rung, if that is still today (the same bound
 *     every offline replay has — an older sale needs the backdating flow);
 *   - drawer: theirs if it is still open. If it has been counted, the sale
 *     joins no drawer, as a backdated sale does — putting the money in the
 *     manager's drawer would make the manager's count come up long.
 *
 * `requireOpenShift` and `requireActiveCashierShift` are skipped for these
 * (`unlessSaleIssue`): both resolve the MANAGER's own shift, which is exactly
 * the attribution this avoids — and the first would open one as a side effect.
 */
export const attachSaleIssueResubmission: RequestHandler = (req, res, next) => {
  const issueId = (req.body as { saleIssueId?: unknown } | undefined)?.saleIssueId;
  if (issueId === undefined || issueId === null || issueId === "") return next();
  return requireManager(req, res, async () => {
    try {
      const ctx = (req as { orgContext?: { orgId: string | null } }).orgContext;
      if (!ctx?.orgId) return res.status(400).json({ message: "Order creation requires org context." });
      if (typeof issueId !== "string" || !UUID_RE.test(issueId)) {
        return res.status(400).json({ message: "That Needs attention sale was not found.", code: "SALE_ISSUE_NOT_FOUND" });
      }
      const { db } = await import("../db");
      const { saleIssues } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");
      const [issue] = await db
        .select()
        .from(saleIssues)
        .where(and(eq(saleIssues.id, issueId), eq(saleIssues.orgId, ctx.orgId)))
        .limit(1);
      if (!issue) {
        return res.status(404).json({ message: "That Needs attention sale was not found.", code: "SALE_ISSUE_NOT_FOUND" });
      }
      // The reference is what stops a retry landing twice, so a resend must
      // carry the one the sale was made with — never a fresh one.
      if ((req.body as { clientOrderId?: unknown }).clientOrderId !== issue.clientOrderId) {
        return res.status(400).json({
          message: "This resend does not carry the sale's own reference.",
          code: "SALE_ISSUE_REFERENCE_MISMATCH",
        });
      }
      if (issue.status === "resolved") {
        // A second press of Retry, or the first one's answer lost: the sale
        // is recorded, so the repeat check after this answers with it.
        return next();
      }
      if (issue.status !== "open") {
        return res.status(409).json({ message: "This sale was discarded.", code: "SALE_ISSUE_CLOSED" });
      }
      req.saleIssue = issue;

      if (issue.queuedAt) {
        const { orgTimeZone } = await import("./tradingDayShift");
        const { resolveOfflineQueuedAt } = await import("../middleware/requireActiveCashierShift");
        req.offlineQueuedAt = resolveOfflineQueuedAt(new Date(issue.queuedAt).toISOString(), await orgTimeZone(ctx.orgId));
      }

      const { findOpenShiftForUser } = await import("../middleware/requireOpenShift");
      const drawer = await findOpenShiftForUser(ctx.orgId, issue.rungByUserId);
      (req as { shift?: unknown }).shift =
        drawer && (!issue.locationId || drawer.locationId === issue.locationId) ? drawer : undefined;
      return next();
    } catch (error) {
      console.error("[saleIssues] Could not load the sale being resent:", error);
      return res.status(500).json({ message: "Failed to create order" });
    }
  });
};

/** Runs `middleware` except for a manager resending a Needs attention sale. */
export function unlessSaleIssue(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => (req.saleIssue ? next() : middleware(req, res, next));
}
