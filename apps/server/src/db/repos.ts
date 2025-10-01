import { eq } from 'drizzle-orm'
import { db } from './index'
import * as s from './schema'
import type { OrdersRepo, ProductsRepo, CustomersRepo, Order, OrderId, ProductId, CustomerId, Product, Customer } from '@midnight/domain'

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
    
    // Write to domain outbox for analytics worker
    await db.insert(s.domain_outbox).values({
      event_type: 'OrderPlaced',
      payload: { orderId: o.id, customerId: o.customerId, total: o.total },
      created_at: new Date(),
    })
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
  },
  async create(product: Product): Promise<Product> {
    const [created] = await db.insert(s.products).values({
      id: product.id as any,
      product_id: product.productCode,
      name: product.name,
      barcode: product.barcode,
      price: product.price,
      tax: product.tax,
      stock: product.stock,
      stock_limit: product.stockLimit,
      category_id: product.categoryId,
      created_at: product.createdAt,
      updated_at: product.updatedAt,
    }).returning()
    return {
      ...product,
      id: created.id as ProductId,
    }
  },
  async update(id: ProductId, updates: Partial<Product>): Promise<Product> {
    const [updated] = await db.update(s.products)
      .set({
        product_id: updates.productCode,
        name: updates.name,
        barcode: updates.barcode,
        price: updates.price,
        tax: updates.tax,
        stock: updates.stock,
        stock_limit: updates.stockLimit,
        category_id: updates.categoryId,
        updated_at: updates.updatedAt,
      })
      .where(eq(s.products.id, id as any))
      .returning()
    return {
      id: updated.id as ProductId,
      productCode: updated.product_id,
      name: updated.name,
      barcode: updated.barcode,
      price: updated.price,
      tax: updated.tax,
      stock: updated.stock,
      stockLimit: updated.stock_limit,
      categoryId: updated.category_id,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    } as Product
  },
  async delete(id: ProductId): Promise<void> {
    await db.delete(s.products).where(eq(s.products.id, id as any))
  },
  async findById(id: ProductId): Promise<Product | null> {
    const [product] = await db.select().from(s.products).where(eq(s.products.id, id as any))
    if (!product) return null
    return {
      id: product.id as ProductId,
      productCode: product.product_id,
      name: product.name,
      barcode: product.barcode,
      price: product.price,
      tax: product.tax,
      stock: product.stock,
      stockLimit: product.stock_limit,
      categoryId: product.category_id,
      createdAt: product.created_at,
      updatedAt: product.updated_at,
    } as Product
  },
  async findAll(): Promise<Product[]> {
    const products = await db.select().from(s.products).orderBy(s.products.name)
    return products.map(p => ({
      id: p.id as ProductId,
      productCode: p.product_id,
      name: p.name,
      barcode: p.barcode,
      price: p.price,
      tax: p.tax,
      stock: p.stock,
      stockLimit: p.stock_limit,
      categoryId: p.category_id,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    } as Product))
  }
}

export const CustomersRepoDrizzle: CustomersRepo = {
  async addTickDebt(c: CustomerId, amount: number) {
    // Update customer total spent and track tick debt
    await db.execute(`UPDATE customers SET total_spent = total_spent + $1 WHERE id = $2`, [amount, c as any])
    await db.insert(s.audit_logs).values({ user_id: 'system', action: 'TickDebt', entity_type: 'customer', entity_id: c as any, new_values: { amount } })
  },
  async addOrderHistory(c: CustomerId, orderId: OrderId) {
    // Update customer total spent and order count for metrics
    const [order] = await db.select().from(s.orders).where(eq(s.orders.id, orderId as any))
    if (order) {
      await db.execute(`UPDATE customers SET total_spent = total_spent + $1, updated_at = NOW() WHERE id = $2`, [order.total, c as any])
    }
    await db.insert(s.audit_logs).values({ user_id: 'system', action: 'OrderHistory', entity_type: 'customer', entity_id: c as any, new_values: { orderId } })
  },
  async create(customer: Customer): Promise<Customer> {
    const [created] = await db.insert(s.customers).values({
      id: customer.id as any,
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
  async update(id: CustomerId, updates: Partial<Customer>): Promise<Customer> {
    const [updated] = await db.update(s.customers)
      .set({
        name: updates.name,
        phone: updates.phone,
        email: updates.email,
        address: updates.address,
        category: updates.category,
        loyalty_points: updates.loyaltyPoints,
        updated_at: updates.updatedAt,
      })
      .where(eq(s.customers.id, id as any))
      .returning()
    
    // Get metrics if they exist
    const [metrics] = await db.select().from(s.customer_metrics).where(eq(s.customer_metrics.customer_id, id as any))
    
    return {
      id: updated.id as CustomerId,
      name: updated.name,
      phone: updated.phone,
      email: updated.email,
      address: updated.address,
      category: updated.category,
      loyaltyPoints: updated.loyalty_points,
      totalSpent: metrics?.total_spent || 0,
      rfmScore: metrics?.rfm_score,
      clv: metrics?.clv,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    } as Customer
  },
  async delete(id: CustomerId): Promise<void> {
    await db.delete(s.customers).where(eq(s.customers.id, id as any))
  },
  async findById(id: CustomerId): Promise<Customer | null> {
    const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, id as any))
    if (!customer) return null
    
    // Get metrics if they exist
    const [metrics] = await db.select().from(s.customer_metrics).where(eq(s.customer_metrics.customer_id, id as any))
    
    return {
      id: customer.id as CustomerId,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      category: customer.category,
      loyaltyPoints: customer.loyalty_points,
      totalSpent: metrics?.total_spent || 0,
      rfmScore: metrics?.rfm_score,
      clv: metrics?.clv,
      createdAt: customer.created_at,
      updatedAt: customer.updated_at,
    } as Customer
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
    
    const [rfmResult] = await db.execute(rfmQuery, [customerId])
    if (!rfmResult) return
    
    const { rfm_score, total_spent, order_count, recency_days } = rfmResult as any
    
    // Calculate CLV (simplified: average order value * expected orders per year * customer lifespan)
    const avgOrderValue = order_count > 0 ? total_spent / order_count : 0
    const ordersPerYear = recency_days > 0 ? (365 / recency_days) * order_count : order_count
    const customerLifespan = 3 // Assume 3 year customer lifespan
    const clv = avgOrderValue * ordersPerYear * customerLifespan
    
    // Update or insert customer metrics
    await db.execute(`
      INSERT INTO customer_metrics (customer_id, total_spent, order_count, last_order_date, rfm_score, clv, updated_at)
      VALUES ($1, $2, $3, NOW(), $4, $5, NOW())
      ON CONFLICT (customer_id) DO UPDATE
      SET total_spent = $2, order_count = $3, last_order_date = NOW(), rfm_score = $4, clv = $5, updated_at = NOW()
    `, [customerId, total_spent, order_count, rfm_score, clv])
  }
}