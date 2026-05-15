/**
 * Event-driven automation rules (Phase 10).
 * Does not publish follow-up domain events — prevents recursion and depth explosions.
 */
import { db } from "../db";
import { processedEvents } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "@shared/schema";
import { insertWorkerRunLog } from "../eventBus";
import {
  buildEvalContext,
  evaluateConditionJson,
  executeRuleAction,
  bumpRuleStats,
  loadEnabledRules,
  type RuleRunPayload,
} from "../services/automationEngine";

export class AutomationWorker implements IWorker {
  name: WorkerName = "AutomationWorker";

  supports(eventType: EventType): boolean {
    return eventType === "OrderCreated" || eventType === "PaymentCaptured" || eventType === "OrderStatusChanged";
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const alreadyProcessed = await db
      .select()
      .from(processedEvents)
      .where(and(eq(processedEvents.eventId, event.eventId), eq(processedEvents.workerName, this.name)))
      .limit(1);

    if (alreadyProcessed.length > 0) {
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: "already_processed",
        summary: "Already processed (idempotent skip)",
      };
    }

    try {
      const { ctx, error } = await buildEvalContext(event);
      const orgId = ctx.order?.orgId;
      if (!orgId) {
        await insertWorkerRunLog({
          eventId: event.eventId,
          correlationId: event.correlationId,
          eventType: event.eventType,
          workerName: this.name,
          status: "skipped",
          summary: error || "no_org_context",
          data: { ruleRun: { semanticStatus: "skipped", matched: false } },
        });
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: "success",
          summary: "Automation skipped — order/org not resolved",
        };
      }

      const rules = await loadEnabledRules(orgId, event.eventType);
      let processed = 0;

      for (const rule of rules) {
        processed++;
        const conditionJson = rule.conditionJson as unknown;
        const { matched, detail } = evaluateConditionJson(conditionJson, ctx);

        const baseRun: Omit<RuleRunPayload, "semanticStatus" | "actionAttempted" | "actionResult" | "errorSummary"> = {
          ruleId: rule.id,
          ruleName: rule.name,
          orgId,
          triggerEventType: rule.triggerEventType,
          matched,
          conditionResult: detail,
          sourceEventId: event.eventId,
          correlationId: event.correlationId,
        };

        if (!matched) {
          const payload: RuleRunPayload = {
            ...baseRun,
            actionAttempted: false,
            actionResult: null,
            errorSummary: null,
            semanticStatus: "not_matched",
          };
          await insertWorkerRunLog({
            eventId: event.eventId,
            correlationId: event.correlationId,
            eventType: event.eventType,
            workerName: this.name,
            status: "not_matched",
            summary: `Rule "${rule.name}" did not match`,
            data: { ruleRun: payload },
          });
          continue;
        }

        await bumpRuleStats(rule.id, true);

        let semanticStatus: RuleRunPayload["semanticStatus"] = "matched_action_success";
        let actionResult: string | null = null;
        let errorSummary: string | null = null;
        let actionAttempted = true;

        try {
          const exec = await executeRuleAction({
            orgId,
            ruleId: rule.id,
            ruleName: rule.name,
            actionJson: rule.actionJson,
            ctx,
          });
          actionResult = exec.summary;
          if (exec.skippedManual) {
            semanticStatus = "skipped";
          } else if (!exec.ok) {
            semanticStatus = "matched_action_failed";
            errorSummary = exec.summary;
          }
        } catch (e) {
          semanticStatus = "matched_action_failed";
          errorSummary = e instanceof Error ? e.message : String(e);
          actionResult = "action_error";
        }

        const payload: RuleRunPayload = {
          ...baseRun,
          matched: true,
          actionAttempted,
          actionResult,
          errorSummary,
          semanticStatus,
        };

        await insertWorkerRunLog({
          eventId: event.eventId,
          correlationId: event.correlationId,
          eventType: event.eventType,
          workerName: this.name,
          status: semanticStatus,
          summary: `${rule.name}: ${semanticStatus}`,
          data: { ruleRun: payload },
          error: errorSummary,
        });
      }

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: "success",
        summary: `Automation evaluated ${processed} rule(s)`,
        data: { rulesEvaluated: processed },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await insertWorkerRunLog({
        eventId: event.eventId,
        correlationId: event.correlationId,
        eventType: event.eventType,
        workerName: this.name,
        status: "failed",
        summary: "Automation worker failed",
        error: msg,
        data: {
          ruleRun: {
            semanticStatus: "failed",
            matched: false,
            errorSummary: msg,
            sourceEventId: event.eventId,
            correlationId: event.correlationId,
          },
        },
      });
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: "failed",
        summary: "Automation worker failed",
        error: msg,
      };
    }
  }
}
