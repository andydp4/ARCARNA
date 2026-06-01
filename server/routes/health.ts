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

export function registerHealthRoutes(app: Express): void {
  // Public probes — registered before auth middleware
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      nodeEnv: process.env.NODE_ENV ?? "development",
      authProvider: process.env.AUTH_PROVIDER ?? "clerk",
    });
  });

  app.get("/api/health/metrics", async (_req, res) => {
    if (!process.env.DATABASE_URL?.trim()) {
      return res.json({
        ok: true,
        db: false,
        outboxPending: null,
        outboxDispatched: null,
        deadLetterCount: null,
        oldestPendingSeconds: null,
        jobQueued: null,
        nodeEnv: process.env.NODE_ENV ?? "development",
      });
    }
    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const metrics = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM event_outbox WHERE status = 'pending') AS outbox_pending,
          (SELECT count(*)::int FROM event_outbox WHERE status = 'dispatched') AS outbox_dispatched,
          (SELECT count(*)::int FROM dead_letters) AS dead_letter_count,
          COALESCE(
            (SELECT EXTRACT(EPOCH FROM (now() - min(created_at)))::int
             FROM event_outbox WHERE status = 'pending'),
            0
          ) AS oldest_pending_seconds,
          (SELECT count(*)::int FROM job_queue WHERE status = 'queued') AS job_queued
      `);
      const row = (metrics as { rows?: Record<string, number>[] }).rows?.[0] ?? {};
      res.json({
        ok: true,
        db: true,
        outboxPending: row.outbox_pending ?? 0,
        outboxDispatched: row.outbox_dispatched ?? 0,
        deadLetterCount: row.dead_letter_count ?? 0,
        oldestPendingSeconds: row.oldest_pending_seconds ?? 0,
        jobQueued: row.job_queued ?? 0,
        nodeEnv: process.env.NODE_ENV ?? "development",
      });
    } catch (e) {
      res.status(503).json({
        ok: false,
        message: e instanceof Error ? e.message : "metrics_unavailable",
      });
    }
  });

  app.get("/api/auth/runtime", (_req, res) => {
    res.json(getAuthRuntimeSnapshot());
  });
}
