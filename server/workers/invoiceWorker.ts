/**
 * Invoice Worker
 * 
 * Handles invoice generation for orders:
 * - OrderCreated: Generate invoice record in database, create PDF, upload to Google Drive
 * - PaymentCaptured: Trigger invoice generation if not already created
 */

import { db } from "../db";
import { processedEvents, invoices, customers, orderItems } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";
import { generateInvoicePdf } from "../services/pdfGenerator";
import { uploadPdfToDrive, createFolderIfNotExists } from "../services/googleDrive";

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

      // Generate PDF and upload to Google Drive
      let driveFileId: string | null = null;
      let driveLink: string | null = null;
      
      try {
        // Get customer details if available
        let customerData: { name?: string; email?: string; phone?: string } = {};
        if (customerId) {
          const customerResult = await db
            .select()
            .from(customers)
            .where(eq(customers.id, customerId))
            .limit(1);
          if (customerResult.length > 0) {
            customerData = {
              name: customerResult[0].name,
              email: customerResult[0].email || undefined,
              phone: customerResult[0].phone || undefined,
            };
          }
        }

        // Get order items for the invoice with product names
        const { products } = await import('../../shared/schema');
        const items = await db
          .select({
            quantity: orderItems.quantity,
            unitPrice: orderItems.unitPrice,
            totalPrice: orderItems.totalPrice,
            productName: products.name,
          })
          .from(orderItems)
          .leftJoin(products, eq(orderItems.productId, products.id))
          .where(eq(orderItems.orderId, orderId));

        const invoiceItems = items.map((item) => ({
          name: item.productName || 'Unknown Product',
          quantity: item.quantity,
          unitPrice: parseFloat(item.unitPrice || '0'),
          total: parseFloat(item.totalPrice || '0'),
        }));

        // Generate PDF
        const pdfBuffer = await generateInvoicePdf({
          invoiceNumber,
          createdAt: now.toISOString(),
          dueDate,
          customerName: customerData.name,
          customerEmail: customerData.email,
          customerPhone: customerData.phone,
          items: invoiceItems.length > 0 ? invoiceItems : [{
            name: 'Order Total',
            quantity: 1,
            unitPrice: total || 0,
            total: total || 0,
          }],
          subtotal: subtotal || 0,
          tax: tax || 0,
          total: total || 0,
          status: 'sent',
          paymentMethod: dbOrder.paymentMethod || undefined,
        });

        console.log(`[InvoiceWorker] Generated PDF for invoice ${invoiceNumber}, size: ${pdfBuffer.length} bytes`);

        // Upload to Google Drive
        const folderId = await createFolderIfNotExists('Midnight EPOS Invoices');
        const uploadResult = await uploadPdfToDrive(pdfBuffer, `${invoiceNumber}.pdf`, folderId);
        
        driveFileId = uploadResult.fileId;
        driveLink = uploadResult.webViewLink;

        console.log(`[InvoiceWorker] Uploaded invoice ${invoiceNumber} to Google Drive: ${driveLink}`);

        // Update invoice with Google Drive info
        await db
          .update(invoices)
          .set({
            googleDriveFileId: driveFileId,
            googleDriveLink: driveLink,
          })
          .where(eq(invoices.id, newInvoice.id));
      } catch (pdfError) {
        // PDF/Drive upload is non-critical - log error but don't fail the worker
        console.error(`[InvoiceWorker] PDF generation/upload failed for ${invoiceNumber}:`, pdfError);
      }

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: `Invoice ${invoiceNumber} created for order ${orderId}${driveLink ? ' (PDF uploaded to Drive)' : ''}`,
        data: { orderId, invoiceId: newInvoice.id, invoiceNumber, driveFileId, driveLink },
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
