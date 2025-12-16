/**
 * Inventory Worker
 * 
 * Handles stock adjustments for order events:
 * - OrderCreated: subtract quantities from inventory
 * - OrderUpdated: calculate delta and adjust
 * - RefundIssued/OrderCancelled: add stock back
 */

import { db } from "../db";
import { products, inventoryMovements } from "../../shared/schema";
import { eq, sql } from "drizzle-orm";
import type { IWorker } from "./index";
import type { EventEnvelope, EventType, WorkerName, WorkerResult } from "../../shared/schema";

interface OrderItem {
  lineId?: string;
  sku?: string;
  productId?: string;
  name: string;
  qty: number;
  quantity?: number;
  unitPrice: number;
}

interface OrderPayload {
  order?: {
    orderId: string;
    items: OrderItem[];
  };
  orderId?: string;
  items?: OrderItem[];
  lines?: Array<{ lineId: string; qty: number; productId?: string }>;
}

export class InventoryWorker implements IWorker {
  name: WorkerName = 'InventoryWorker';

  supports(eventType: EventType): boolean {
    return ['OrderCreated', 'OrderUpdated', 'RefundIssued', 'OrderCancelled'].includes(eventType);
  }

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

  private async handleOrderCreated(event: EventEnvelope, payload: OrderPayload): Promise<WorkerResult> {
    const items = payload.order?.items || payload.items || [];
    const orderId = payload.order?.orderId || payload.orderId || event.correlationId;
    
    // Idempotency check - if we already processed this event, skip
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
    
    let updatedSkus = 0;
    const lowStockWarnings: string[] = [];

    for (const item of items) {
      const qty = item.qty || item.quantity || 0;
      if (qty <= 0) continue;

      const productId = item.productId || item.sku;
      if (!productId) continue;

      // Find product and update stock
      const productResult = await db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);

      if (productResult.length === 0) continue;

      const product = productResult[0];
      const previousStock = product.stock || 0;
      const newStock = Math.max(0, previousStock - qty);

      // Update stock
      await db
        .update(products)
        .set({ 
          stock: newStock,
          updatedAt: new Date() 
        })
        .where(eq(products.id, productId));

      // Record movement
      await db.insert(inventoryMovements).values({
        sku: product.productId || productId,
        productId: product.id,
        delta: -qty,
        reason: 'sale',
        correlationId: orderId,
        eventId: event.eventId,
        previousStock,
        newStock,
      });

      updatedSkus++;

      // Check for low stock
      if (newStock <= (product.stockLimit || 10)) {
        lowStockWarnings.push(product.name);
      }
    }

    return {
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      status: 'success',
      summary: `Inventory updated for ${updatedSkus} products`,
      data: { updatedSkus, lowStockWarnings },
    };
  }

  private async handleOrderUpdated(event: EventEnvelope, payload: OrderPayload): Promise<WorkerResult> {
    // For order updates, we need to calculate the delta
    // This requires comparing with previous state which may be stored or computed
    const items = payload.order?.items || payload.items || [];
    const orderId = payload.order?.orderId || payload.orderId || event.correlationId;
    
    let adjustedSkus = 0;

    for (const item of items) {
      const qty = item.qty || item.quantity || 0;
      const productId = item.productId || item.sku;
      if (!productId) continue;

      // Get previous movements for this order+product
      const previousMovements = await db
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.correlationId, orderId));

      const previousQty = previousMovements
        .filter(m => m.productId === productId)
        .reduce((sum, m) => sum + Math.abs(m.delta), 0);

      const delta = previousQty - qty; // positive = return stock, negative = deduct more

      if (delta === 0) continue;

      const productResult = await db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);

      if (productResult.length === 0) continue;

      const product = productResult[0];
      const previousStock = product.stock || 0;
      const newStock = Math.max(0, previousStock + delta);

      // Update stock
      await db
        .update(products)
        .set({ 
          stock: newStock,
          updatedAt: new Date() 
        })
        .where(eq(products.id, productId));

      // Record adjustment movement
      await db.insert(inventoryMovements).values({
        sku: product.productId || productId,
        productId: product.id,
        delta,
        reason: 'order_update',
        correlationId: orderId,
        eventId: event.eventId,
        previousStock,
        newStock,
      });

      adjustedSkus++;
    }

    return {
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      status: 'success',
      summary: `Inventory adjusted for ${adjustedSkus} products`,
      data: { adjustedSkus },
    };
  }

  private async handleStockReturn(event: EventEnvelope, payload: OrderPayload): Promise<WorkerResult> {
    // For refunds/cancellations, return stock for the specified lines
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
    
    let returnedSkus = 0;

    for (const line of lines) {
      const qty = line.qty || 0;
      const productId = line.productId;
      if (!productId || qty <= 0) continue;

      const productResult = await db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);

      if (productResult.length === 0) continue;

      const product = productResult[0];
      const previousStock = product.stock || 0;
      const newStock = previousStock + qty;

      // Update stock (add back)
      await db
        .update(products)
        .set({ 
          stock: newStock,
          updatedAt: new Date() 
        })
        .where(eq(products.id, productId));

      // Record return movement
      await db.insert(inventoryMovements).values({
        sku: product.productId || productId,
        productId: product.id,
        delta: qty,
        reason: event.eventType === 'RefundIssued' ? 'refund' : 'cancellation',
        correlationId: orderId,
        eventId: event.eventId,
        previousStock,
        newStock,
      });

      returnedSkus++;
    }

    return {
      worker: this.name,
      eventId: event.eventId,
      correlationId: event.correlationId,
      status: 'success',
      summary: `Stock returned for ${returnedSkus} products`,
      data: { returnedSkus },
    };
  }
}
