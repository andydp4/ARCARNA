/**
 * Invoice Worker
 * 
 * Handles invoice generation for orders:
 * - OrderCreated: Generate invoice record in database
 * - PaymentCaptured: Trigger invoice generation if not already created
 */

import { db } from "../db";
import { processedEvents, invoices } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

interface OrderPayload {
  order?: {
    orderId: string;
    customerId?: string;
    total?: number;
    totals?: {
      total: number;
      subtotal: number;
      tax: number;
      discount: number;
    };
    items?: Array<{
      productId: string;
      qty?: number;
      quantity?: number;
      unitPrice: number;
      lineTotal: number;
    }>;
  };
  orderId?: string;
  customerId?: string;
  total?: number;
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
      let customerId = payload.order?.customerId || payload.customerId;
      
      // Extract total - check order.total first (from event payload), then totals.total, then payload.total
      let orderTotal = payload.order?.total;
      const totals = payload.order?.totals;
      let total = orderTotal ?? totals?.total ?? payload.total;
      let subtotal = totals?.subtotal ?? total;
      let tax = totals?.tax ?? 0;
      
      console.log(`[InvoiceWorker] Processing invoice for order ${orderId} with payload total: ${total}`);

      // Generate invoice number: INV-YYYYMMDD-XXXX
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;

      // Check if invoice already exists for this order
      const existingInvoice = await db
        .select()
        .from(invoices)
        .where(eq(invoices.orderId, orderId))
        .limit(1);

      if (existingInvoice.length > 0) {
        console.log(`[InvoiceWorker] Invoice already exists for order ${orderId}`);
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: `Invoice already exists for order ${orderId}`,
          data: { orderId, invoiceId: existingInvoice[0].id },
        };
      }

      // Check if the order exists in the database (FK constraint protection)
      const { orders } = await import('../../shared/schema');
      const existingOrder = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

      if (existingOrder.length === 0) {
        console.log(`[InvoiceWorker] Order ${orderId} not found in database, skipping invoice creation (test event)`);
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: `Order ${orderId} not found - skipped invoice (synthetic event)`,
          data: { orderId, skipped: true },
        };
      }

      // If total is missing or 0 from payload, use the database order total
      const dbOrder = existingOrder[0];
      if (total === undefined || total === null || total === 0) {
        total = parseFloat(dbOrder.total || '0');
        subtotal = total;
        console.log(`[InvoiceWorker] Using database order total: ${total}`);
      }
      if (!customerId && dbOrder.customerId) {
        customerId = dbOrder.customerId;
      }

      // Create invoice using numeric values with upsert to prevent duplicates
      // This handles the race condition where multiple workers try to create invoices concurrently
      const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      
      // Use a try-catch for unique constraint violation on invoice_number
      let newInvoice;
      try {
        const result = await db
          .insert(invoices)
          .values({
            orderId,
            customerId: customerId || null,
            invoiceNumber,
            subtotal: String(subtotal),
            tax: String(tax),
            total: String(total),
            status: 'sent',
            dueDate,
          })
          .returning();
        newInvoice = result[0];
      } catch (insertError: any) {
        // If unique constraint violation, invoice was created by another worker
        if (insertError.code === '23505') { // PostgreSQL unique violation
          console.log(`[InvoiceWorker] Invoice already created by another worker for order ${orderId}`);
          const existing = await db.select().from(invoices).where(eq(invoices.orderId, orderId)).limit(1);
          return {
            worker: this.name,
            eventId: event.eventId,
            correlationId: event.correlationId,
            status: 'success',
            summary: `Invoice already created for order ${orderId}`,
            data: { orderId, invoiceId: existing[0]?.id },
          };
        }
        throw insertError;
      }

      console.log(`[InvoiceWorker] Created invoice ${invoiceNumber} for order ${orderId}`);

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: `Invoice ${invoiceNumber} created for order ${orderId}`,
        data: { orderId, invoiceId: newInvoice.id, invoiceNumber },
      };
    } catch (error) {
      console.error('[InvoiceWorker] Error:', error);
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
