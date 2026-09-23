/**
 * Refunds follow the same rule (v1.2 Phase 4, CMP-04).
 *
 * A refund is never blocked. The ones the admin-set rules pick out — a cash
 * refund over £X, a refund on another cashier's sale, a refund N days or more
 * after the sale, a refund with reason "Other" — raise an exception in Needs a
 * look and one Signal. The Signal names the person who gave the refund, so a
 * cashier's goes to managers and above and a manager's to admins and the
 * owner only (owner decision: exceptions made by a manager).
 *
 * Runs inside the refund's transaction under a savepoint: a problem here is
 * logged and the refund goes through.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "@shared/schema";
import {
  refundExceptionRules,
  refundRuleLabel,
  reviewRulesFromOrg,
  type RefundRule,
  type ReviewRules,
} from "@shared/review/exceptions";
import { orderRefOf } from "@shared/pricing/priceGuard";
import { notify } from "./signals";
import { raiseExceptionReview, staffRoleOf } from "./exceptionReviews";
import { resolveUserNames } from "./userDisplayName";

type Executor = typeof db | any;

export async function orgReviewRules(orgId: string, client: Executor = db): Promise<ReviewRules> {
  const [org] = await client
    .select({
      priceGuardMinSignal: organizations.priceGuardMinSignal,
      refundCashOver: organizations.refundCashOver,
      refundAfterDays: organizations.refundAfterDays,
      refundSameCashierHours: organizations.refundSameCashierHours,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return reviewRulesFromOrg(org ?? {});
}

export type RefundExceptionArgs = {
  orgId: string;
  refundId: string;
  orderId: string;
  refunderUserId: string;
  /** The resolved refund method and the order's original payment method. */
  refundMethod: string;
  originalPaymentMethod: string | null;
  total: number;
  reason: string;
  notes: string | null;
  saleUserId: string | null;
  saleAt: Date | null;
};

/** Money that leaves the drawer: cash, or "original" on a cash sale. */
export function refundIsCash(refundMethod: string, originalPaymentMethod: string | null): boolean {
  if (refundMethod === "cash") return true;
  return refundMethod === "original" && /cash/i.test(originalPaymentMethod ?? "");
}

export async function recordRefundExceptionInTx(
  tx: Executor,
  args: RefundExceptionArgs,
): Promise<{ id: string | null; rules: RefundRule[] } | null> {
  try {
    await tx.execute(sql`SAVEPOINT refund_exception`);
  } catch (error) {
    console.warn("[RefundExceptions] could not start (refund unaffected):", error);
    return null;
  }
  try {
    const out = await recordInner(tx, args);
    await tx.execute(sql`RELEASE SAVEPOINT refund_exception`);
    return out;
  } catch (error) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT refund_exception`);
    console.warn("[RefundExceptions] recording failed (refund unaffected):", error);
    return null;
  }
}

async function recordInner(tx: Executor, args: RefundExceptionArgs) {
  const rules = await orgReviewRules(args.orgId, tx);
  const hit = refundExceptionRules(
    {
      isCash: refundIsCash(args.refundMethod, args.originalPaymentMethod),
      total: args.total,
      refunderUserId: args.refunderUserId,
      saleUserId: args.saleUserId,
      saleAt: args.saleAt,
      reason: args.reason,
    },
    rules,
  );
  if (hit.length === 0) return { id: null, rules: hit };

  const names = await resolveUserNames([args.refunderUserId, args.saleUserId].filter(Boolean) as string[]);
  const who = names.get(args.refunderUserId) ?? "Unknown";
  const labels = hit.map((r) => (r === "other_cashier" && args.saleUserId ? `Refund on ${names.get(args.saleUserId) ?? "another cashier"}'s sale` : refundRuleLabel(r, rules)));
  const note = args.notes?.trim() ? ` Note: ${args.notes.trim().slice(0, 200)}` : "";
  const summary = `£${args.total.toFixed(2)} refund on order ${orderRefOf(args.orderId)} by ${who}: ${labels.join("; ")}.${note}`;
  const severity: "warning" | "error" = hit.length > 1 ? "error" : "warning";

  const id = await raiseExceptionReview(tx, {
    orgId: args.orgId,
    kind: "refund",
    sourceId: args.refundId,
    orderId: args.orderId,
    subjectUserId: args.refunderUserId,
    subjectRole: await staffRoleOf(args.orgId, args.refunderUserId, tx),
    severity,
    summary,
    amount: args.total,
    rules: hit,
  });
  if (!id) return { id: null, rules: hit };
  await notify(
    {
      orgId: args.orgId,
      title: `Refund to look at — ${who}`,
      message: summary,
      severity,
      source: "refund_exception",
      subjectUserId: args.refunderUserId,
      metadata: { orderId: args.orderId, refundId: args.refundId, entityId: id },
    },
    tx,
  );
  return { id, rules: hit };
}
