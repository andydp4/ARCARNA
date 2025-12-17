/**
 * Finance Worker
 * 
 * Updates financial metrics:
 * - Revenue tracking
 * - COGS calculations
 * - Gross profit tracking
 */

import { db } from "../db";
import { processedEvents } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

interface OrderItem {
  cogsUnit?: number;
  costPrice?: number;
  qty?: number;
  quantity?: number;
}

interface OrderPayload {
  order?: {
    orderId: string;
    totals?: {
      total: number;
    };
    total?: number;
    items?: OrderItem[];
  };
  orderId?: string;
  total?: number;
  amount?: number;
}

interface ExpensePayload {
  expense?: {
    expenseId: string;
    amount: number;
    category: string;
  };
  amount?: number;
}

export class FinanceWorker implements IWorker {
  name: WorkerName = 'FinanceWorker';

  supports(eventType: EventType): boolean {
    return [
      'OrderCreated', 
      'OrderUpdated', 
      'OrderStatusChanged',
      'PaymentCaptured',
      'RefundIssued', 
      'OrderCancelled',
      'ExpenseLogged',
      'ExpenseUpdated',
      'ExpenseDeleted'
    ].includes(eventType);
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
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

      if (event.eventType.startsWith('Expense')) {
        return await this.handleExpenseEvent(event);
      } else {
        return await this.handleOrderEvent(event);
      }
    } catch (error) {
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'failed',
        summary: 'Finance update failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async handleOrderEvent(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as OrderPayload;
    const total = payload.order?.totals?.total || payload.order?.total || payload.total || 0;
    const items = payload.order?.items || [];

    // Calculate COGS
    let cogs = 0;
    for (const item of items) {
      const qty = item.qty || item.quantity || 0;
      const costPerUnit = item.cogsUnit || item.costPrice || 0;
      cogs += qty * costPerUnit;
    }

    const grossProfit = total - cogs;
    const eventDate = new Date(event.occurredAt);
    const dateStr = eventDate.toISOString().split('T')[0];

    let multiplier = 1;
    if (event.eventType === 'RefundIssued' || event.eventType === 'OrderCancelled') {
      multiplier = -1;
    }

    // Log financial metrics (could be stored in a profit_daily table)
    console.log(`[FinanceWorker] ${event.eventType}: revenue=${total * multiplier}, cogs=${cogs * multiplier}, profit=${grossProfit * multiplier}`);

    return {
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      status: 'success',
      summary: `Finance updated: revenue ${total * multiplier}, gross profit ${grossProfit * multiplier}`,
      data: { 
        revenue: total * multiplier, 
        cogs: cogs * multiplier, 
        grossProfit: grossProfit * multiplier,
        date: dateStr 
      },
    };
  }

  private async handleExpenseEvent(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as ExpensePayload;
    const amount = payload.expense?.amount || payload.amount || 0;
    const category = payload.expense?.category || 'Unknown';

    let action = 'recorded';
    if (event.eventType === 'ExpenseUpdated') action = 'updated';
    if (event.eventType === 'ExpenseDeleted') action = 'deleted';

    console.log(`[FinanceWorker] Expense ${action}: ${category} = ${amount}`);

    return {
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      status: 'success',
      summary: `Expense ${action}: ${category} = ${amount}`,
      data: { amount, category, action },
    };
  }
}
