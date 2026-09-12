/**
 * Capture endpoints that feed the ARC-RPT-SPEC-001 reports.
 *
 * These write the data the report views read back:
 *   - satisfaction_scores        → ARC-T2-003 Customer Satisfaction
 *   - reseller_partners / _transactions → ARC-T2-004 Reseller Credit & Payment
 *   - orders delay fields        → ARC-T1-005 Delay Log
 *
 * `PATCH /api/orders/:id/operations` no longer owns the promise itself
 * (`etaGiven` / `originalEta`) or a queue position — those moved to the
 * Operations Centre's due-time transition and migration 065 respectively
 * (Phase N, N3b; docs/briefs/PHASE_N_OPERATIONS_CENTRE.md). This route is
 * narrowed to `delay_*` and `revised_eta`.
 */
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  satisfactionScores,
  resellerPartners,
  resellerTransactions,
  orders,
  customers,
} from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireRole } from "../auth";
import { DELAY_CAUSES } from "@shared/delayCauses";

const satisfactionSchema = z.object({
  orderId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

const partnerSchema = z.object({
  name: z.string().min(1).max(255),
  partnerCode: z.string().min(1).max(20),
});

const txnSchema = z.object({
  partnerId: z.string().uuid(),
  type: z.enum(["SUPPLY", "PAYMENT"]),
  amount: z.number().positive().finite(),
  invoiceDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});

// Shared with the client so the dropdown and this Zod enum cannot drift.
// See shared/delayCauses.ts.

/**
 * `PATCH /api/orders/:id/operations` owns `delay_*` and `revised_eta` ONLY
 * (Phase N, N3b). `queuePosition` was dropped with the column in migration
 * 065; `etaGiven` and `originalEta` moved to the due-time transition
 * (`POST /api/orders/:id/transition {action:'set_due'}`,
 * `server/services/orderTransitions.ts`) — the promise is now owned by one
 * path, not two, and this route can no longer set it from NULL for the first
 * time (only `set_due` and order creation ever do that).
 */
const orderOpsSchema = z
  .object({
    delayFlag: z.boolean().optional(),
    delayReason: z.string().max(255).nullable().optional(),
    delayCause: z.enum(DELAY_CAUSES).nullable().optional(),
    revisedEta: z.string().datetime().nullable().optional(),
    delayResolution: z
      .enum(["Collected late", "Rescheduled", "Cancelled", "Escalated to owner"])
      .nullable()
      .optional(),
    /** Set true when the customer has just been told about the delay. */
    notifyCustomerNow: z.boolean().optional(),
  })
  // Clearing a delay without saying how it was resolved would leave the Delay
  // Log with a row nobody can explain — the same "read, not just recorded"
  // principle personal-use reasons and hold reasons already follow.
  .refine((body) => body.delayFlag !== false || body.delayResolution != null, {
    message: "Clearing a delay needs a resolution.",
    path: ["delayResolution"],
  });

export function registerReportCaptureRoutes(app: Express, scoped: RequestHandler[]): void {
  // ── Satisfaction ─────────────────────────────────────────────────────────
  app.post("/api/satisfaction", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const body = satisfactionSchema.parse(req.body ?? {});

      // If an order is supplied, confirm it belongs to this org and infer the
      // customer from it when one wasn't given.
      let customerId = body.customerId ?? null;
      if (body.orderId) {
        const [order] = await db
          .select({ id: orders.id, customerId: orders.customerId })
          .from(orders)
          .where(and(eq(orders.id, body.orderId), eq(orders.orgId, ctx.orgId)))
          .limit(1);
        if (!order) return res.status(404).json({ message: "Order not found" });
        customerId = customerId ?? order.customerId;
      }

      const [row] = await db
        .insert(satisfactionScores)
        .values({
          orgId: ctx.orgId,
          orderId: body.orderId ?? null,
          customerId,
          staffId: body.staffId ?? null,
          score: body.score,
          comment: body.comment ?? null,
        })
        .returning();

      // A 1 or 2 needs the owner's attention today (spec flag logic).
      if (body.score <= 2) {
        try {
          const { notifyReportRedFlags } = await import("../services/reportNotifications");
          await notifyReportRedFlags(ctx.orgId, {
            ref: "ARC-T2-003",
            title: "Customer Satisfaction Report",
            generatedAt: new Date().toISOString(),
            period: { from: null, to: null },
            summary: {},
            rows: [],
            redFlags: [`A customer rated their collection ${body.score}/5 — personal follow-up today.`],
          });
        } catch (e) {
          console.error("satisfaction red-flag notification failed:", e);
        }
      }
      res.status(201).json(row);
    } catch (error: any) {
      if (error?.name === "ZodError") return res.status(400).json({ message: "Invalid input", errors: error.errors });
      console.error("Error recording satisfaction score:", error);
      res.status(500).json({ message: "Failed to record satisfaction score" });
    }
  });

  /** Recent scores, for the capture screen's "already recorded" list. */
  app.get("/api/satisfaction", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const rows = await db
        .select({
          id: satisfactionScores.id,
          score: satisfactionScores.score,
          comment: satisfactionScores.comment,
          scoreDate: satisfactionScores.scoreDate,
          customer: customers.name,
        })
        .from(satisfactionScores)
        .leftJoin(customers, eq(satisfactionScores.customerId, customers.id))
        .where(eq(satisfactionScores.orgId, ctx.orgId))
        .orderBy(desc(satisfactionScores.scoreDate))
        .limit(50);
      res.json(rows);
    } catch (error) {
      console.error("Error listing satisfaction scores:", error);
      res.status(500).json({ message: "Failed to load satisfaction scores" });
    }
  });

  // ── Reseller partners + ledger ───────────────────────────────────────────
  app.get("/api/reseller-partners", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const rows = await db
        .select()
        .from(resellerPartners)
        .where(eq(resellerPartners.orgId, ctx.orgId))
        .orderBy(resellerPartners.partnerCode);
      res.json(rows);
    } catch (error) {
      console.error("Error listing reseller partners:", error);
      res.status(500).json({ message: "Failed to load reseller partners" });
    }
  });

  app.post(
    "/api/reseller-partners",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const body = partnerSchema.parse(req.body ?? {});
        const [existing] = await db
          .select({ id: resellerPartners.id })
          .from(resellerPartners)
          .where(and(eq(resellerPartners.orgId, ctx.orgId), eq(resellerPartners.partnerCode, body.partnerCode)))
          .limit(1);
        if (existing) return res.status(409).json({ message: "A partner with that code already exists" });

        const [row] = await db
          .insert(resellerPartners)
          .values({ orgId: ctx.orgId, name: body.name, partnerCode: body.partnerCode })
          .returning();
        res.status(201).json(row);
      } catch (error: any) {
        if (error?.name === "ZodError") return res.status(400).json({ message: "Invalid input", errors: error.errors });
        console.error("Error creating reseller partner:", error);
        res.status(500).json({ message: "Failed to create reseller partner" });
      }
    },
  );

  app.post(
    "/api/reseller-transactions",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const body = txnSchema.parse(req.body ?? {});

        const [partner] = await db
          .select({ id: resellerPartners.id })
          .from(resellerPartners)
          .where(and(eq(resellerPartners.id, body.partnerId), eq(resellerPartners.orgId, ctx.orgId)))
          .limit(1);
        if (!partner) return res.status(404).json({ message: "Partner not found" });

        const [row] = await db
          .insert(resellerTransactions)
          .values({
            orgId: ctx.orgId,
            partnerId: body.partnerId,
            type: body.type,
            amount: String(body.amount),
            invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : body.type === "SUPPLY" ? new Date() : null,
            notes: body.notes ?? null,
          })
          .returning();

        // A payment settles the oldest unpaid supplies first, so the ageing in
        // ARC-T2-004 reflects what has actually been cleared.
        if (body.type === "PAYMENT") {
          let remaining = body.amount;
          const unpaid = await db
            .select({ id: resellerTransactions.id, amount: resellerTransactions.amount })
            .from(resellerTransactions)
            .where(
              and(
                eq(resellerTransactions.orgId, ctx.orgId),
                eq(resellerTransactions.partnerId, body.partnerId),
                eq(resellerTransactions.type, "SUPPLY"),
                eq(resellerTransactions.paid, false),
              ),
            )
            .orderBy(resellerTransactions.occurredAt);
          for (const s of unpaid) {
            const amt = parseFloat(String(s.amount));
            if (remaining + 1e-9 < amt) break;
            remaining -= amt;
            await db
              .update(resellerTransactions)
              .set({ paid: true })
              .where(eq(resellerTransactions.id, s.id));
          }
        }

        res.status(201).json(row);
      } catch (error: any) {
        if (error?.name === "ZodError") return res.status(400).json({ message: "Invalid input", errors: error.errors });
        console.error("Error recording reseller transaction:", error);
        res.status(500).json({ message: "Failed to record transaction" });
      }
    },
  );

  // ── Order operational fields (delay) ────────────────────────────────────
  /**
   * Kept, fixed in N3b: transactional and `FOR UPDATE` (previously a bare,
   * unlocked read-then-write outside any transaction), and narrowed to the
   * fields this route actually owns. Writes `delayed` when `delayFlag` moves
   * to true and `delay_cleared` (with the caller's resolution) when it moves
   * back to false.
   */
  app.patch(
    "/api/orders/:id/operations",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const body = orderOpsSchema.parse(req.body ?? {});
        const { withTransaction } = await import("../../apps/server/src/db");
        const { orders: opsOrders } = await import("../../apps/server/src/db/schema");
        const { orderEvents } = await import("@shared/schema");

        const outcome = await withTransaction(async (tx: any) => {
          const [order] = await tx
            .select()
            .from(opsOrders)
            .where(and(eq(opsOrders.id, req.params.id), eq(opsOrders.org_id, ctx.orgId)))
            .for("update")
            .limit(1);
          if (!order) return { notFound: true as const };

          const now = new Date();
          const patch: Record<string, unknown> = { updated_at: now };
          if (body.delayFlag !== undefined) patch.delay_flag = body.delayFlag;
          if (body.delayReason !== undefined) patch.delay_reason = body.delayReason;
          if (body.delayCause !== undefined) patch.delay_cause = body.delayCause;
          if (body.revisedEta !== undefined) patch.revised_eta = body.revisedEta ? new Date(body.revisedEta) : null;
          if (body.delayResolution !== undefined) patch.delay_resolution = body.delayResolution;
          // Stamp comms at the moment they're sent; Delay Log compares this to
          // originalEta to decide whether the warning was proactive.
          if (body.notifyCustomerNow) patch.delay_notification_sent_at = now;

          const [updated] = await tx
            .update(opsOrders)
            .set(patch)
            .where(eq(opsOrders.id, req.params.id))
            .returning();

          const wasDelayed = order.delay_flag === true;
          const nowDelayed = body.delayFlag ?? wasDelayed;
          if (body.delayFlag !== undefined && nowDelayed !== wasDelayed) {
            await tx.insert(orderEvents).values({
              orgId: ctx.orgId,
              orderId: req.params.id,
              kind: nowDelayed ? "delayed" : "delay_cleared",
              userId: req.user?.id ?? null,
              at: now,
              meta: nowDelayed
                ? {
                    cause: body.delayCause ?? null,
                    reason: body.delayReason ?? null,
                    revisedEta: updated.revised_eta ?? null,
                    customerTold: Boolean(body.notifyCustomerNow),
                  }
                : { resolution: body.delayResolution ?? null },
            });
          }

          return { notFound: false as const, updated };
        });

        if (outcome.notFound) return res.status(404).json({ message: "Order not found" });

        if (ctx.orgId) {
          try {
            const { getOpsBoardOrder } = await import("../services/opsBoard");
            const { publishOpsEvent } = await import("../services/opsBus");
            const boardOrder = await getOpsBoardOrder(ctx.orgId, req.params.id);
            if (boardOrder) publishOpsEvent(ctx.orgId, { type: "order", order: boardOrder });
          } catch (pushError) {
            console.error("[Orders] Failed to push the delay edit to the board stream:", pushError);
          }
        }

        res.json(outcome.updated);
      } catch (error: any) {
        if (error?.name === "ZodError") return res.status(400).json({ message: "Invalid input", errors: error.errors });
        console.error("Error updating order operations:", error);
        res.status(500).json({ message: "Failed to update order" });
      }
    },
  );
}
