import { eq } from 'drizzle-orm'
import { db } from './index'
import * as s from './schema'
import type { OrdersRepo, ProductsRepo, CustomersRepo, Order, OrderId, ProductId, CustomerId } from '@midnight/domain'

export const OrdersRepoDrizzle: OrdersRepo = {
  async save(o: Order) {
    await db.insert(s.orders).values({
      id: o.id as any,
      customer_id: o.customerId as any,
      total: o.total,
      payment_method: o.paymentMethod,
      status: o.status,
    })
    for (const l of o.lines) {
      await db.insert(s.order_items).values({
        order_id: o.id as any,
        product_id: l.productId as any,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        total_price: l.lineTotal,
      })
    }
  },
  async findById(id: OrderId) {
    const rows = await db.select().from(s.orders).where(eq(s.orders.id, id as any)).limit(1)
    if (rows.length === 0) return null
    // Simplified: not reconstructing full lines here
    return rows[0] as any
  }
}

export const ProductsRepoDrizzle: ProductsRepo = {
  async reserveStock(p: ProductId, qty: number) {
    // Decrement stock atomically
    await db.execute(`UPDATE products SET stock = stock - $1 WHERE id = $2`, [qty, p as any])
  }
}

export const CustomersRepoDrizzle: CustomersRepo = {
  async addTickDebt(c: CustomerId, amount: number) {
    // As a placeholder, write an audit log entry (real impl would record debt ledger)
    await db.insert(s.audit_logs).values({ user_id: 'system', action: 'TickDebt', entity_type: 'customer', entity_id: c as any, new_values: { amount } })
  },
  async addOrderHistory(c: CustomerId, orderId: OrderId) {
    await db.insert(s.audit_logs).values({ user_id: 'system', action: 'OrderHistory', entity_type: 'customer', entity_id: c as any, new_values: { orderId } })
  }
}