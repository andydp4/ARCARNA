import type { Express } from "express";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { automationRules, workerRunLogs } from "@shared/schema";
import { isAuthenticated, requireOrgContext, requireOrgScope, requireRole } from "../auth";
import { buildEvalContext, evaluateConditionJson } from "../services/automationEngine";
import type { EventEnvelope, EventType } from "@shared/schema";
import { randomUUID } from "crypto";

const scoped = [isAuthenticated, requireOrgContext, requireOrgScope];

const upsertRuleSchema = z.object({
  name: z.string().min(1).max(255),
  triggerEventType: z.enum(["OrderCreated", "PaymentCaptured", "OrderStatusChanged"]),
  conditionJson: z.record(z.any()).optional(),
  actionJson: z.record(z.any()).optional(),
  priority: z.number().int().optional(),
  isEnabled: z.number().int().min(0).max(1).optional(),
});

const testRuleSchema = z.object({
  triggerEventType: z.enum(["OrderCreated", "PaymentCaptured", "OrderStatusChanged"]),
  conditionJson: z.unknown(),
  samplePayload: z.record(z.any()).optional(),
});

export function registerAutomationRoutes(app: Express) {
  app.get("/api/rules", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const rows = await db
        .select()
        .from(automationRules)
        .where(eq(automationRules.orgId, ctx.orgId))
        .orderBy(desc(automationRules.updatedAt));
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Failed to list rules" });
    }
  });

  app.post(
    "/api/rules",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const parsed = upsertRuleSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid body", errors: parsed.error.errors });
        }
        const [row] = await db
          .insert(automationRules)
          .values({
            orgId: ctx.orgId,
            name: parsed.data.name,
            triggerEventType: parsed.data.triggerEventType,
            conditionJson: parsed.data.conditionJson ?? {},
            actionJson: parsed.data.actionJson ?? {},
            priority: parsed.data.priority ?? 100,
            isEnabled: parsed.data.isEnabled ?? 0,
          })
          .returning();
        res.status(201).json(row);
      } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to create rule" });
      }
    },
  );

  app.put(
    "/api/rules/:id",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const parsed = upsertRuleSchema.partial().safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid body", errors: parsed.error.errors });
        }
        const [existing] = await db
          .select()
          .from(automationRules)
          .where(and(eq(automationRules.id, req.params.id), eq(automationRules.orgId, ctx.orgId)))
          .limit(1);
        if (!existing) return res.status(404).json({ message: "Rule not found" });

        const p = parsed.data;
        const [updated] = await db
          .update(automationRules)
          .set({
            name: p.name ?? existing.name,
            triggerEventType: p.triggerEventType ?? existing.triggerEventType,
            conditionJson: p.conditionJson ?? existing.conditionJson,
            actionJson: p.actionJson ?? existing.actionJson,
            priority: p.priority ?? existing.priority,
            isEnabled: p.isEnabled ?? existing.isEnabled,
            updatedAt: new Date(),
          })
          .where(and(eq(automationRules.id, req.params.id), eq(automationRules.orgId, ctx.orgId)))
          .returning();
        res.json(updated);
      } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to update rule" });
      }
    },
  );

  app.delete(
    "/api/rules/:id",
    ...scoped,
    requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"),
    async (req: any, res) => {
      try {
        const ctx = req.orgContext as { orgId: string };
        const [deleted] = await db
          .delete(automationRules)
          .where(and(eq(automationRules.id, req.params.id), eq(automationRules.orgId, ctx.orgId)))
          .returning({ id: automationRules.id });
        if (!deleted) return res.status(404).json({ message: "Rule not found" });
        res.json({ ok: true });
      } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Failed to delete rule" });
      }
    },
  );

  app.post("/api/rules/test", ...scoped, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const parsed = testRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body", errors: parsed.error.errors });
      }
      const sample: Record<string, unknown> = { ...(parsed.data.samplePayload || {}), orgId: ctx.orgId };
      const nestedOrder = sample.order as { orderId?: string } | undefined;
      const envelope: EventEnvelope = {
        eventId: `test-${randomUUID()}`,
        eventType: parsed.data.triggerEventType as EventType,
        occurredAt: new Date().toISOString(),
        correlationId: nestedOrder?.orderId || randomUUID(),
        version: 1,
        payload: sample,
      };
      const { ctx: evalCtx } = await buildEvalContext(envelope);
      const { matched, detail } = evaluateConditionJson(parsed.data.conditionJson, evalCtx);
      res.json({ matched, conditionResult: detail });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Rule test failed" });
    }
  });

  app.get("/api/rules/:id/executions", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const [rule] = await db
        .select()
        .from(automationRules)
        .where(and(eq(automationRules.id, req.params.id), eq(automationRules.orgId, ctx.orgId)))
        .limit(1);
      if (!rule) return res.status(404).json({ message: "Rule not found" });

        const rows = await db
        .select()
        .from(workerRunLogs)
        .where(
          and(
            eq(workerRunLogs.workerName, "AutomationWorker"),
            sql`(${workerRunLogs.data}->'ruleRun'->>'ruleId') = ${req.params.id}`,
            sql`(${workerRunLogs.data}->'ruleRun'->>'orgId') = ${ctx.orgId}`,
          ),
        )
        .orderBy(desc(workerRunLogs.createdAt))
        .limit(limit);

      const safe = rows.map((r) => {
        try {
          return {
            logId: r.logId,
            createdAt: r.createdAt,
            status: r.status,
            summary: r.summary,
            data: r.data,
            error: r.error,
            eventId: r.eventId,
            correlationId: r.correlationId,
            eventType: r.eventType,
          };
        } catch {
          return { logId: r.logId, createdAt: r.createdAt, status: r.status };
        }
      });

      res.json({ items: safe });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Failed to load executions" });
    }
  });
}
