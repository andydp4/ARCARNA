import { db } from './index'
import * as s from './schema'
import type { AnalyticsSink, AuditPort, OrderId } from '@midnight/domain'
import { eq } from 'drizzle-orm'

export const AnalyticsSinkDrizzle: AnalyticsSink = {
  async recordOrder(orderId: OrderId){
    // Get order details for the outbox event
    const order = await db
      .select()
      .from(s.orders)
      .where(eq(s.orders.id, orderId))
      .limit(1)
    
    if (order.length === 0) return
    
    const orderItems = await db
      .select()
      .from(s.order_items)
      .where(eq(s.order_items.order_id, orderId))
    
    // Write to outbox with complete order data for analytics worker
    await db.insert(s.domain_outbox).values({
      type: 'OrderPlaced',
      payload: {
        orderId,
        customerId: order[0].customer_id,
        total: parseFloat(order[0].total || '0'),
        orderDate: order[0].created_at?.toISOString() || new Date().toISOString(),
        items: orderItems.map(item => ({
          productId: item.product_id,
          quantity: item.quantity,
          unitPrice: parseFloat(item.unit_price || '0'),
        }))
      }
    })
  }
}

export const AuditPortDrizzle: AuditPort = {
  async log(event: string, payload: unknown){
    await db.insert(s.audit_logs).values({
      user_id: 'system', action: event, entity_type: 'order', new_values: payload as any
    })
  }
}