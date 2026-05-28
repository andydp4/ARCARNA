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
        jobQueued: null,
        nodeEnv: process.env.NODE_ENV ?? "development",
      });
    }
    try {
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const out = await db.execute(
        sql`SELECT count(*)::int AS c FROM event_outbox WHERE status = 'pending'`,
      );
      const jobs = await db.execute(
        sql`SELECT count(*)::int AS c FROM job_queue WHERE status = 'queued'`,
      );
      const pick = (r: unknown) => {
        const raw = r as { rows?: { c: number }[] };
        const rows = raw?.rows ?? [];
        return rows[0]?.c ?? 0;
      };
      res.json({
        ok: true,
        db: true,
        outboxPending: pick(out),
        jobQueued: pick(jobs),
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
