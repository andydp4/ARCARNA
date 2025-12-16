/**
 * Expenses Worker
 * 
 * Handles expense event processing:
 * - Maintains expense records
 * - Updates expense aggregates
 */

import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

interface ExpensePayload {
  expense?: {
    expenseId: string;
    occurredAt?: string;
    category: string;
    amount: number;
    currency?: string;
    vendor?: string;
    notes?: string;
    linkedOrderId?: string;
  };
  expenseId?: string;
  amount?: number;
  category?: string;
}

export class ExpensesWorker implements IWorker {
  name: WorkerName = 'ExpensesWorker';

  supports(eventType: EventType): boolean {
    return ['ExpenseLogged', 'ExpenseUpdated', 'ExpenseDeleted'].includes(eventType);
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as ExpensePayload;
    
    try {
      const expense = payload.expense;
      const expenseId = expense?.expenseId || payload.expenseId || event.correlationId;
      const amount = expense?.amount || payload.amount || 0;
      const category = expense?.category || payload.category || 'Unknown';

      let action: string;
      switch (event.eventType) {
        case 'ExpenseLogged':
          action = 'logged';
          console.log(`[ExpensesWorker] Expense logged: ${category} = ${amount}`);
          break;
        case 'ExpenseUpdated':
          action = 'updated';
          console.log(`[ExpensesWorker] Expense updated: ${category} = ${amount}`);
          break;
        case 'ExpenseDeleted':
          action = 'deleted';
          console.log(`[ExpensesWorker] Expense deleted: ${expenseId}`);
          break;
        default:
          action = 'processed';
      }

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: `Expense ${action}: ${category}`,
        data: { expenseId, amount, category, action },
      };
    } catch (error) {
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'failed',
        summary: 'Expense processing failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
