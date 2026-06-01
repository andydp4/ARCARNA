/**
 * Loyalty Worker
 * 
 * Handles loyalty point calculations:
 * - OrderCreated: earn points based on total
 * - RefundIssued/OrderCancelled: reverse points
 */

import { db } from "../db";
import { customers, loyaltyLedger } from "../../shared/schema";
import { eq } from "drizzle-orm";
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
  amount?: number;
  orderTotal?: number;
  pointsToReverse?: number;
}

// Points earned per currency unit (e.g., 1 point per £1)
const POINTS_PER_UNIT = 1;

export class LoyaltyWorker implements IWorker {
  name: WorkerName = 'LoyaltyWorker';

  supports(eventType: EventType): boolean {
    return ['OrderCreated', 'OrderUpdated', 'RefundIssued', 'OrderCancelled'].includes(eventType);
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as OrderPayload;
    
    try {
      // Idempotency check - if we already processed this event, skip
      const existingLedger = await db
        .select()
        .from(loyaltyLedger)
        .where(eq(loyaltyLedger.eventId, event.eventId))
        .limit(1);
      
      if (existingLedger.length > 0) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
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
          summary: 'No customer associated with order - no points action',
        };
      }

      const total = payload.order?.totals?.total || payload.order?.total || payload.total || payload.amount || 0;
      const orderId = payload.order?.orderId || payload.orderId || event.correlationId;

      // Get customer current loyalty points
      const customerResult = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

      if (customerResult.length === 0) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: 'Customer not found',
        };
      }

      const customer = customerResult[0];
      const previousBalance = customer.loyaltyPoints || 0;

      let pointsDelta = 0;
      let reason = 'earn';

      if (event.eventType === 'OrderCreated') {
        // Earn points: round down the total
        pointsDelta = Math.floor(total * POINTS_PER_UNIT);
        reason = 'earn';
      } else if (event.eventType === 'RefundIssued') {
        if (typeof payload.pointsToReverse === "number") {
          pointsDelta = -payload.pointsToReverse;
        } else {
          const orderTotal = payload.orderTotal ?? 0;
          pointsDelta =
            orderTotal > 0
              ? -Math.floor((total / orderTotal) * Math.floor(orderTotal * POINTS_PER_UNIT))
              : 0;
        }
        reason = 'reverse';
      } else if (event.eventType === 'OrderCancelled') {
        pointsDelta = -Math.floor(total * POINTS_PER_UNIT);
        reason = 'reverse';
      } else {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: `Event type ${event.eventType} does not affect loyalty points`,
        };
      }

      if (pointsDelta === 0) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: 'No points to award (total too low)',
        };
      }

      const newBalance = Math.max(0, previousBalance + pointsDelta);

      // Update customer loyalty points
      await db
        .update(customers)
        .set({
          loyaltyPoints: newBalance,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId));

      // Record in loyalty ledger
      await db.insert(loyaltyLedger).values({
        customerId,
        orderId,
        eventId: event.eventId,
        pointsDelta,
        reason,
        previousBalance,
        newBalance,
      });

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: `${reason === 'earn' ? 'Earned' : 'Reversed'} ${Math.abs(pointsDelta)} points for customer`,
        data: { customerId, pointsDelta, newBalance },
      };
    } catch (error) {
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'failed',
        summary: 'Loyalty points update failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
