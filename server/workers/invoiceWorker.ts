/**
 * InvoiceWorker - Order Invoice Record Creation
 *
 * Creates the invoice DB record for an order. PDFs are generated on-demand
 * when viewed/printed/downloaded (see server/routes/invoices.ts) rather than
 * eagerly rendered and uploaded to external storage here — Neon already
 * holds everything an invoice needs (order lines, totals, customer info).
 *
 * Supported Events:
 * - OrderCreated: Primary trigger for invoice generation
 * - PaymentCaptured: Secondary trigger if invoice missing
 *
 * Key Features:
 * - Idempotent processing via processed_events table
 * - Concurrent-safe with unique constraint handling
 *
 * @module server/workers/invoiceWorker
 */

import { db } from "../db";
import { processedEvents, invoices, orders, organizations } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

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
  orgId: string | null;
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
  orgId: string | null;
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
        orgId: invoiceData.orgId,
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
      const totals = await this.extractTotals(payload, order);
      const customerId = payload.order?.customerId || payload.customerId || order.customerId;

      // Step 5: Create invoice record
      const invoiceNumber = generateInvoiceNumber();
      const dueDate = calculateDueDate();

      const newInvoice = await createInvoiceRecord({
        orgId: order.orgId,
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

      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: `Invoice ${invoiceNumber} created`,
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

  /**
   * Extracts invoice totals from payload or database order.
   *
   * Priority: payload.order.total > payload.order.totals > database
   *
   * @param payload - Event payload with optional totals
   * @param order - Database order record
   * @returns Normalized totals object
   */
  private async extractTotals(payload: OrderPayload, order: OrderRecord): Promise<InvoiceTotals> {
    const payloadTotals = payload.order?.totals;
    const payloadTotal = payload.order?.total ?? payloadTotals?.total ?? payload.total;

    // Use payload values if available and non-zero
    if (payloadTotal && payloadTotal > 0) {
      if (payloadTotals?.subtotal != null && payloadTotals?.tax != null) {
        return { subtotal: payloadTotals.subtotal, tax: payloadTotals.tax, total: payloadTotal };
      }
      // The order-created event doesn't carry a tax breakdown; the order total is
      // tax-inclusive, so split it using the org's configured tax rate rather than
      // reporting a misleading 0 VAT on every invoice.
      return { ...this.splitTaxInclusiveTotal(payloadTotal, await this.fetchOrgTaxRate(order.orgId)), total: payloadTotal };
    }

    // Fall back to database order total
    const dbTotal = parseFloat(order.total || '0');
    return { ...this.splitTaxInclusiveTotal(dbTotal, await this.fetchOrgTaxRate(order.orgId)), total: dbTotal };
  }

  private splitTaxInclusiveTotal(total: number, taxRate: number): { subtotal: number; tax: number } {
    const subtotal = total / (1 + taxRate);
    return { subtotal, tax: total - subtotal };
  }

  private async fetchOrgTaxRate(orgId: string | null): Promise<number> {
    if (!orgId) return 0.20;
    const [org] = await db
      .select({ defaultTaxRate: organizations.defaultTaxRate })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return org?.defaultTaxRate != null ? parseFloat(String(org.defaultTaxRate)) / 100 : 0.20;
  }
}
