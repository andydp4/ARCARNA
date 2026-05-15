/**
 * Rules Engine v1 — deterministic condition evaluation and guarded actions.
 * No outbound events from actions (prevents recursion / fan-out loops).
 */
import { db } from "../db";
import { customers, orders, automationRules, orgNotifications } from "@shared/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import type { EventEnvelope, EventType } from "@shared/schema";

export type RuleSemanticStatus =
  | "matched_action_success"
  | "matched_action_failed"
  | "not_matched"
  | "skipped"
  | "failed";

export type RuleRunPayload = {
  ruleId: string;
  ruleName: string;
  orgId: string;
  triggerEventType: string;
  matched: boolean;
  conditionResult: unknown;
  actionAttempted: boolean;
  actionResult: string | null;
  errorSummary: string | null;
  sourceEventId: string;
  correlationId: string;
  semanticStatus: RuleSemanticStatus;
};

export type EvalContext = {
  eventType: EventType;
  order: {
    id: string;
    status: string | null;
    total: number;
    customerId: string | null;
    orgId: string | null;
  } | null;
  payload: Record<string, unknown>;
};

const MAX_RULES_PER_EVENT = 50;

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function compare(op: string, left: unknown, right: unknown): boolean {
  if (op === "eq") return left === right || String(left) === String(right);
  if (op === "neq") return left !== right && String(left) !== String(right);
  const ln = typeof left === "number" ? left : parseFloat(String(left));
  const rn = typeof right === "number" ? right : parseFloat(String(right));
  if (Number.isNaN(ln) || Number.isNaN(rn)) return false;
  if (op === "gt") return ln > rn;
  if (op === "gte") return ln >= rn;
  if (op === "lt") return ln < rn;
  if (op === "lte") return ln <= rn;
  if (op === "in" && Array.isArray(right)) {
    return right.some((r) => r === left || String(r) === String(left));
  }
  return false;
}

export function evaluateConditionJson(
  conditionJson: unknown,
  ctx: EvalContext,
): { matched: boolean; detail: unknown } {
  const root = (conditionJson || {}) as {
    logic?: "and" | "or";
    checks?: Array<{ field: string; op: string; value: unknown }>;
  };
  const checks = root.checks;
  if (!checks || checks.length === 0) {
    return { matched: false, detail: { reason: "no_checks" } };
  }
  const logic = root.logic === "or" ? "or" : "and";
  const flatCtx = {
    order: ctx.order,
    event: { type: ctx.eventType },
    payload: ctx.payload,
  };
  const results: unknown[] = [];
  for (const c of checks) {
    const left = getByPath(flatCtx, c.field) ?? getByPath(ctx.payload, c.field);
    const ok = compare(c.op, left, c.value);
    results.push({ field: c.field, op: c.op, value: c.value, left, ok });
    if (logic === "and" && !ok) return { matched: false, detail: { checks: results } };
    if (logic === "or" && ok) return { matched: true, detail: { checks: results } };
  }
  const matched = logic === "and" ? results.every((_, i) => (results[i] as { ok: boolean }).ok) : false;
  return { matched, detail: { checks: results } };
}

export async function buildEvalContext(
  event: EventEnvelope,
): Promise<{ ctx: EvalContext; error?: string }> {
  const correlationId = event.correlationId;
  const payload = (event.payload || {}) as Record<string, unknown>;
  let orderRow: typeof orders.$inferSelect | null = null;
  try {
    const [row] = await db.select().from(orders).where(eq(orders.id, correlationId)).limit(1);
    orderRow = row ?? null;
  } catch {
    orderRow = null;
  }

  const nestedOrder = payload.order as Record<string, unknown> | undefined;
  const overrideOrg = typeof payload.orgId === "string" ? (payload.orgId as string) : undefined;
  const totalFromPayload =
    nestedOrder?.total !== undefined
      ? Number(nestedOrder.total)
      : payload.total !== undefined
        ? Number(payload.total)
        : undefined;

  const order =
    orderRow || nestedOrder
      ? {
          id: orderRow?.id ?? (nestedOrder?.orderId as string) ?? correlationId,
          status: orderRow?.status ?? (nestedOrder?.status as string) ?? (payload.to as string) ?? null,
          total:
            orderRow?.total !== undefined
              ? parseFloat(String(orderRow.total))
              : totalFromPayload ?? 0,
          customerId:
            orderRow?.customerId ??
            (nestedOrder?.customerId as string | null) ??
            (payload.customerId as string | null) ??
            null,
          orgId: orderRow?.orgId ?? overrideOrg ?? null,
        }
      : null;

  return {
    ctx: {
      eventType: event.eventType,
      order,
      payload,
    },
  };
}

export async function loadEnabledRules(orgId: string, trigger: EventType) {
  return db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.orgId, orgId),
        eq(automationRules.isEnabled, 1),
        eq(automationRules.triggerEventType, trigger),
      ),
    )
    .orderBy(asc(automationRules.priority), asc(automationRules.createdAt))
    .limit(MAX_RULES_PER_EVENT);
}

type ActionJson = {
  type?: string;
  title?: string;
  message?: string;
  severity?: string;
  category?: string;
};

export async function executeRuleAction(args: {
  orgId: string;
  ruleId: string;
  ruleName: string;
  actionJson: unknown;
  ctx: EvalContext;
}): Promise<{ ok: boolean; summary: string; skippedManual?: boolean }> {
  const action = (args.actionJson || {}) as ActionJson;
  const type = action.type;
  if (!type) return { ok: false, summary: "missing_action_type" };

  if (type === "in_app_notification" || type === "notify") {
    const title = action.title || args.ruleName;
    const message = action.message || "Automation notification";
    await db.insert(orgNotifications).values({
      orgId: args.orgId,
      title,
      message,
      severity: (action.severity as "info" | "warning" | "error") || "info",
      source: "automation_rule",
      metadata: { ruleId: args.ruleId },
    });
    return { ok: true, summary: "notification_created" };
  }

  if (type === "tag_customer" || type === "tag_customer_category") {
    const customerId = args.ctx.order?.customerId;
    if (!customerId) return { ok: false, summary: "no_customer_on_order" };
    const category = action.category || "VIP";
    const [cust] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.orgId, args.orgId)))
      .limit(1);
    if (!cust) return { ok: false, summary: "customer_not_found" };
    if (cust.manualOverrideProtected === 1) {
      return { ok: true, summary: "skipped_manual_override", skippedManual: true };
    }
    await db
      .update(customers)
      .set({
        category,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, customerId), eq(customers.orgId, args.orgId)));
    return { ok: true, summary: `category_set_${category}` };
  }

  return { ok: false, summary: `unknown_action_${type}` };
}

export async function bumpRuleStats(ruleId: string, matched: boolean) {
  if (!matched) return;
  await db
    .update(automationRules)
    .set({
      lastTriggeredAt: new Date(),
      executionCount: sql`${automationRules.executionCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(automationRules.id, ruleId));
}
