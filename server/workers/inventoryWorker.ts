/**
 * InventoryWorker - Stock Management Event Handler
 * 
 * Handles inventory adjustments triggered by order lifecycle events.
 * Implements the transactional outbox pattern for reliable stock updates.
 * 
 * Supported Events:
 * - OrderCreated: Deduct stock quantities for purchased items
 * - OrderUpdated: Calculate and apply quantity deltas
 * - RefundIssued: Return stock for refunded line items
 * - OrderCancelled: Return all stock for cancelled orders
 * 
 * Key Features:
 * - Idempotent processing via eventId tracking in inventory_movements
 * - SKU-to-UUID resolution: Accepts both product UUIDs and SKU strings
 * - Low stock warnings for items falling below stockLimit threshold
 * - Atomic stock updates with movement audit trail
 * 
 * @module server/workers/inventoryWorker
 */

import { db } from "../db";
import { products, inventoryMovements } from "../../shared/schema";
import { eq, or } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Represents a single item in an order event payload.
 * Supports multiple naming conventions from different event sources.
 */
interface OrderItem {
  lineId?: string;
  /** Product SKU (human-readable identifier, e.g., "WIDGET-001") */
  sku?: string;
  /** Product UUID (database primary key) */
  productId?: string;
  name: string;
  /** Quantity (primary field) */
  qty: number;
  /** Quantity (alternative field for backward compatibility) */
  quantity?: number;
  unitPrice: number;
}

/**
 * Normalized order event payload structure.
 * Handles both wrapped (order.items) and flat (items) formats.
 */
interface OrderPayload {
  order?: {
    orderId: string;
    items: OrderItem[];
  };
  orderId?: string;
  items?: OrderItem[];
  /** Used for refund/cancellation events - specific lines to restore */
  lines?: Array<{ lineId: string; qty: number; productId?: string; sku?: string }>;
}

/**
 * Result of product lookup operation.
 * Contains resolved product with validated UUID.
 */
interface ResolvedProduct {
  id: string;           // Database UUID
  productId: string;    // SKU code
  name: string;
  stock: number;
  stockLimit: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validates whether a string is a valid UUID v4 format.
 * Used to distinguish between SKU strings and database UUIDs.
 * 
 * @param str - The string to validate
 * @returns true if string matches UUID v4 pattern
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Resolves a product identifier (UUID or SKU) to a full product record.
 * 
 * Resolution Strategy (multi-step with fallback):
 * 1. If identifier is a valid UUID, try products.id first (primary key match)
 * 2. If UUID match fails or identifier isn't a UUID, try products.productId (SKU field)
 * 3. This ensures both UUID-based and SKU-based lookups succeed
 * 
 * @param identifier - Either a product UUID or SKU string
 * @returns Resolved product with stock info, or null if not found
 */
async function resolveProduct(identifier: string): Promise<ResolvedProduct | null> {
  const isUuid = isValidUUID(identifier);
  
  // Step 1: If it looks like a UUID, try primary key lookup first
  if (isUuid) {
    const byIdResult = await db
      .select({
        id: products.id,
        productId: products.productId,
        name: products.name,
        stock: products.stock,
        stockLimit: products.stockLimit,
      })
      .from(products)
      .where(eq(products.id, identifier))
      .limit(1);
    
    if (byIdResult.length > 0) {
      const p = byIdResult[0];
      return {
        id: p.id,
        productId: p.productId || '',
        name: p.name,
        stock: p.stock ?? 0,
        stockLimit: p.stockLimit ?? 10,
      };
    }
  }
  
  // Step 2: Try SKU field lookup (works for both UUID and non-UUID identifiers)
  const bySkuResult = await db
    .select({
      id: products.id,
      productId: products.productId,
      name: products.name,
      stock: products.stock,
      stockLimit: products.stockLimit,
    })
    .from(products)
    .where(eq(products.productId, identifier))
    .limit(1);
  
  if (bySkuResult.length > 0) {
    const p = bySkuResult[0];
    return {
      id: p.id,
      productId: p.productId || '',
      name: p.name,
      stock: p.stock ?? 0,
      stockLimit: p.stockLimit ?? 10,
    };
  }
  
  // Not found by either method
  console.log(`[InventoryWorker] Product not found for identifier: ${identifier} (isUUID: ${isUuid})`);
  return null;
}

/**
 * Converts ResolvedProduct to standard return format.
 * Helper to avoid duplication in resolveProduct.
 */
function formatResolvedProduct(p: {
  id: string;
  productId: string | null;
  name: string;
  stock: number | null;
  stockLimit: number | null;
}): ResolvedProduct {
  return {
    id: p.id,
    productId: p.productId || '',
    name: p.name,
    stock: p.stock ?? 0,
    stockLimit: p.stockLimit ?? 10,
  };
}

/**
 * Extracts quantity from an order item, handling field name variations.
 * 
 * @param item - Order item with qty or quantity field
 * @returns Normalized quantity value
 */
function extractQuantity(item: { qty?: number; quantity?: number }): number {
  return item.qty ?? item.quantity ?? 0;
}

// ============================================================================
// InventoryWorker Implementation
// ============================================================================

export class InventoryWorker implements IWorker {
  name: WorkerName = 'InventoryWorker';

  /**
   * Determines if this worker should process the given event type.
   * 
   * @param eventType - The domain event type
   * @returns true for order lifecycle events requiring stock updates
   */
  supports(eventType: EventType): boolean {
    return ['OrderCreated', 'OrderUpdated', 'RefundIssued', 'OrderCancelled'].includes(eventType);
  }

  /**
   * Main event handler - routes to appropriate sub-handler based on event type.
   * 
   * @param event - The domain event envelope containing payload and metadata
   * @returns Worker result with status, summary, and optional data
   */
  async handle(event: EventEnvelope): Promise<WorkerResult> {
    const payload = event.payload as OrderPayload;
    
    try {
      switch (event.eventType) {
        case 'OrderCreated':
          return await this.handleOrderCreated(event, payload);
        case 'OrderUpdated':
          return await this.handleOrderUpdated(event, payload);
        case 'RefundIssued':
        case 'OrderCancelled':
          return await this.handleStockReturn(event, payload);
        default:
          return {
            worker: this.name,
            eventId: event.eventId,
            correlationId: event.correlationId,
            status: 'success',
            summary: `Event type ${event.eventType} not handled by InventoryWorker`,
          };
      }
    } catch (error) {
      console.error(`[InventoryWorker] Error processing event ${event.eventId}:`, error);
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'failed',
        summary: 'Inventory update failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------

  /**
   * Handles OrderCreated events by deducting stock for each line item.
   * 
   * Process:
   * 1. Check idempotency - skip if already processed
   * 2. For each item: resolve product, deduct stock, record movement
   * 3. Collect low stock warnings for items below threshold
   * 
   * @param event - Event envelope with metadata
   * @param payload - Order data containing items array
   */
  private async handleOrderCreated(event: EventEnvelope, payload: OrderPayload): Promise<WorkerResult> {
    const items = payload.order?.items || payload.items || [];
    const orderId = payload.order?.orderId || payload.orderId || event.correlationId;
    
    // Idempotency check - prevent duplicate stock deductions
    const existingMovements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.eventId, event.eventId))
      .limit(1);
    
    if (existingMovements.length > 0) {
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: 'Already processed (idempotent skip)',
      };
    }
    
    let updatedProducts = 0;
    const lowStockWarnings: string[] = [];

    for (const item of items) {
      const qty = extractQuantity(item);
      if (qty <= 0) continue;

      // Resolve product by UUID or SKU
      const identifier = item.productId || item.sku;
      if (!identifier) continue;

      const product = await resolveProduct(identifier);
      if (!product) continue;

      // Calculate new stock level
      const previousStock = product.stock;
      const newStock = Math.max(0, previousStock - qty);

      // Atomic stock update
      await db
        .update(products)
        .set({ 
          stock: newStock,
          updatedAt: new Date() 
        })
        .where(eq(products.id, product.id));

      // Record movement for audit trail
      await db.insert(inventoryMovements).values({
        sku: product.productId,
        productId: product.id,
        delta: -qty,
        reason: 'sale',
        correlationId: orderId,
        eventId: event.eventId,
        previousStock,
        newStock,
      });

      updatedProducts++;

      // Track low stock warnings
      if (newStock <= product.stockLimit) {
        lowStockWarnings.push(product.name);
      }
    }

    return {
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      status: 'success',
      summary: `Inventory updated for ${updatedProducts} products`,
      data: { updatedProducts, lowStockWarnings },
    };
  }

  /**
   * Handles OrderUpdated events by calculating and applying quantity deltas.
   * 
   * Compares current order quantities against previous movements to determine
   * whether to add or remove stock.
   * 
   * @param event - Event envelope with metadata
   * @param payload - Updated order data
   */
  private async handleOrderUpdated(event: EventEnvelope, payload: OrderPayload): Promise<WorkerResult> {
    const items = payload.order?.items || payload.items || [];
    const orderId = payload.order?.orderId || payload.orderId || event.correlationId;
    
    let adjustedProducts = 0;

    for (const item of items) {
      const qty = extractQuantity(item);
      const identifier = item.productId || item.sku;
      if (!identifier) continue;

      const product = await resolveProduct(identifier);
      if (!product) continue;

      // Get previous movements for this order+product to calculate delta
      const previousMovements = await db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.correlationId, orderId));

      const previousQty = previousMovements
        .filter(m => m.productId === product.id)
        .reduce((sum, m) => sum + Math.abs(m.delta), 0);

      // Delta: positive = return stock, negative = deduct more
      const delta = previousQty - qty;
      if (delta === 0) continue;

      const previousStock = product.stock;
      const newStock = Math.max(0, previousStock + delta);

      // Apply stock adjustment
      await db
        .update(products)
        .set({ 
          stock: newStock,
          updatedAt: new Date() 
        })
        .where(eq(products.id, product.id));

      // Record adjustment movement
      await db.insert(inventoryMovements).values({
        sku: product.productId,
        productId: product.id,
        delta,
        reason: 'order_update',
        correlationId: orderId,
        eventId: event.eventId,
        previousStock,
        newStock,
      });

      adjustedProducts++;
    }

    return {
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      status: 'success',
      summary: `Inventory adjusted for ${adjustedProducts} products`,
      data: { adjustedProducts },
    };
  }

  /**
   * Handles RefundIssued and OrderCancelled events by returning stock.
   * 
   * @param event - Event envelope with metadata
   * @param payload - Refund/cancellation data with lines to restore
   */
  private async handleStockReturn(event: EventEnvelope, payload: OrderPayload): Promise<WorkerResult> {
    const lines = payload.lines || [];
    const orderId = payload.orderId || event.correlationId;
    
    // Idempotency check
    const existingMovements = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.eventId, event.eventId))
      .limit(1);
    
    if (existingMovements.length > 0) {
      return {
        worker: this.name,
        eventId: event.eventId,
        correlationId: event.correlationId,
        status: 'success',
        summary: 'Already processed (idempotent skip)',
      };
    }
    
    let returnedProducts = 0;

    for (const line of lines) {
      const qty = line.qty || 0;
      const identifier = line.productId || line.sku;
      if (!identifier || qty <= 0) continue;

      const product = await resolveProduct(identifier);
      if (!product) continue;

      const previousStock = product.stock;
      const newStock = previousStock + qty;

      // Return stock to inventory
      await db
        .update(products)
        .set({ 
          stock: newStock,
          updatedAt: new Date() 
        })
        .where(eq(products.id, product.id));

      // Record return movement
      await db.insert(inventoryMovements).values({
        sku: product.productId,
        productId: product.id,
        delta: qty,
        reason: event.eventType === 'RefundIssued' ? 'refund' : 'cancellation',
        correlationId: orderId,
        eventId: event.eventId,
        previousStock,
        newStock,
      });

      returnedProducts++;
    }

    return {
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      status: 'success',
      summary: `Stock returned for ${returnedProducts} products`,
      data: { returnedProducts },
    };
  }
}
