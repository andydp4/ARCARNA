/**
 * Customer Worker
 * 
 * Updates customer metrics for order events:
 * - Lifetime value
 * - Order count
 * - Last order date
 */

import { db } from "../db";
import { customers, customerMetrics } from "../../shared/schema";
import { eq, sql } from "drizzle-orm";
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

        // Update or insert customer metrics
        await db.execute(sql`
          INSERT INTO customer_metrics (customer_id, last_order_date, total_spent, order_count)
          VALUES (${customerId}, ${now.toISOString().split('T')[0]}, ${total}, 1)
          ON CONFLICT (customer_id) 
          DO UPDATE SET 
            last_order_date = ${now.toISOString().split('T')[0]},
            total_spent = customer_metrics.total_spent + ${total},
            order_count = customer_metrics.order_count + 1
        `);
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
