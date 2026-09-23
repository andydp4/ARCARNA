/**
 * Needs attention (v1.2 Phase 1A): till sales the server refused, and the
 * logged manager actions on them. See server/services/saleIssues.ts.
 *
 *   POST /api/sale-issues                     the till reports a refused sale
 *   GET  /api/sale-issues/summary             how many are open (the till's indicator)
 *   GET  /api/sale-issues                     the open list — managers
 *   POST /api/sale-issues/:id/discard         drop one, with a reason — managers, logged
 *   POST /api/sale-issues/sign-out-override   sign out with sales unsent — managers, logged
 *
 * Retry and Edit are `POST /api/orders` with `saleIssueId` (routes/orders.ts),
 * so a resent sale goes through every rule a first attempt does.
 */
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { requireRole } from "../auth";
import { adminAuditRow, recordAdminAudit } from "../adminAudit";
import { isValidClientOrderId } from "@shared/orders/saleReference";
import { requireManager } from "../services/saleIssues";
import { resolveUserNames } from "../services/userDisplayName";

const TILL_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"] as const;

const reportSchema = z.object({
  clientOrderId: z.string().refine(isValidClientOrderId, "Invalid sale reference"),
  // The sale as the till sent it. It must at least be a sale — lines to sell —
  // or a manager could never retry or edit it.
  payload: z
    .object({ lines: z.array(z.object({ productId: z.string() }).passthrough()).min(1) })
    .passthrough(),
  reason: z.string().trim().min(1).max(2000),
  httpStatus: z.number().int().min(100).max(599).nullable().optional(),
  queuedAt: z.string().datetime({ offset: true }).nullable().optional(),
  // "refused": the server said no. "signed_out": a manager signed the till out
  // before the sale could be sent, and handed it here instead of losing it.
  source: z.enum(["refused", "signed_out"]).default("refused"),
  // Who was signed in when the sale was rung, when that is not whoever is
  // reporting it (the till was handed over before it could send). Honoured
  // only for a member of this org; otherwise the reporter is recorded.
  rungByUserId: z.string().min(1).max(255).optional(),
});

const discardSchema = z.object({
  reason: z.string().trim().min(3, "Say why this sale is being discarded.").max(500),
});

const overrideSchema = z.object({
  waiting: z.number().int().min(0).max(10_000),
  failed: z.number().int().min(0).max(10_000),
  reason: z.string().trim().min(3, "Say why the till is being signed out with sales unsent.").max(500),
  // References of the sales handed to Needs attention on the way out.
  references: z.array(z.string().refine(isValidClientOrderId)).max(10_000).default([]),
});

/** Transport-only fields the till adds when replaying; not part of the sale. */
function cleanPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    _offlineOrderReplay: _replay,
    _offlineQueuedAt: _queued,
    _cashierShiftReplayToken: _token,
    saleIssueId: _issue,
    saleIssueMode: _mode,
    ...rest
  } = payload;
  return rest;
}

export function registerSaleIssueRoutes(app: Express, scoped: RequestHandler[]): void {
  app.post("/api/sale-issues", ...scoped, requireRole(...TILL_ROLES), async (req: any, res) => {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid sale", code: "SALE_ISSUE_INVALID" });
    }
    const ctx = req.orgContext as { orgId: string | null; locationId: string | null; role: string };
    if (!ctx?.orgId) return res.status(400).json({ message: "Org context required" });
    const userId: string | undefined = req.user?.id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const input = parsed.data;
    try {
      const { db } = await import("../db");
      const { saleIssues } = await import("@shared/schema");
      const { findSaleByReference } = await import("../services/saleReference");

      // It landed after all (a slow first attempt, a replay from another tab):
      // there is nothing for a manager to do, and the till can let it go.
      const recorded = await findSaleByReference(db, ctx.orgId, input.clientOrderId);
      if (recorded) return res.json({ alreadyRecorded: true, orderId: recorded.id });

      let rungByUserId = userId;
      if (input.rungByUserId && input.rungByUserId !== userId) {
        const { allowedUsers } = await import("@shared/schema");
        const { and, eq, or } = await import("drizzle-orm");
        const [member] = await db
          .select({ id: allowedUsers.id })
          .from(allowedUsers)
          .where(
            and(
              eq(allowedUsers.orgId, ctx.orgId),
              or(eq(allowedUsers.authUserId, input.rungByUserId), eq(allowedUsers.replitUserId, input.rungByUserId)),
            ),
          )
          .limit(1);
        if (member) rungByUserId = input.rungByUserId;
      }
      const payload = cleanPayload(input.payload as Record<string, unknown>);
      const reason =
        input.source === "signed_out" ? `Not sent before the till was signed out. ${input.reason}` : input.reason;
      // The till may report the same refusal more than once (it lost the first
      // answer). The first report stands; a repeat changes nothing.
      const [created] = await db
        .insert(saleIssues)
        .values({
          orgId: ctx.orgId,
          clientOrderId: input.clientOrderId,
          locationId: ctx.locationId ?? null,
          rungByUserId,
          payload,
          reason,
          httpStatus: input.httpStatus ?? null,
          queuedAt: input.queuedAt ? new Date(input.queuedAt) : null,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        await recordAdminAudit(req, {
          actorUserId: userId,
          actorRole: req.user?.role ?? ctx.role,
          action: "sale_issue.reported",
          targetType: "sale_issue",
          targetId: created.id,
          orgId: ctx.orgId,
          metadata: {
            clientOrderId: input.clientOrderId,
            reason,
            httpStatus: input.httpStatus ?? null,
            source: input.source,
            rungByUserId,
          },
        });
      }
      return res.status(created ? 201 : 200).json({ reported: true, issueId: created?.id ?? null });
    } catch (error) {
      console.error("Error reporting a refused sale:", error);
      return res.status(500).json({ message: "Failed to report the sale" });
    }
  });

  app.get("/api/sale-issues/summary", ...scoped, requireRole(...TILL_ROLES), async (req: any, res) => {
    try {
      const orgId: string | null = req.orgContext?.orgId ?? null;
      if (!orgId) return res.json({ open: 0 });
      const { db } = await import("../db");
      const { saleIssues } = await import("@shared/schema");
      const { and, count, eq } = await import("drizzle-orm");
      const [row] = await db
        .select({ open: count() })
        .from(saleIssues)
        .where(and(eq(saleIssues.orgId, orgId), eq(saleIssues.status, "open")));
      return res.json({ open: Number(row?.open ?? 0) });
    } catch (error) {
      console.error("Error counting refused sales:", error);
      return res.status(500).json({ message: "Failed to count refused sales" });
    }
  });

  app.get("/api/sale-issues", ...scoped, requireManager, async (req: any, res) => {
    try {
      const orgId: string | null = req.orgContext?.orgId ?? null;
      if (!orgId) return res.status(400).json({ message: "Org context required" });
      const { db } = await import("../db");
      const { saleIssues } = await import("@shared/schema");
      const { and, desc, eq } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(saleIssues)
        .where(and(eq(saleIssues.orgId, orgId), eq(saleIssues.status, "open")))
        .orderBy(desc(saleIssues.createdAt))
        .limit(200);
      const names = await resolveUserNames(rows.map((r) => r.rungByUserId));
      return res.json({
        issues: rows.map((r) => ({
          id: r.id,
          clientOrderId: r.clientOrderId,
          locationId: r.locationId,
          rungByUserId: r.rungByUserId,
          rungByName: names.get(r.rungByUserId) ?? null,
          payload: r.payload,
          reason: r.reason,
          httpStatus: r.httpStatus,
          queuedAt: r.queuedAt,
          reportedAt: r.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error listing refused sales:", error);
      return res.status(500).json({ message: "Failed to load Needs attention" });
    }
  });

  app.post("/api/sale-issues/:id/discard", ...scoped, requireManager, async (req: any, res) => {
    const parsed = discardSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid body", code: "DISCARD_REASON_REQUIRED" });
    }
    try {
      const orgId: string | null = req.orgContext?.orgId ?? null;
      if (!orgId) return res.status(400).json({ message: "Org context required" });
      const { db } = await import("../db");
      const { saleIssues, adminAuditLogs } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");
      const id = String(req.params.id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ message: "Sale not found" });
      // The discard and its log entry commit together or not at all: a discard
      // nobody can trace is the silent drop this page exists to prevent.
      const discarded = await db.transaction(async (tx) => {
        const [row] = await tx
        .update(saleIssues)
        .set({
          status: "discarded",
          discardReason: parsed.data.reason,
          resolvedByUserId: req.user?.id ?? null,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(saleIssues.id, id), eq(saleIssues.orgId, orgId), eq(saleIssues.status, "open")))
        .returning();
        if (!row) return null;
        // The whole sale goes in the log, so a discard can always be looked at
        // again — and keyed in by hand — later.
        await tx.insert(adminAuditLogs).values(
          adminAuditRow(req, {
            actorUserId: req.user?.id ?? "unknown",
            actorRole: req.user?.role ?? req.orgContext?.role,
            action: "sale_issue.discarded",
            targetType: "sale_issue",
            targetId: row.id,
            orgId,
            metadata: {
              clientOrderId: row.clientOrderId,
              reason: parsed.data.reason,
              refusal: row.reason,
              rungByUserId: row.rungByUserId,
              payload: row.payload,
            },
          }),
        );
        return row;
      });
      if (!discarded) {
        const [exists] = await db
          .select({ id: saleIssues.id })
          .from(saleIssues)
          .where(and(eq(saleIssues.id, id), eq(saleIssues.orgId, orgId)))
          .limit(1);
        return exists
          ? res.status(409).json({ message: "This sale has already been dealt with.", code: "SALE_ISSUE_CLOSED" })
          : res.status(404).json({ message: "Sale not found" });
      }
      return res.json({ discarded: true });
    } catch (error) {
      console.error("Error discarding a refused sale:", error);
      return res.status(500).json({ message: "Failed to discard the sale" });
    }
  });

  app.post("/api/sale-issues/sign-out-override", ...scoped, requireManager, async (req: any, res) => {
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid body", code: "OVERRIDE_REASON_REQUIRED" });
    }
    const orgId: string | null = req.orgContext?.orgId ?? null;
    if (!orgId) return res.status(400).json({ message: "Org context required" });
    try {
      // Written directly, not through recordAdminAudit (which swallows a
      // failure): the till signs out only once this has been logged.
      const { db } = await import("../db");
      const { adminAuditLogs } = await import("@shared/schema");
      await db.insert(adminAuditLogs).values(
        adminAuditRow(req, {
          actorUserId: req.user?.id ?? "unknown",
          actorRole: req.user?.role ?? req.orgContext?.role,
          action: "till.sign_out_override",
          targetType: "till",
          targetId: null,
          orgId,
          metadata: {
            waiting: parsed.data.waiting,
            failed: parsed.data.failed,
            reason: parsed.data.reason,
            references: parsed.data.references,
          },
        }),
      );
      return res.json({ ok: true });
    } catch (error) {
      console.error("Error logging a sign-out override:", error);
      return res.status(500).json({ message: "Could not log the override, so the till was not signed out." });
    }
  });
}
