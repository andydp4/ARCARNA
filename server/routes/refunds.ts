import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  orders,
  orderItems,
  products,
  refunds,
  refundLines,
  loyaltyLedger,
  orderPayments,
  orderCredit,
  creditPayments,
  REFUND_REASONS,
  REFUND_METHODS,
} from "../../shared/schema";
import { isPaidLeg } from "@shared/payments/cardLink";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireRole } from "../auth";
import { recordAdminAudit } from "../adminAudit";
import { findOpenShiftForUser } from "../middleware/requireOpenShift";
import { touchCashierShiftActivity } from "../services/cashierShiftEngine";
import { publishEventTx } from "../eventBus";
import { proportionalPointsToReverse } from "@shared/refunds/points";
import { issueGiftCardInTx } from "../lib/giftCardService";
import { recordRefundExceptionInTx } from "../services/refundExceptions";
import { refundLineAmounts, resolveRefundTender } from "@shared/refunds/refundRules";

/** Raised when the in-transaction ceiling re-check rejects a concurrent refund. */
class RefundCeilingExceeded extends Error {}
/** Raised when the tab changed between the tender check and the write. */
class RefundTenderRefused extends Error {}

/** Raised when the in-transaction per-line check rejects a concurrent refund. */
class RefundLineExceeded extends Error {
  constructor(message: string, readonly remaining: number) {
    super(message);
  }
}

/** Raised when a refund would give back money this sale never took. */
class RefundNotPaid extends Error {}

/** Quantities are kept to three places, like `order_items.quantity` (weighed lines). */
const roundQty = (n: number) => Math.round(n * 1000) / 1000;

const refundLineSchema = z.object({
  orderLineId: z.string().uuid(),
  // A line sold by weight (0.5 kg) is refunded by weight too (E2E-05):
  // whole units only meant it could never be refunded at all.
  qty: z.coerce
    .number()
    .positive()
    .refine((n) => Number.isFinite(n) && Math.abs(roundQty(n) - n) < 1e-9, {
      message: "Quantity can have at most three decimal places",
    }),
});

const createRefundSchema = z
  .object({
    reason: z.enum(REFUND_REASONS),
    notes: z.string().max(2000).optional(),
    refundMethod: z.enum(REFUND_METHODS),
    lines: z.array(refundLineSchema).min(1),
  })
  // "Other" is a reason only with a word on what it was (v1.2 Phase 4, CMP-04).
  .refine((b) => b.reason !== "other" || !!b.notes?.trim(), {
    message: "Say what the reason is when you choose Other.",
    path: ["notes"],
  });

type DbReader = Pick<typeof db, "select">;

async function sumRefundedQtyByLine(orderId: string, client: DbReader = db): Promise<Map<string, number>> {
  const rows = await client
    .select({
      orderLineId: refundLines.orderLineId,
      qty: refundLines.qty,
    })
    .from(refundLines)
    .innerJoin(refunds, eq(refundLines.refundId, refunds.id))
    .where(eq(refunds.orderId, orderId));

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.orderLineId, roundQty((map.get(row.orderLineId) ?? 0) + Number(row.qty)));
  }
  return map;
}

async function pointsEarnedOnOrder(orderId: string): Promise<number> {
  const rows = await db
    .select({ pointsDelta: loyaltyLedger.pointsDelta })
    .from(loyaltyLedger)
    .where(
      and(eq(loyaltyLedger.orderId, orderId), eq(loyaltyLedger.reason, "earn")),
    );
  return rows.reduce((sum, r) => sum + Math.max(0, r.pointsDelta ?? 0), 0);
}

/**
 * What this sale has actually taken so far (E2E-02, E2E-03): paid tender legs
 * (a Card (link) leg the customer has not paid is 'awaiting', and a tick leg
 * is a debt, not money), plus any repayments made against its tab since.
 * `null` for a sale recorded before tender legs existed, which falls back to
 * the settled total as before.
 */
async function moneyTakenOnOrder(orderId: string, client: DbReader): Promise<number | null> {
  const legs = await client
    .select({ method: orderPayments.method, amount: orderPayments.amount, status: orderPayments.status })
    .from(orderPayments)
    .where(eq(orderPayments.orderId, orderId));
  if (legs.length === 0) return null;
  const paidLegs = legs
    .filter((l) => isPaidLeg(l))
    .filter((l) => {
      const m = String(l.method ?? "").toLowerCase();
      return m !== "tick" && m !== "personal_use";
    })
    .reduce((sum, l) => sum + parseFloat(String(l.amount)), 0);
  const repaid = await client
    .select({ amount: creditPayments.amount })
    .from(creditPayments)
    .where(eq(creditPayments.orderId, orderId));
  const repaidTotal = repaid.reduce((sum, r) => sum + parseFloat(String(r.amount)), 0);
  return Math.round((paidLegs + repaidTotal) * 100) / 100;
}

function notPaidMessage(taken: number, prior: number): string {
  const left = Math.max(0, Math.round((taken - prior) * 100) / 100);
  if (taken <= 0) {
    return "Nothing has been paid for this sale yet, so there is nothing to refund. Cancel the sale, or take it off the customer's credit, instead.";
  }
  return `Only £${left.toFixed(2)} of this sale has been paid and not yet refunded, so a refund cannot be more than that.`;
}

/**
 * What earlier refunds on this sale actually handed back (cash, card or store
 * credit), leaving out the part that only came off the customer's tab.
 */
async function paidOutByRefunds(orderId: string, client: DbReader): Promise<number> {
  const rows = await client
    .select({ total: refunds.total, creditAmount: refunds.creditAmount })
    .from(refunds)
    .where(eq(refunds.orderId, orderId));
  const sum = rows.reduce(
    (acc, r) => acc + parseFloat(String(r.total)) - parseFloat(String(r.creditAmount ?? 0)),
    0,
  );
  return Math.round(sum * 100) / 100;
}

export function registerRefundRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/orders/:id/refunds", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, req.params.id), eq(orders.orgId, ctx.orgId)))
        .limit(1);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const rows = await db
        .select()
        .from(refunds)
        .where(eq(refunds.orderId, order.id))
        .orderBy(refunds.createdAt);

      const withLines = await Promise.all(
        rows.map(async (refund) => {
          const lines = await db
            .select()
            .from(refundLines)
            .where(eq(refundLines.refundId, refund.id));
          return { ...refund, lines };
        }),
      );

      const refundedTotal = withLines.reduce(
        (sum, r) => sum + parseFloat(String(r.total)),
        0,
      );

      res.json({ refunds: withLines, refundedTotal });
    } catch (error) {
      console.error("[Refunds] list:", error);
      res.status(500).json({ message: "Failed to list refunds" });
    }
  });

  app.post(
    "/api/orders/:id/refunds",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
    // ARC-015: deliberately NOT requireOpenShift. That middleware auto-opens
    // (and floats) a till drawer when the caller has none, which is right for
    // taking a sale but wrong here — a manager refunding an order from the
    // back office has no till at all, and the refund must not manufacture a
    // phantom one that then shows them "on now" on Shifts and trips the
    // uncounted-drawer Control Centre signal for a drawer nobody opened.
    // Attach softly instead, directly below: this user's already-open shift
    // when one exists, `shiftId: null` when it doesn't.
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const userId = req.user?.id ?? "unknown";
        const body = createRefundSchema.parse(req.body ?? {});

        const [order] = await db
          .select()
          .from(orders)
          .where(and(eq(orders.id, req.params.id), eq(orders.orgId, ctx.orgId)))
          .limit(1);
        if (!order) return res.status(404).json({ message: "Order not found" });
        // Only a settled sale can be refunded: an order that was never
        // completed was never counted in, so a refund would pay money out
        // and take it off takings for a sale that did not happen (v1.2.1
        // money, M3). Complete it first, or a manager deletes it when the
        // sale did not happen.
        if (order.status !== "completed") {
          return res.status(409).json({
            message:
              "This order has not been completed, so there is nothing to refund yet. Complete it first, or a manager can delete it if the sale did not happen.",
            code: "REFUND_ORDER_NOT_SETTLED",
          });
        }

        const lineIds = body.lines.map((l) => l.orderLineId);
        const orderLines = await db
          .select({
            id: orderItems.id,
            productId: orderItems.productId,
            quantity: orderItems.quantity,
            unitPrice: orderItems.unitPrice,
            totalPrice: orderItems.totalPrice,
            sku: products.productId,
          })
          .from(orderItems)
          .leftJoin(products, eq(orderItems.productId, products.id))
          .where(
            and(
              eq(orderItems.orderId, order.id),
              inArray(orderItems.id, lineIds),
            ),
          );

        if (orderLines.length !== lineIds.length) {
          return res.status(400).json({ message: "Invalid order line(s)" });
        }

        const refundedByLine = await sumRefundedQtyByLine(order.id);
        const lineMap = new Map(orderLines.map((l) => [l.id, l]));

        // Every line of the sale, to share its settled total across them.
        const allLines = await db
          .select({ id: orderItems.id, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice })
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));
        const lineValue = allLines.reduce(
          (s, l) => s + parseFloat(String(l.unitPrice)) * Number(l.quantity),
          0,
        );

        const requestedLines: Array<{
          orderLineId: string;
          qty: number;
          unitPrice: number;
          productId: string;
          sku?: string;
        }> = [];
        const requestedQty = new Map<string, number>();
        for (const input of body.lines) {
          const line = lineMap.get(input.orderLineId);
          if (!line) {
            return res.status(400).json({ message: "Invalid order line" });
          }
          const already = (refundedByLine.get(line.id) ?? 0) + (requestedQty.get(line.id) ?? 0);
          const remaining = roundQty(Number(line.quantity) - already);
          if (roundQty(input.qty) > remaining) {
            return res.status(400).json({
              message: `Cannot refund more than remaining qty for line ${line.id}`,
              remaining,
            });
          }
          requestedQty.set(line.id, (requestedQty.get(line.id) ?? 0) + input.qty);
          requestedLines.push({
            orderLineId: line.id,
            qty: input.qty,
            unitPrice: parseFloat(String(line.unitPrice)),
            productId: line.productId ?? "",
            sku: line.sku ?? undefined,
          });
        }
        const refundsEverything = allLines.every(
          (l) => (refundedByLine.get(l.id) ?? 0) + (requestedQty.get(l.id) ?? 0) >= Number(l.quantity),
        );

        // SECURITY: cap against the IMMUTABLE settlement snapshot (what was
        // actually collected when the order completed), not `orders.total`,
        // which post-payment line edits could inflate. Falls back to `total`
        // for settled orders that never recorded a settlement (pre-migration
        // rows).
        const settled = (order as any).settledTotal;
        const refundCeiling =
          settled != null && String(settled) !== ""
            ? parseFloat(String(settled))
            : parseFloat(String(order.total));
        const priorRefunds = await db
          .select({ total: refunds.total })
          .from(refunds)
          .where(eq(refunds.orderId, order.id));
        const priorTotal = priorRefunds.reduce(
          (s, r) => s + parseFloat(String(r.total)),
          0,
        );

        // What the customer paid for these items: the settled total shared
        // across the lines by value, so a discount on the sale comes off the
        // refund too.
        const priced = refundLineAmounts({
          lines: requestedLines,
          lineValue,
          settled: refundCeiling,
          priorRefunded: priorTotal,
          refundsEverything,
        });
        const resolvedLines = requestedLines.map((l, i) => ({ ...l, amount: priced.amounts[i] }));
        const refundTotal = priced.total;
        if (refundTotal <= 0) {
          return res.status(400).json({ message: "Refund total must be positive" });
        }
        if (priorTotal + refundTotal > refundCeiling + 0.01) {
          return res.status(400).json({
            message: "Refund total exceeds the amount collected for this order",
          });
        }

        // Which way the money goes back. A tab sale's refund comes off the
        // tab first; only what was actually paid is handed back.
        const tenderFor = async (client: Pick<typeof db, "select">) => {
          const legs = await client
            .select({ method: orderPayments.method, amount: orderPayments.amount, status: orderPayments.status })
            .from(orderPayments)
            .where(eq(orderPayments.orderId, order.id));
          const [tab] = await client
            .select({ amountOutstanding: orderCredit.amountOutstanding, status: orderCredit.status })
            .from(orderCredit)
            .where(and(eq(orderCredit.orderId, order.id), eq(orderCredit.orgId, ctx.orgId)))
            .limit(1);
          const tabOpen = !!tab && (tab.status === "outstanding" || tab.status === "partial");
          const tabPays = tab
            ? await client
                .select({ method: creditPayments.method })
                .from(creditPayments)
                .where(eq(creditPayments.orderId, order.id))
            : [];
          return resolveRefundTender({
            requested: body.refundMethod,
            refundTotal,
            legs: legs
              .filter((l) => l.status === "paid")
              .map((l) => ({ method: l.method, amount: parseFloat(String(l.amount)) })),
            paymentMethod: order.paymentMethod,
            tabOutstanding: tabOpen ? parseFloat(String(tab!.amountOutstanding)) : 0,
            tabPaymentMethods: tabPays.map((p) => p.method),
          });
        };
        const tender = await tenderFor(db);
        if (!tender.ok) {
          return res.status(400).json({ message: tender.message, code: "REFUND_METHOD_NEEDED" });
        }
        const refundMethod = tender.method;
        // Only money this sale actually took can be handed back (E2E-02,
        // E2E-03). What comes off the tab is not money handed back.
        {
          const taken = await moneyTakenOnOrder(order.id, db);
          const priorPaidOut = await paidOutByRefunds(order.id, db);
          if (taken !== null && priorPaidOut + tender.paidOut > taken + 0.01) {
            return res.status(400).json({ message: notPaidMessage(taken, priorPaidOut), code: "REFUND_NOT_PAID" });
          }
        }
        // Soft attach (ARC-015): this user's own already-open till shift, if
        // any — never one opened just now for this request.
        const openShift = await findOpenShiftForUser(ctx.orgId, userId);
        const shiftId = openShift?.id ?? null;
        const earnedPoints = await pointsEarnedOnOrder(order.id);
        // Reverse points proportionally against what was actually collected —
        // an inflated `orders.total` would otherwise under-reverse them.
        const pointsToReverse = proportionalPointsToReverse(
          refundTotal,
          refundCeiling,
          earnedPoints,
        );

        const result = await db.transaction(async (tx) => {
          // The ceiling check above runs outside this transaction and takes no
          // lock, so two simultaneous refunds both read zero prior refunds and
          // both pass it — a £30 order could be refunded £90. Lock the order
          // row to serialise concurrent refunds, then re-check against the
          // prior total as it stands inside this transaction. The earlier check
          // is kept only as a fast rejection for the common case.
          await tx
            .select({ id: orders.id })
            .from(orders)
            .where(eq(orders.id, order.id))
            .for("update")
            .limit(1);

          const priorInTx = await tx
            .select({ total: refunds.total })
            .from(refunds)
            .where(eq(refunds.orderId, order.id));
          const priorTotalInTx = priorInTx.reduce(
            (sum, r) => sum + parseFloat(String(r.total)),
            0,
          );
          if (priorTotalInTx + refundTotal > refundCeiling + 0.01) {
            throw new RefundCeilingExceeded(
              "Refund total exceeds the amount collected for this order",
            );
          }
          // The per-line check again, under the lock (E2E-04): two refunds of
          // the same single unit pressed together both passed the check above,
          // which reads before either had written.
          const refundedInTx = await sumRefundedQtyByLine(order.id, tx);
          for (const line of resolvedLines) {
            const sold = Number(lineMap.get(line.orderLineId)?.quantity ?? 0);
            const remainingInTx = roundQty(sold - (refundedInTx.get(line.orderLineId) ?? 0));
            if (roundQty(line.qty) > remainingInTx) {
              throw new RefundLineExceeded(
                `Cannot refund more than remaining qty for line ${line.orderLineId}`,
                remainingInTx,
              );
            }
          }

          // Re-read the tab under the order lock: a tab payment recorded in
          // between would change how much of this refund comes off it.
          const tenderNow = await tenderFor(tx as unknown as typeof db);
          if (!tenderNow.ok || tenderNow.method !== tender.method || tenderNow.creditAmount !== tender.creditAmount) {
            throw new RefundTenderRefused(
              "The customer's tab changed while this refund was being issued. Check it and try again.",
            );
          }
          // Only money actually taken can be handed back, read under the same
          // lock (a Card (link) payment or tab repayment landing now is seen).
          const takenInTx = await moneyTakenOnOrder(order.id, tx);
          const priorPaidOutInTx = await paidOutByRefunds(order.id, tx);
          if (takenInTx !== null && priorPaidOutInTx + tenderNow.paidOut > takenInTx + 0.01) {
            throw new RefundNotPaid(notPaidMessage(takenInTx, priorPaidOutInTx));
          }
          if (tender.creditAmount > 0) {
            // Off the tab: outstanding comes down by the refunded share. A tab
            // refunded to nothing is closed: settled when some of it had been
            // paid, voided when none had.
            const [tab] = await tx
              .select()
              .from(orderCredit)
              .where(eq(orderCredit.orderId, order.id))
              .for("update")
              .limit(1);
            const left = Math.round((parseFloat(String(tab.amountOutstanding)) - tender.creditAmount) * 100) / 100;
            const given = parseFloat(String(tab.amountGiven));
            const everPaid = Math.round((given - parseFloat(String(tab.amountOutstanding))) * 100) / 100 > 0;
            await tx
              .update(orderCredit)
              .set({
                amountOutstanding: String(Math.max(0, left)),
                status: left > 0 ? tab.status : everPaid ? "settled" : "voided",
                updatedAt: new Date(),
              })
              .where(eq(orderCredit.orderId, order.id));
          }

          const [refund] = await tx
            .insert(refunds)
            .values({
              orderId: order.id,
              orgId: ctx.orgId,
              cashierId: userId,
              shiftId,
              reason: body.reason,
              notes: body.notes,
              refundMethod,
              total: String(refundTotal),
              creditAmount: String(tender.creditAmount),
            })
            .returning();

          for (const line of resolvedLines) {
            await tx.insert(refundLines).values({
              refundId: refund.id,
              orderLineId: line.orderLineId,
              qty: line.qty,
              amount: String(line.amount),
            });
          }

          // Refunds follow the same rule (CMP-04): never blocked; the ones
          // the admin-set rules pick out raise an exception and a Signal.
          await recordRefundExceptionInTx(tx, {
            orgId: ctx.orgId,
            refundId: refund.id,
            orderId: order.id,
            refunderUserId: userId,
            refundMethod,
            originalPaymentMethod: order.paymentMethod ?? null,
            total: refundTotal,
            reason: body.reason,
            notes: body.notes ?? null,
            saleUserId: order.completedUserId ?? order.inputUserId ?? null,
            saleAt: order.settledAt ?? order.createdAt ?? null,
          });

          let storeCreditGiftCard: Awaited<ReturnType<typeof issueGiftCardInTx>> | null = null;
          if (refundMethod === "store_credit") {
            if (!order.customerId) throw new Error("Store credit refund requires a customer on the order");
            storeCreditGiftCard = await issueGiftCardInTx(tx, {
              orgId: ctx.orgId, amount: tender.paidOut, customerId: order.customerId,
              issuedByUserId: userId, refundId: refund.id, movementType: "refund_credit", actorUserId: userId,
            });
          }

          const eventId = await publishEventTx(tx as unknown as typeof db, "RefundIssued", refund.id, {
            refundId: refund.id, orderId: order.id, customerId: order.customerId, total: refundTotal,
            orderTotal: refundCeiling, pointsToReverse, method: refundMethod,
            storeCreditGiftCardId: storeCreditGiftCard?.card.id ?? null,
            lines: resolvedLines.map((l) => ({ lineId: l.orderLineId, qty: l.qty, productId: l.productId, sku: l.sku })),
          }, { actor: { type: "user", id: userId }, source: "api-refunds" });

          return { refund, eventId, storeCreditGiftCard };
        });

        if (order.cashierShiftId) {
          await touchCashierShiftActivity(order.cashierShiftId);
        }

        await recordAdminAudit(req, {
          actorUserId: userId, actorRole: req.orgContext?.role ?? "CASHIER", action: "refund.issued",
          targetType: "order", targetId: order.id, orgId: ctx.orgId,
          metadata: {
            refundId: result.refund.id, total: refundTotal, reason: body.reason, method: refundMethod,
            storeCreditGiftCardId: result.storeCreditGiftCard?.card.id ?? null,
          },
        });

        res.status(201).json({
          ...result,
          storeCredit: result.storeCreditGiftCard ? {
            giftCardId: result.storeCreditGiftCard.card.id,
            code: result.storeCreditGiftCard.code,
            amount: tender.paidOut,
          } : null,
        });
      } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", errors: error.errors });
        if (error instanceof RefundCeilingExceeded) return res.status(400).json({ message: error.message });
        if (error instanceof RefundTenderRefused) return res.status(409).json({ message: error.message });
        if (error instanceof RefundLineExceeded) {
          return res.status(400).json({ message: error.message, remaining: error.remaining });
        }
        if (error instanceof RefundNotPaid) return res.status(400).json({ message: error.message, code: "REFUND_NOT_PAID" });
        const message = error instanceof Error ? error.message : "Failed to issue refund";
        console.error("[Refunds] create:", error);
        res.status(/store credit|customer/i.test(message) ? 400 : 500).json({ message });
      }
    },
  );
}
