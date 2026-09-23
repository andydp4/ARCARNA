/**
 * Loyalty Worker
 * 
 * Handles loyalty point calculations:
 * - OrderCreated: earn points based on total
 * - RefundIssued/OrderCancelled: reverse points
 */

import { db } from "../db";
import { customers, loyaltyLedger } from "../../shared/schema";
import { and, eq } from "drizzle-orm";
import type { IWorker } from "./index";
import { pointsEarnedFor } from "../../shared/pricing/priceOrder";
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

      let pointsDelta = 0;
      let reason = 'earn';

      if (event.eventType === 'OrderCreated') {
        // Earned on what was paid — the order total is already net of every
        // discount and of any points spent (v1.2 Phase 1B). Same rule the
        // till shows the customer, from shared/pricing/priceOrder.ts.
        pointsDelta = pointsEarnedFor(total);
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

      // Apply under a lock on the customer row, re-checking the ledger for
      // this event inside it. The check at the top of this method is only a
      // fast path: two runs of the same event (or two different events for
      // the same customer) could both pass it and then both write a balance
      // read earlier — double-crediting, or losing one of the updates.
      const applied = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ loyaltyPoints: customers.loyaltyPoints })
          .from(customers)
          .where(eq(customers.id, customerId))
          .for("update")
          .limit(1);
        if (!locked) return null;

        const [already] = await tx
          .select({ id: loyaltyLedger.ledgerId })
          .from(loyaltyLedger)
          .where(and(eq(loyaltyLedger.eventId, event.eventId), eq(loyaltyLedger.customerId, customerId)))
          .limit(1);
        if (already) return null;

        const lockedBalance = locked.loyaltyPoints || 0;
        const balanceAfter = Math.max(0, lockedBalance + pointsDelta);
        await tx
          .update(customers)
          .set({ loyaltyPoints: balanceAfter, updatedAt: new Date() })
          .where(eq(customers.id, customerId));
        await tx.insert(loyaltyLedger).values({
          customerId,
          orderId,
          eventId: event.eventId,
          pointsDelta,
          reason,
          previousBalance: lockedBalance,
          newBalance: balanceAfter,
        });
        return balanceAfter;
      });

      if (applied === null) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: 'Already processed (idempotent skip)',
        };
      }
      const newBalance = applied;

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
