import { eq, and, sql } from 'drizzle-orm'
import { db } from './index'
import * as s from './schema'
import type { OrdersRepo, ProductsRepo, CustomersRepo, Order, OrderId, ProductId, CustomerId, Product, Customer, StockContext } from '@midnight/domain'

export const OrdersRepoDrizzle: OrdersRepo = {
  async save(o: Order) {
    // Check if order exists
    const existing = await db.select().from(s.orders).where(eq(s.orders.id, o.id as any)).limit(1)
    
    if (existing.length > 0) {
      // Update existing order
      await db.update(s.orders)
        .set({
          customer_id: o.customerId as any,
          total: String(o.total),
          payment_method: o.paymentMethod,
          status: o.status,
        })
        .where(eq(s.orders.id, o.id as any))
      
      // Delete existing line items and re-insert
      await db.delete(s.order_items).where(eq(s.order_items.order_id, o.id as any))
      const orgId = (o as any).orgId ?? existing[0]?.org_id;
      for (const l of o.lines) {
        await db.insert(s.order_items).values({
          order_id: o.id as any,
          product_id: l.productId as any,
          quantity: l.quantity,
          unit_price: String(l.unitPrice),
          total_price: String(l.lineTotal),
          org_id: orgId,
        } as typeof s.order_items.$inferInsert)
      }
    } else {
      const orderWithOrg = o as any
      await db.insert(s.orders).values({
        id: o.id as any,
        org_id: orderWithOrg.orgId ?? null,
        location_id: orderWithOrg.locationId ?? null,
        customer_id: o.customerId as any,
        total: String(o.total),
        payment_method: o.paymentMethod,
        status: o.status,
      })
      const orgId = orderWithOrg.orgId;
      for (const l of o.lines) {
        await db.insert(s.order_items).values({
          order_id: o.id as any,
          product_id: l.productId as any,
          quantity: l.quantity,
          unit_price: String(l.unitPrice),
          total_price: String(l.lineTotal),
          org_id: orgId,
        } as typeof s.order_items.$inferInsert)
      }
      
      await db.insert(s.domain_outbox).values({
        type: 'OrderPlaced',
        payload: { orderId: o.id, customerId: o.customerId, total: o.total, orderDate: o.createdAt, orgId: orderWithOrg.orgId ?? null },
        created_at: new Date(),
      })
    }
  },
  async findById(id: OrderId) {
    const [orderRow] = await db.select().from(s.orders).where(eq(s.orders.id, id as any)).limit(1)
    if (!orderRow) return null
    
    // Fetch line items
    const items = await db.select().from(s.order_items).where(eq(s.order_items.order_id, id as any))
    
    // Reconstruct full Order object
    return {
      id: orderRow.id as OrderId,
      customerId: orderRow.customer_id as CustomerId,
      lines: items.map(item => ({
        productId: item.product_id as ProductId,
        quantity: item.quantity!,
        unitPrice: parseFloat(String(item.unit_price!)),
        lineTotal: parseFloat(String(item.total_price!)),
      })),
      subtotal: parseFloat(String(orderRow.total!)) / 1.20,
      vat: parseFloat(String(orderRow.total!)) * 0.20 / 1.20,
      total: parseFloat(String(orderRow.total!)),
      paymentMethod: orderRow.payment_method as any,
      status: orderRow.status as any,
      createdAt: orderRow.created_at!,
    } as Order
  }
}

async function resolveStockCtx(p: ProductId, ctx?: StockContext): Promise<{ orgId: string; locationId: string }> {
  const { resolveStockLocationId } = await import('../../../../server/services/productLocationStock')
  let orgId = ctx?.orgId
  if (!orgId && ctx?.orderId) {
    const [order] = await db.select({ org_id: s.orders.org_id, location_id: s.orders.location_id }).from(s.orders).where(eq(s.orders.id, ctx.orderId as any)).limit(1)
    orgId = order?.org_id ?? undefined
    if (!ctx?.locationId && order?.location_id) ctx = { ...ctx!, locationId: order.location_id }
  }
  if (!orgId) {
    const [product] = await db.select({ org_id: s.products.org_id }).from(s.products).where(eq(s.products.id, p as any)).limit(1)
    orgId = product?.org_id ?? undefined
  }
  if (!orgId) throw new Error('Stock context requires orgId')
  const locationId = await resolveStockLocationId({ orgId, locationId: ctx?.locationId, orderId: ctx?.orderId, userId: ctx?.userId })
  return { orgId, locationId }
}

export const ProductsRepoDrizzle: ProductsRepo = {
  async checkStock(p: ProductId, ctx?: StockContext): Promise<number> {
    const { getProductStockTotal, getProductLocationStock, resolveStockLocationId } = await import('../../../../server/services/productLocationStock')
    let orgId = ctx?.orgId
    if (!orgId) {
      const [product] = await db.select({ org_id: s.products.org_id }).from(s.products).where(eq(s.products.id, p as any)).limit(1)
      orgId = product?.org_id ?? undefined
    }
    if (!orgId) return 0
    try {
      const locationId = await resolveStockLocationId({ orgId, locationId: ctx?.locationId, orderId: ctx?.orderId, userId: ctx?.userId })
      const row = await getProductLocationStock(orgId, p as string, locationId)
      if (row) return row.stock ?? 0
    } catch {
      // fall through to total
    }
    return getProductStockTotal(orgId, p as string)
  },
  async reserveStock(p: ProductId, qty: number, ctx: StockContext) {
    const { adjustProductLocationStock } = await import('../../../../server/services/productLocationStock')
    const { orgId, locationId } = await resolveStockCtx(p, ctx)
    const [product] = await db.select({ product_id: s.products.product_id }).from(s.products).where(eq(s.products.id, p as any)).limit(1)
    await adjustProductLocationStock({
      orgId,
      productId: p as string,
      locationId,
      delta: -qty,
      movement: {
        reason: 'sale',
        correlationId: ctx.orderId || p as string,
        eventId: `reserve-${Date.now()}`,
        sku: product?.product_id || p as string,
      },
    })
  },
  async releaseStock(p: ProductId, qty: number, ctx: StockContext) {
    const { adjustProductLocationStock } = await import('../../../../server/services/productLocationStock')
    const { orgId, locationId } = await resolveStockCtx(p, ctx)
    const [product] = await db.select({ product_id: s.products.product_id }).from(s.products).where(eq(s.products.id, p as any)).limit(1)
    await adjustProductLocationStock({
      orgId,
      productId: p as string,
      locationId,
      delta: qty,
      movement: {
        reason: 'adjustment',
        correlationId: ctx.orderId || p as string,
        eventId: `release-${Date.now()}`,
        sku: product?.product_id || p as string,
      },
    })
  },
  async create(product: Product): Promise<Product> {
    const p = product as any
    const [created] = await db.insert(s.products).values({
      id: product.id as any,
      org_id: p.orgId ?? undefined,
      product_id: product.productCode,
      name: product.name,
      barcode: product.barcode,
      cost_price: String(product.costPrice || 0),
      default_sale_price: String(product.salePrice || 0),
      stock: product.stock,
      stock_limit: product.stockLimit,
      created_at: product.createdAt,
      updated_at: product.updatedAt,
    }).returning()
    return {
      ...product,
      id: created.id as ProductId,
    }
  },
  async update(id: ProductId, updates: Partial<Product>, orgId?: string | null): Promise<Product> {
    const whereCond = orgId
      ? and(eq(s.products.id, id as any), eq(s.products.org_id, orgId))
      : eq(s.products.id, id as any)
    const [updated] = await db.update(s.products)
      .set({
        product_id: updates.productCode,
        name: updates.name,
        barcode: updates.barcode,
        cost_price: updates.costPrice ? String(updates.costPrice) : undefined,
        default_sale_price: updates.salePrice ? String(updates.salePrice) : undefined,
        stock: updates.stock,
        stock_limit: updates.stockLimit,
        updated_at: updates.updatedAt,
      })
      .where(whereCond)
      .returning()
    if (!updated) throw new Error('Product not found')
    return {
      id: updated.id as ProductId,
      productCode: updated.product_id,
      name: updated.name,
      barcode: updated.barcode,
      costPrice: parseFloat(updated.cost_price || '0'),
      salePrice: parseFloat(updated.default_sale_price),
      stock: updated.stock,
      stockLimit: updated.stock_limit,
      categoryId: undefined,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    } as Product
  },
  async delete(id: ProductId, orgId?: string | null): Promise<void> {
    const whereCond = orgId
      ? and(eq(s.products.id, id as any), eq(s.products.org_id, orgId))
      : eq(s.products.id, id as any)
    const [deleted] = await db.delete(s.products).where(whereCond).returning({ id: s.products.id })
    if (orgId && !deleted) throw new Error('Product not found')
  },
  async findById(id: ProductId): Promise<Product | null> {
    const [product] = await db.select().from(s.products).where(eq(s.products.id, id as any))
    if (!product) return null
    return {
      id: product.id as ProductId,
      productCode: product.product_id,
      name: product.name,
      barcode: product.barcode,
      costPrice: parseFloat(product.cost_price || '0'),
      salePrice: parseFloat(product.default_sale_price),
      stock: product.stock,
      stockLimit: product.stock_limit,
      categoryId: undefined,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    } as Product
  },
  async findAll(): Promise<Product[]> {
    const products = await db.select().from(s.products).orderBy(s.products.name)
    return products.map(product => ({
      id: product.id as ProductId,
      productCode: product.product_id,
      name: product.name,
      barcode: product.barcode,
      costPrice: parseFloat(product.cost_price || '0'),
      salePrice: parseFloat(product.default_sale_price),
      stock: product.stock,
      stockLimit: product.stock_limit,
      categoryId: undefined,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    } as Product))
  }
}

export const CustomersRepoDrizzle: CustomersRepo = {
  async addTickDebt(c: CustomerId, amount: number) {
    // Track tick debt in audit log
    await db.update(s.customers)
      .set({ 
        updated_at: new Date()
      })
      .where(eq(s.customers.id, c as any))
    await db.insert(s.audit_logs).values({ user_id: 'system', action: 'TickDebt', entity_type: 'customer', entity_id: c as any, new_values: { amount } })
  },
  async addOrderHistory(c: CustomerId, orderId: OrderId) {
    // Track order in audit log and update timestamp
    const [order] = await db.select().from(s.orders).where(eq(s.orders.id, orderId as any))
    if (order) {
      await db.update(s.customers)
        .set({ 
          updated_at: new Date()
        })
        .where(eq(s.customers.id, c as any))
    }
    await db.insert(s.audit_logs).values({ user_id: 'system', action: 'OrderHistory', entity_type: 'customer', entity_id: c as any, new_values: { orderId } })
  },
  async create(customer: Customer): Promise<Customer> {
    const c = customer as any
    const [created] = await db.insert(s.customers).values({
      id: customer.id as any,
      org_id: c.orgId ?? undefined,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      category: customer.category,
      loyalty_points: customer.loyaltyPoints,
      created_at: customer.createdAt,
      updated_at: customer.updatedAt,
    }).returning()
    return {
      ...customer,
      id: created.id as CustomerId,
    }
  },
  async update(id: CustomerId, updates: Partial<Customer>, orgId?: string | null): Promise<Customer> {
    const whereCond = orgId
      ? and(eq(s.customers.id, id as any), eq(s.customers.org_id, orgId))
      : eq(s.customers.id, id as any)
    const [updated] = await db.update(s.customers)
      .set({
        name: updates.name,
        phone: updates.phone,
        email: updates.email,
        address: updates.address,
        category: updates.category,
        loyalty_points: updates.loyaltyPoints,
        updated_at: updates.updatedAt,
        ...(updates.category !== undefined ? { manual_override_protected: 1 } : {}),
      })
      .where(whereCond)
      .returning()
    if (!updated) throw new Error('Customer not found')
    
    // Get metrics if they exist
    const [metrics] = await db.select().from(s.customer_metrics).where(eq(s.customer_metrics.customer_id, id as any))
    
    return {
      id: updated.id as CustomerId,
      name: updated.name,
      phone: updated.phone ?? undefined,
      email: updated.email ?? undefined,
      address: updated.address ?? undefined,
      category: (updated.category ?? 'Bronze') as Customer['category'],
      loyaltyPoints: updated.loyalty_points ?? 0,
      totalSpent: parseFloat(String(metrics?.total_spent ?? 0)),
      rfmScore: metrics?.rfm_score ?? undefined,
      clv: metrics?.clv != null ? parseFloat(String(metrics.clv)) : undefined,
      createdAt: updated.created_at!,
      updatedAt: updated.updated_at!,
    }
  },
  async delete(id: CustomerId, orgId?: string | null): Promise<void> {
    const whereCond = orgId
      ? and(eq(s.customers.id, id as any), eq(s.customers.org_id, orgId))
      : eq(s.customers.id, id as any)
    const [deleted] = await db.delete(s.customers).where(whereCond).returning({ id: s.customers.id })
    if (orgId && !deleted) throw new Error('Customer not found')
  },
  async findById(id: CustomerId): Promise<Customer | null> {
    const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, id as any))
    if (!customer) return null
    
    // Get metrics if they exist
    const [metrics] = await db.select().from(s.customer_metrics).where(eq(s.customer_metrics.customer_id, id as any))
    
    return {
      id: customer.id as CustomerId,
      name: customer.name,
      phone: customer.phone ?? undefined,
      email: customer.email ?? undefined,
      address: customer.address ?? undefined,
      category: (customer.category ?? 'Bronze') as Customer['category'],
      loyaltyPoints: customer.loyalty_points ?? 0,
      totalSpent: parseFloat(String(metrics?.total_spent ?? 0)),
      rfmScore: metrics?.rfm_score ?? undefined,
      clv: metrics?.clv != null ? parseFloat(String(metrics.clv)) : undefined,
      createdAt: customer.created_at!,
      updatedAt: customer.updated_at!,
    }
  },
  async findAll(): Promise<Customer[]> {
    const customers = await db.select().from(s.customers)
      .leftJoin(s.customer_metrics, eq(s.customers.id, s.customer_metrics.customer_id))
      .orderBy(s.customers.name)
    
    return customers.map(row => ({
      id: row.customers.id as CustomerId,
      name: row.customers.name,
      phone: row.customers.phone,
      email: row.customers.email,
      address: row.customers.address,
      category: row.customers.category,
      loyaltyPoints: row.customers.loyalty_points,
      totalSpent: row.customer_metrics?.total_spent || 0,
      rfmScore: row.customer_metrics?.rfm_score,
      clv: row.customer_metrics?.clv,
      createdAt: row.customers.created_at,
      updatedAt: row.customers.updated_at,
    } as Customer))
  },
  async updateMetrics(c: CustomerId): Promise<void> {
    // Calculate and update customer metrics (CLV, RFM)
    // This is called after orders to update metrics
    const customerId = c as any
    
    // Calculate RFM score
    const rfmQuery = `
      WITH customer_orders AS (
        SELECT 
          customer_id,
          COUNT(*) as frequency,
          MAX(created_at) as last_order_date,
          SUM(total) as monetary
        FROM orders
        WHERE customer_id = $1
        GROUP BY customer_id
      ),
      rfm_calc AS (
        SELECT 
          customer_id,
          EXTRACT(DAY FROM NOW() - last_order_date) as recency_days,
          frequency,
          monetary,
          CASE 
            WHEN EXTRACT(DAY FROM NOW() - last_order_date) <= 30 THEN 5
            WHEN EXTRACT(DAY FROM NOW() - last_order_date) <= 60 THEN 4
            WHEN EXTRACT(DAY FROM NOW() - last_order_date) <= 90 THEN 3
            WHEN EXTRACT(DAY FROM NOW() - last_order_date) <= 180 THEN 2
            ELSE 1
          END as recency_score,
          CASE 
            WHEN frequency >= 10 THEN 5
            WHEN frequency >= 7 THEN 4
            WHEN frequency >= 4 THEN 3
            WHEN frequency >= 2 THEN 2
            ELSE 1
          END as frequency_score,
          CASE 
            WHEN monetary >= 1000 THEN 5
            WHEN monetary >= 500 THEN 4
            WHEN monetary >= 200 THEN 3
            WHEN monetary >= 50 THEN 2
            ELSE 1
          END as monetary_score
        FROM customer_orders
      )
      SELECT 
        recency_score + frequency_score + monetary_score as rfm_score,
        monetary as total_spent,
        frequency as order_count,
        recency_days
      FROM rfm_calc
    `
    
    const rfmQueryWithId = rfmQuery.replace('$1', `'${customerId}'`)
    const rfmRaw = await db.execute(sql.raw(rfmQueryWithId))
    const rows = 'rows' in rfmRaw && Array.isArray((rfmRaw as { rows: unknown[] }).rows)
      ? (rfmRaw as { rows: Record<string, unknown>[] }).rows
      : Array.isArray(rfmRaw)
        ? rfmRaw as Record<string, unknown>[]
        : []
    const rfmResult = rows[0]
    if (!rfmResult) return
    
    const rfm_score = Number(rfmResult.rfm_score) || 0
    const total_spent = Number(rfmResult.total_spent) || 0
    const order_count = Number(rfmResult.order_count) || 0
    const recency_days = Number(rfmResult.recency_days) || 0
    
    // Calculate CLV (simplified: average order value * expected orders per year * customer lifespan)
    const avgOrderValue = order_count > 0 ? total_spent / order_count : 0
    const ordersPerYear = recency_days > 0 ? (365 / recency_days) * order_count : order_count
    const customerLifespan = 3 // Assume 3 year customer lifespan
    const clv = avgOrderValue * ordersPerYear * customerLifespan
    
    // Update or insert customer metrics using Drizzle ORM
    const existingMetric = await db.select().from(s.customer_metrics).where(eq(s.customer_metrics.customer_id, customerId as any)).limit(1)
    
    const lastOrderDateStr = new Date().toISOString().split('T')[0]
    const clvStr = String(clv)
    const totalSpentStr = String(total_spent)

    if (existingMetric.length > 0) {
      await db.update(s.customer_metrics)
        .set({
          total_spent: totalSpentStr,
          order_count: order_count,
          last_order_date: lastOrderDateStr,
          rfm_score: rfm_score,
          clv: clvStr,
        })
        .where(eq(s.customer_metrics.customer_id, customerId as any))
    } else {
      await db.insert(s.customer_metrics).values({
        customer_id: customerId as any,
        total_spent: totalSpentStr,
        order_count: order_count,
        last_order_date: lastOrderDateStr,
        rfm_score: rfm_score,
        clv: clvStr,
      })
    }
  }
}