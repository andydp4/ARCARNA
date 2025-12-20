/**
 * InvoiceWorker - Order Invoice Generation and Distribution
 * 
 * Handles the complete invoice lifecycle for order events:
 * 1. Create invoice record in database
 * 2. Generate professional PDF with Viger Assist branding
 * 3. Upload to Google Drive with public read access
 * 4. Store Drive link for customer access
 * 
 * Supported Events:
 * - OrderCreated: Primary trigger for invoice generation
 * - PaymentCaptured: Secondary trigger if invoice missing
 * 
 * Key Features:
 * - Idempotent processing via processed_events table
 * - Concurrent-safe with unique constraint handling
 * - Non-blocking PDF/Drive failures (invoice record always created)
 * - Customer details included from database
 * 
 * @module server/workers/invoiceWorker
 */

import { db } from "../db";
import { processedEvents, invoices, customers, orderItems, orders, products } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";
import { generateInvoicePdf } from "../services/pdfGenerator";
import { uploadPdfToDrive, createFolderIfNotExists } from "../services/googleDrive";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Order event payload structure.
 * Supports multiple formats from different event sources.
 */
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

/**
 * Customer data for invoice personalization.
 */
interface CustomerInfo {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
}

/**
 * Line item for PDF generation.
 */
interface InvoiceLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/**
 * Invoice totals breakdown.
 */
interface InvoiceTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Database order record type.
 */
interface OrderRecord {
  id: string;
  customerId: string | null;
  total: string | null;
  paymentMethod: string | null;
}

// ============================================================================
// Helper Functions - Data Retrieval
// ============================================================================

/**
 * Generates a unique invoice number in format: INV-YYYYMMDD-XXXX
 * 
 * @returns Formatted invoice number string
 */
function generateInvoiceNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INV-${dateStr}-${randomSuffix}`;
}

/**
 * Calculates due date as 30 days from now.
 * 
 * @returns Due date in YYYY-MM-DD format
 */
function calculateDueDate(): string {
  const now = new Date();
  const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return dueDate.toISOString().slice(0, 10);
}

/**
 * Fetches customer information for invoice personalization.
 * 
 * @param customerId - Customer UUID, if available
 * @returns Customer info or empty object
 */
async function fetchCustomerInfo(customerId: string | null | undefined): Promise<CustomerInfo> {
  if (!customerId) return {};

  const result = await db
    .select({
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (result.length === 0) return {};

  return {
    name: result[0].name,
    email: result[0].email || undefined,
    phone: result[0].phone || undefined,
    address: result[0].address || undefined,
  };
}

/**
 * Fetches order line items with product names for invoice detail.
 * 
 * @param orderId - Order UUID
 * @returns Array of formatted line items
 */
async function fetchOrderItems(orderId: string): Promise<InvoiceLineItem[]> {
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

  return items.map((item) => ({
    name: item.productName || 'Unknown Product',
    quantity: item.quantity,
    unitPrice: parseFloat(item.unitPrice || '0'),
    total: parseFloat(item.totalPrice || '0'),
  }));
}

/**
 * Verifies order exists in database.
 * Returns null if not found (synthetic/test event).
 * 
 * @param orderId - Order UUID to verify
 * @returns Order record or null
 */
async function fetchOrder(orderId: string): Promise<OrderRecord | null> {
  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// ============================================================================
// Helper Functions - Invoice Persistence
// ============================================================================

/**
 * Creates invoice record in database with conflict handling.
 * 
 * Uses try-catch to handle race conditions where multiple workers
 * attempt to create the same invoice concurrently.
 * 
 * @param invoiceData - Invoice fields to persist
 * @returns Created invoice or null if duplicate
 */
async function createInvoiceRecord(invoiceData: {
  orderId: string;
  customerId: string | null;
  invoiceNumber: string;
  subtotal: number;
  tax: number;
  total: number;
  dueDate: string;
}): Promise<{ id: string; invoiceNumber: string } | null> {
  try {
    const result = await db
      .insert(invoices)
      .values({
        orderId: invoiceData.orderId,
        customerId: invoiceData.customerId,
        invoiceNumber: invoiceData.invoiceNumber,
        subtotal: String(invoiceData.subtotal),
        tax: String(invoiceData.tax),
        total: String(invoiceData.total),
        status: 'sent',
        dueDate: invoiceData.dueDate,
      })
      .returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });

    return result[0];
  } catch (error: any) {
    // Handle unique constraint violation (concurrent creation)
    if (error.code === '23505') {
      console.log(`[InvoiceWorker] Invoice already created by concurrent worker`);
      return null;
    }
    throw error;
  }
}

/**
 * Updates invoice record with Google Drive file info.
 * 
 * @param invoiceId - Invoice UUID
 * @param driveInfo - Drive file ID and link
 */
async function updateInvoiceWithDriveInfo(
  invoiceId: string,
  driveInfo: { fileId: string; link: string }
): Promise<void> {
  await db
    .update(invoices)
    .set({
      googleDriveFileId: driveInfo.fileId,
      googleDriveLink: driveInfo.link,
    })
    .where(eq(invoices.id, invoiceId));
}

// ============================================================================
// Helper Functions - PDF & Drive
// ============================================================================

/**
 * Generates PDF and uploads to Google Drive.
 * 
 * This is a non-critical operation - failures are logged but don't
 * fail the overall invoice creation.
 * 
 * @param invoiceNumber - Invoice number for filename
 * @param totals - Invoice totals for PDF content
 * @param customerInfo - Customer details for PDF header
 * @param items - Line items for PDF detail section
 * @param paymentMethod - Payment method for PDF footer
 * @returns Drive info or null on failure
 */
async function generateAndUploadPdf(
  invoiceNumber: string,
  totals: InvoiceTotals,
  customerInfo: CustomerInfo,
  items: InvoiceLineItem[],
  paymentMethod?: string
): Promise<{ fileId: string; link: string } | null> {
  try {
    const now = new Date();
    const dueDate = calculateDueDate();

    // Use provided items or create single-line fallback
    const pdfItems = items.length > 0 ? items : [{
      name: 'Order Total',
      quantity: 1,
      unitPrice: totals.total,
      total: totals.total,
    }];

    // Generate PDF with Viger Assist branding
    const pdfBuffer = await generateInvoicePdf({
      invoiceNumber,
      createdAt: now.toISOString(),
      dueDate,
      customerName: customerInfo.name,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone,
      items: pdfItems,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      status: 'sent',
      paymentMethod,
    });

    console.log(`[InvoiceWorker] Generated PDF for ${invoiceNumber}, size: ${pdfBuffer.length} bytes`);

    // Upload to Google Drive
    const folderId = await createFolderIfNotExists('Midnight EPOS Invoices');
    const uploadResult = await uploadPdfToDrive(pdfBuffer, `${invoiceNumber}.pdf`, folderId);

    console.log(`[InvoiceWorker] Uploaded ${invoiceNumber} to Drive: ${uploadResult.webViewLink}`);

    return {
      fileId: uploadResult.fileId,
      link: uploadResult.webViewLink,
    };
  } catch (error) {
    console.error(`[InvoiceWorker] PDF generation/upload failed for ${invoiceNumber}:`, error);
    return null;
  }
}

// ============================================================================
// Helper Functions - Idempotency
// ============================================================================

/**
 * Checks if this event has already been processed by this worker.
 * 
 * @param eventId - Event UUID
 * @param workerName - Worker identifier
 * @returns true if already processed
 */
async function isEventProcessed(eventId: string, workerName: string): Promise<boolean> {
  const result = await db
    .select()
    .from(processedEvents)
    .where(
      and(
        eq(processedEvents.eventId, eventId),
        eq(processedEvents.workerName, workerName)
      )
    )
    .limit(1);

  return result.length > 0;
}

/**
 * Checks if invoice already exists for order.
 * 
 * @param orderId - Order UUID
 * @returns Existing invoice ID or null
 */
async function getExistingInvoice(orderId: string): Promise<string | null> {
  const result = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .limit(1);

  return result.length > 0 ? result[0].id : null;
}

// ============================================================================
// InvoiceWorker Implementation
// ============================================================================

export class InvoiceWorker implements IWorker {
  name: WorkerName = 'InvoiceWorker';

  /**
   * Determines if this worker handles the given event type.
   */
  supports(eventType: EventType): boolean {
    return ['OrderCreated', 'PaymentCaptured'].includes(eventType);
  }

  /**
   * Main event handler for invoice generation.
   * 
   * Processing Flow:
   * 1. Check idempotency (skip if already processed)
   * 2. Verify order exists in database
   * 3. Create invoice record
   * 4. Generate PDF and upload to Drive (non-blocking)
   * 5. Update invoice with Drive link
   * 
   * @param event - Domain event envelope
   * @returns Worker result with status and metadata
   */
  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as OrderPayload;

    try {
      // Step 1: Idempotency check
      if (await isEventProcessed(event.eventId, this.name)) {
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'already_processed',
          summary: 'Already processed (idempotent skip)',
        };
      }

      // Step 2: Extract order identifiers
      const orderId = payload.order?.orderId || payload.orderId || event.correlationId;
      const existingInvoiceId = await getExistingInvoice(orderId);
      
      if (existingInvoiceId) {
        console.log(`[InvoiceWorker] Invoice already exists for order ${orderId}`);
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: `Invoice already exists for order ${orderId}`,
          data: { orderId, invoiceId: existingInvoiceId },
        };
      }

      // Step 3: Verify order exists in database
      const order = await fetchOrder(orderId);
      if (!order) {
        console.log(`[InvoiceWorker] Order ${orderId} not found - skipping (synthetic event)`);
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: `Order ${orderId} not found - skipped (synthetic event)`,
          data: { orderId, skipped: true },
        };
      }

      // Step 4: Calculate totals from payload or database
      const totals = this.extractTotals(payload, order);
      const customerId = payload.order?.customerId || payload.customerId || order.customerId;

      // Step 5: Create invoice record
      const invoiceNumber = generateInvoiceNumber();
      const dueDate = calculateDueDate();

      const newInvoice = await createInvoiceRecord({
        orderId,
        customerId: customerId || null,
        invoiceNumber,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        dueDate,
      });

      if (!newInvoice) {
        // Concurrent worker created invoice - fetch and return
        const existing = await getExistingInvoice(orderId);
        return {
          worker: this.name,
          eventId: event.eventId,
          correlationId: event.correlationId,
          status: 'success',
          summary: `Invoice created by concurrent worker for ${orderId}`,
          data: { orderId, invoiceId: existing },
        };
      }

      console.log(`[InvoiceWorker] Created invoice ${invoiceNumber} for order ${orderId}`);

      // Step 6: Generate PDF and upload (non-blocking)
      const customerInfo = await fetchCustomerInfo(customerId);
      const items = await fetchOrderItems(orderId);
      
      const driveResult = await generateAndUploadPdf(
        invoiceNumber,
        totals,
        customerInfo,
        items,
        order.paymentMethod || undefined
      );

      // Step 7: Update invoice with Drive info
      if (driveResult) {
        await updateInvoiceWithDriveInfo(newInvoice.id, driveResult);
      }

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: `Invoice ${invoiceNumber} created${driveResult ? ' (PDF uploaded to Drive)' : ''}`,
        data: {
          orderId,
          invoiceId: newInvoice.id,
          invoiceNumber,
          driveFileId: driveResult?.fileId,
          driveLink: driveResult?.link,
        },
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

  /**
   * Extracts invoice totals from payload or database order.
   * 
   * Priority: payload.order.total > payload.order.totals > database
   * 
   * @param payload - Event payload with optional totals
   * @param order - Database order record
   * @returns Normalized totals object
   */
  private extractTotals(payload: OrderPayload, order: OrderRecord): InvoiceTotals {
    const payloadTotals = payload.order?.totals;
    const payloadTotal = payload.order?.total ?? payloadTotals?.total ?? payload.total;

    // Use payload values if available and non-zero
    if (payloadTotal && payloadTotal > 0) {
      return {
        subtotal: payloadTotals?.subtotal ?? payloadTotal,
        tax: payloadTotals?.tax ?? 0,
        total: payloadTotal,
      };
    }

    // Fall back to database order total
    const dbTotal = parseFloat(order.total || '0');
    return {
      subtotal: dbTotal,
      tax: 0,
      total: dbTotal,
    };
  }
}
