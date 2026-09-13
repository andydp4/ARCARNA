/**
 * Customer Worker
 * 
 * Updates customer metrics for order events:
 * - Lifetime value
 * - Order count
 * - Last order date
 */

import { db } from "../db";
import { customers, customerMetrics, processedEvents } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

interface OrderPayload {
  order?: {
    orderId: string;
    customerId?: string;
    totals?: {
      total: number;
    };
    total?: number;
  };
  orderId?: string;
  customerId?: string;
  total?: number;
}

export class CustomerWorker implements IWorker {
  name: WorkerName = 'CustomerWorker';

  supports(eventType: EventType): boolean {
    return ['OrderCreated', 'OrderUpdated', 'OrderStatusChanged', 'RefundIssued', 'OrderCancelled'].includes(eventType);
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as OrderPayload;
    
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

      const customerId = payload.order?.customerId || payload.customerId;
      
      if (!customerId) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: 'No customer associated with order',
        };
      }

      const total = payload.order?.totals?.total || payload.order?.total || payload.total || 0;
      const orderId = payload.order?.orderId || payload.orderId || event.correlationId;
      const now = new Date();

      // Update customer record
      if (event.eventType === 'OrderCreated') {
        // Get current customer data
        const customerResult = await db
          .select()
          .from(customers)
          .where(eq(customers.id, customerId))
          .limit(1);

        if (customerResult.length > 0) {
          const customer = customerResult[0];
          const currentTotal = parseFloat(customer.totalSpent || '0');
          const newTotal = currentTotal + total;

          await db
            .update(customers)
            .set({
              totalSpent: newTotal.toFixed(2),
              updatedAt: now,
            })
            .where(eq(customers.id, customerId));
        }

        // customer_metrics (total_spent, order_count, last_order_date, rfm_score,
        // clv) is deliberately NOT touched here. `engine.placeOrder`
        // (packages/domain/src/engine.ts) already calls
        // `CustomersRepo.updateMetrics` synchronously, in the same transaction
        // as every order, for every order-creation channel (ARCHITECTURAL_
        // PRINCIPLES.md #14: web/WhatsApp/phone/API orders all go through
        // engine.placeOrder — none bypass it). That call does a full recompute
        // from `orders` (COUNT/SUM grouped by customer_id), so it is idempotent
        // and already authoritative for these columns by the time this async
        // OrderCreated event is ever processed.
        //
        // This block used to ALSO write customer_metrics additively
        // (`total_spent = total_spent + total`, `order_count = order_count + 1`
        // via ON CONFLICT), which double-counted every single order: the
        // synchronous recompute set the correct total, and this handler then
        // added the same order's total on top of it a second time. Confirmed
        // live: one £72 order for a fresh customer produced
        // customer_metrics.order_count = 2 and total_spent = 144.00. Removed
        // rather than made idempotent, since there is nothing left for this
        // path to correctly do — the recompute already owns these columns.
      } else if (event.eventType === 'RefundIssued' || event.eventType === 'OrderCancelled') {
        // Reduce totals on refund/cancel
        const customerResult = await db
          .select()
          .from(customers)
          .where(eq(customers.id, customerId))
          .limit(1);

        if (customerResult.length > 0) {
          const customer = customerResult[0];
          const currentTotal = parseFloat(customer.totalSpent || '0');
          const newTotal = Math.max(0, currentTotal - total);

          await db
            .update(customers)
            .set({
              totalSpent: newTotal.toFixed(2),
              updatedAt: now,
            })
            .where(eq(customers.id, customerId));
        }

        await db.execute(sql`
          UPDATE customer_metrics 
          SET total_spent = GREATEST(0, total_spent - ${total})
          WHERE customer_id = ${customerId}
        `);
      }

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: `Customer ${customerId} metrics updated`,
        data: { customerId, eventType: event.eventType },
      };
    } catch (error) {
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'failed',
        summary: 'Customer update failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
