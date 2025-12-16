/**
 * Business Insights Worker
 * 
 * Updates analytics aggregates:
 * - Daily/Weekly/Monthly revenue
 * - Order counts
 * - Average order value
 */

import { db } from "../db";
import { analyticsDaily, analyticsWeekly, analyticsMonthly } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

interface OrderPayload {
  order?: {
    orderId: string;
    totals?: {
      total: number;
    };
    total?: number;
    createdAt?: string;
  };
  orderId?: string;
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
    const payload = event.payload as OrderPayload;
    
    try {
      const total = payload.order?.totals?.total || payload.order?.total || payload.total || payload.amount || 0;
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
        // Don't decrease order count for refunds
      }

      if (revenueChange !== 0 || orderCountChange !== 0) {
        // Update daily analytics
        await db.execute(sql`
          INSERT INTO analytics_daily (date, total_orders, total_revenue)
          VALUES (${dateStr}, ${orderCountChange}, ${revenueChange})
          ON CONFLICT (date) 
          DO UPDATE SET 
            total_orders = analytics_daily.total_orders + ${orderCountChange},
            total_revenue = analytics_daily.total_revenue + ${revenueChange}
        `);

        // Update weekly analytics
        await db.execute(sql`
          INSERT INTO analytics_weekly (year, week, total_orders, total_revenue)
          VALUES (${year}, ${week}, ${orderCountChange}, ${revenueChange})
          ON CONFLICT (year, week) 
          DO UPDATE SET 
            total_orders = analytics_weekly.total_orders + ${orderCountChange},
            total_revenue = analytics_weekly.total_revenue + ${revenueChange}
        `);

        // Update monthly analytics
        await db.execute(sql`
          INSERT INTO analytics_monthly (year, month, total_orders, total_revenue)
          VALUES (${year}, ${month}, ${orderCountChange}, ${revenueChange})
          ON CONFLICT (year, month) 
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
