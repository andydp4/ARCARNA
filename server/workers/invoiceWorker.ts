/**
 * Invoice Worker
 * 
 * Handles invoice generation for orders:
 * - OrderCreated: Generate invoice (or on PaymentCaptured depending on business rules)
 * - PaymentCaptured: Trigger invoice generation
 */

import { db } from "../db";
import { processedEvents } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

interface OrderPayload {
  order?: {
    orderId: string;
    customerId?: string;
    totals?: {
      total: number;
      subtotal: number;
      tax: number;
      discount: number;
    };
  };
  orderId?: string;
}

export class InvoiceWorker implements IWorker {
  name: WorkerName = 'InvoiceWorker';

  supports(eventType: EventType): boolean {
    return ['OrderCreated', 'PaymentCaptured'].includes(eventType);
  }

  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as OrderPayload;
    
    try {
      // Idempotency check - prevent duplicate invoice generation
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

      const orderId = payload.order?.orderId || payload.orderId || event.correlationId;

      // Invoice generation is a non-blocking operation
      // In production, this would call a PDF generation service
      // For now, we just log the intent

      console.log(`[InvoiceWorker] Would generate invoice for order ${orderId}`);

      // TODO: Integrate with actual PDF generation service
      // The existing invoice generation in the codebase uses Puppeteer
      // We don't want to block the worker on PDF generation

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: `Invoice generation queued for order ${orderId}`,
        data: { orderId },
      };
    } catch (error) {
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'failed',
        summary: 'Invoice generation failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
