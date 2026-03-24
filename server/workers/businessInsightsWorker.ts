/**
 * Business Insights Worker
 * 
 * Updates analytics aggregates:
 * - Daily/Weekly/Monthly revenue
 * - Order counts
 * - Average order value
 */

import { db } from "../db";
import { assertPhase2dForceFailGuard } from "./phase2dForceFailGuard";
import { analyticsDaily, analyticsWeekly, analyticsMonthly, processedEvents, orders } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

interface OrderPayload {
  order?: {
    orderId: string;
    orgId?: string | null;
    totals?: { total: number };
    total?: number;
    createdAt?: string;
  };
  orderId?: string;
  orgId?: string | null;
  total?: number;
  amount?: number;
}

export class BusinessInsightsWorker implements IWorker {
  name: WorkerName = 'BusinessInsightsWorker';

  supports(eventType: EventType): boolean {
    return [
      'OrderCreated', 
      'OrderUpdated', 
      'OrderStatusChanged', 
      'RefundIssued', 
      'OrderCancelled',
      'ExpenseLogged',
      'ExpenseUpdated',
      'ExpenseDeleted'
    ].includes(eventType);
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as OrderPayload & { _phase2dForceFail?: boolean };
    assertPhase2dForceFailGuard(payload);

    try {
      // Idempotency check - verify we haven't processed this event for this worker
      const alreadyProcessed = await db
        .select()
        .from(processedEvents)
        .where(
          and(
            eq(processedEvents.eventId, event.eventId),
            eq(processedEvents.workerName, this.name)
          )
        )
        .limit(1);

      if (alreadyProcessed.length > 0) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'already_processed',
          summary: 'Already processed (idempotent skip)',
        };
      }

      const total = payload.order?.totals?.total || payload.order?.total || payload.total || payload.amount || 0;
      const orderId = payload.order?.orderId || payload.orderId;
      let orgId = payload.order?.orgId ?? payload.orgId ?? null;
      if (!orgId && orderId) {
        const [ord] = await db.select({ orgId: orders.orgId }).from(orders).where(eq(orders.id, orderId)).limit(1);
        orgId = ord?.orgId ?? null;
      }
      if (!orgId) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'skipped',
          summary: 'Order has no orgId; skipping analytics (multi-tenant)',
        };
      }

      const eventDate = new Date(event.occurredAt);
      const dateStr = eventDate.toISOString().split('T')[0];
      const year = eventDate.getFullYear();
      const month = eventDate.getMonth() + 1;
      const week = this.getISOWeek(eventDate);

      let revenueChange = 0;
      let orderCountChange = 0;
      if (event.eventType === 'OrderCreated') {
        revenueChange = total;
        orderCountChange = 1;
      } else if (event.eventType === 'RefundIssued' || event.eventType === 'OrderCancelled') {
        revenueChange = -total;
      }

      if (revenueChange !== 0 || orderCountChange !== 0) {
        await db.execute(sql`
          INSERT INTO analytics_daily (org_id, date, total_orders, total_revenue)
          VALUES (${orgId}, ${dateStr}, ${orderCountChange}, ${revenueChange})
          ON CONFLICT (org_id, date) 
          DO UPDATE SET 
            total_orders = analytics_daily.total_orders + ${orderCountChange},
            total_revenue = analytics_daily.total_revenue + ${revenueChange}
        `);
        await db.execute(sql`
          INSERT INTO analytics_weekly (org_id, year, week, total_orders, total_revenue)
          VALUES (${orgId}, ${year}, ${week}, ${orderCountChange}, ${revenueChange})
          ON CONFLICT (org_id, year, week) 
          DO UPDATE SET 
            total_orders = analytics_weekly.total_orders + ${orderCountChange},
            total_revenue = analytics_weekly.total_revenue + ${revenueChange}
        `);
        await db.execute(sql`
          INSERT INTO analytics_monthly (org_id, year, month, total_orders, total_revenue)
          VALUES (${orgId}, ${year}, ${month}, ${orderCountChange}, ${revenueChange})
          ON CONFLICT (org_id, year, month) 
          DO UPDATE SET 
            total_orders = analytics_monthly.total_orders + ${orderCountChange},
            total_revenue = analytics_monthly.total_revenue + ${revenueChange}
        `);
      }

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: `Analytics updated: revenue ${revenueChange >= 0 ? '+' : ''}${revenueChange}, orders ${orderCountChange >= 0 ? '+' : ''}${orderCountChange}`,
        data: { revenueChange, orderCountChange, date: dateStr },
      };
    } catch (error) {
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'failed',
        summary: 'Analytics update failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }
}
