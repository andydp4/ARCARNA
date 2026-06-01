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
  REFUND_REASONS,
  REFUND_METHODS,
} from "../../shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireRole } from "../auth";
import { recordAdminAudit } from "../adminAudit";
import { requireOpenShift } from "../middleware/requireOpenShift";
import { publishEventTx } from "../eventBus";
import { proportionalPointsToReverse } from "@shared/refunds/points";

const refundLineSchema = z.object({
  orderLineId: z.string().uuid(),
  qty: z.coerce.number().int().positive(),
});

const createRefundSchema = z.object({
  reason: z.enum(REFUND_REASONS),
  notes: z.string().max(2000).optional(),
  refundMethod: z.enum(REFUND_METHODS),
  lines: z.array(refundLineSchema).min(1),
});

async function sumRefundedQtyByLine(orderId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      orderLineId: refundLines.orderLineId,
      qty: refundLines.qty,
    })
    .from(refundLines)
    .innerJoin(refunds, eq(refundLines.refundId, refunds.id))
    .where(eq(refunds.orderId, orderId));

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.orderLineId, (map.get(row.orderLineId) ?? 0) + row.qty);
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

function resolveRefundMethod(
  requested: (typeof REFUND_METHODS)[number],
  originalPayment: string,
): (typeof REFUND_METHODS)[number] {
  if (requested !== "original") return requested;
  const pm = originalPayment.toLowerCase();
  if (pm === "cash" || pm.includes("cash")) return "original";
  return "cash";
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
    requireOpenShift,
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

        let refundTotal = 0;
        const resolvedLines: Array<{
          orderLineId: string;
          qty: number;
          amount: number;
          productId: string;
          sku?: string;
        }> = [];

        for (const input of body.lines) {
          const line = lineMap.get(input.orderLineId);
          if (!line) {
            return res.status(400).json({ message: "Invalid order line" });
          }
          const already = refundedByLine.get(line.id) ?? 0;
          const remaining = line.quantity - already;
          if (input.qty > remaining) {
            return res.status(400).json({
              message: `Cannot refund more than remaining qty for line ${line.id}`,
              remaining,
            });
          }
          const unit = parseFloat(String(line.unitPrice));
          const amount = Math.round(unit * input.qty * 100) / 100;
          refundTotal += amount;
          resolvedLines.push({
            orderLineId: line.id,
            qty: input.qty,
            amount,
            productId: line.productId ?? "",
            sku: line.sku ?? undefined,
          });
        }

        refundTotal = Math.round(refundTotal * 100) / 100;
        if (refundTotal <= 0) {
          return res.status(400).json({ message: "Refund total must be positive" });
        }

        const orderTotal = parseFloat(String(order.total));
        const priorRefunds = await db
          .select({ total: refunds.total })
          .from(refunds)
          .where(eq(refunds.orderId, order.id));
        const priorTotal = priorRefunds.reduce(
          (s, r) => s + parseFloat(String(r.total)),
          0,
        );
        if (priorTotal + refundTotal > orderTotal + 0.01) {
          return res.status(400).json({
            message: "Refund total exceeds order total",
          });
        }

        const refundMethod = resolveRefundMethod(
          body.refundMethod,
          order.paymentMethod,
        );
        const shiftId = req.shift?.id ?? null;
        const earnedPoints = await pointsEarnedOnOrder(order.id);
        const pointsToReverse = proportionalPointsToReverse(
          refundTotal,
          orderTotal,
          earnedPoints,
        );

        const result = await db.transaction(async (tx) => {
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

          const eventId = await publishEventTx(
            tx as unknown as typeof db,
            "RefundIssued",
            refund.id,
            {
            refundId: refund.id,
            orderId: order.id,
            customerId: order.customerId,
            total: refundTotal,
            orderTotal,
            pointsToReverse,
            method: refundMethod,
            lines: resolvedLines.map((l) => ({
              lineId: l.orderLineId,
              qty: l.qty,
              productId: l.productId,
              sku: l.sku,
            })),
          }, {
            actor: { type: "user", id: userId },
            source: "api-refunds",
          });

          return { refund, eventId };
        });

        await recordAdminAudit(req, {
          actorUserId: userId,
          actorRole: req.orgContext?.role ?? "CASHIER",
          action: "refund.issued",
          targetType: "order",
          targetId: order.id,
          orgId: ctx.orgId,
          metadata: {
            refundId: result.refund.id,
            total: refundTotal,
            reason: body.reason,
            method: refundMethod,
          },
        });

        res.status(201).json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        console.error("[Refunds] create:", error);
        res.status(500).json({ message: "Failed to issue refund" });
      }
    },
  );
}
