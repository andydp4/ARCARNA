import { db } from '../db'
import {
  domain_outbox,
  analytics_daily,
  analytics_weekly,
  analytics_monthly,
  customer_metrics,
  orders,
  order_items,
  products,
  customers
} from '../db/schema'
import { eq, isNull, sql, and, gte, lte, or } from 'drizzle-orm'

interface OrderPlacedEvent {
  orderId: string
  customerId: string
  total: number
  orderDate: string
  items: Array<{
    productId: string
    quantity: number
    unitPrice: number
  }>
}

export class AnalyticsWorker {
  private isRunning = false
  private pollInterval = 5000 // 5 seconds
  private intervalId: NodeJS.Timeout | null = null

  async start() {
    if (this.isRunning) {
      console.log('[AnalyticsWorker] Already running')
      return
    }

    this.isRunning = true
    console.log('[AnalyticsWorker] Starting analytics aggregation...')

    // Run immediately on start
    this.runAggregation().catch(err => {
      console.error('[AnalyticsWorker] Initial aggregation failed:', err)
    })

    // Then run every hour
    this.intervalId = setInterval(() => {
      if (this.isRunning) {
        this.runAggregation().catch(err => {
          console.error('[AnalyticsWorker] Scheduled aggregation failed:', err)
        })
      }
    }, 60 * 60 * 1000) // 1 hour
  }

  stop(): void {
    this.isRunning = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('[AnalyticsWorker] Stopped')
  }

  private async runAggregation() {
    // This is where the actual aggregation logic would go.
    // For now, we'll just simulate processing outbox events.
    await this.processOutboxEvents()
  }

  private async processOutboxEvents() {
    // Fetch unprocessed events from the outbox with FOR UPDATE SKIP LOCKED
    const events = await db
      .select()
      .from(domain_outbox)
      .where(isNull(domain_outbox.processed_at))
      .orderBy(domain_outbox.created_at)
      .limit(10)

    for (const event of events) {
      try {
        // Mark as processing first to prevent duplicate processing
        const updated = await db
          .update(domain_outbox)
          .set({ processed_at: new Date() })
          .where(and(
            eq(domain_outbox.id, event.id),
            isNull(domain_outbox.processed_at)
          ))
          .returning()

        if (updated.length === 0) {
          console.log(`[AnalyticsWorker] Event ${event.id} already processed, skipping`)
          continue
        }

        console.log(`[AnalyticsWorker] Processing event ${event.id} of type ${event.type}`)

        if (event.type === 'OrderPlaced') {
          await this.handleOrderPlacedEvent(event.payload as OrderPlacedEvent)
        }

        console.log(`[AnalyticsWorker] Successfully processed event ${event.id}`)
      } catch (error) {
        console.error(`[AnalyticsWorker] Failed to process event ${event.id}:`, error)
        // Rollback processed_at on failure
        await db
          .update(domain_outbox)
          .set({ processed_at: null })
          .where(eq(domain_outbox.id, event.id))
      }
    }
  }

  private async handleOrderPlacedEvent(payload: OrderPlacedEvent) {
    const orderDate = new Date(payload.orderDate)

    // Update daily analytics
    await this.updateDailyAnalytics(orderDate, payload.total)

    // Update weekly analytics
    await this.updateWeeklyAnalytics(orderDate, payload.total)

    // Update monthly analytics
    await this.updateMonthlyAnalytics(orderDate, payload.total)

    // Update customer metrics
    if (payload.customerId) {
      await this.updateCustomerMetrics(payload.customerId)
    }
  }

  private async updateDailyAnalytics(date: Date, revenue: number) {
    const dateStr = date.toISOString().split('T')[0]

    // Try to update existing record
    const existing = await db
      .select()
      .from(analytics_daily)
      .where(eq(analytics_daily.date, dateStr))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(analytics_daily)
        .set({
          total_orders: sql`${analytics_daily.total_orders} + 1`,
          total_revenue: sql`${analytics_daily.total_revenue} + ${revenue}`,
        })
        .where(eq(analytics_daily.date, dateStr))
    } else {
      await db
        .insert(analytics_daily)
        .values({
          date: dateStr,
          total_orders: 1,
          total_revenue: revenue.toString(),
        })
        .onConflictDoUpdate({
          target: analytics_daily.date,
          set: {
            total_orders: sql`${analytics_daily.total_orders} + 1`,
            total_revenue: sql`${analytics_daily.total_revenue} + ${revenue}`,
          }
        })
    }
  }

  private async updateWeeklyAnalytics(date: Date, revenue: number) {
    const year = date.getFullYear()
    const week = this.getISOWeek(date)

    // Try to update existing record
    const existing = await db
      .select()
      .from(analytics_weekly)
      .where(and(
        eq(analytics_weekly.year, year),
        eq(analytics_weekly.week, week)
      ))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(analytics_weekly)
        .set({
          total_orders: sql`${analytics_weekly.total_orders} + 1`,
          total_revenue: sql`${analytics_weekly.total_revenue} + ${revenue}`,
        })
        .where(and(
          eq(analytics_weekly.year, year),
          eq(analytics_weekly.week, week)
        ))
    } else {
      await db
        .insert(analytics_weekly)
        .values({
          year,
          week,
          total_orders: 1,
          total_revenue: revenue.toString(),
        })
    }
  }

  private async updateMonthlyAnalytics(date: Date, revenue: number) {
    const year = date.getFullYear()
    const month = date.getMonth() + 1 // JavaScript months are 0-indexed

    // Try to update existing record
    const existing = await db
      .select()
      .from(analytics_monthly)
      .where(and(
        eq(analytics_monthly.year, year),
        eq(analytics_monthly.month, month)
      ))
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(analytics_monthly)
        .set({
          total_orders: sql`${analytics_monthly.total_orders} + 1`,
          total_revenue: sql`${analytics_monthly.total_revenue} + ${revenue}`,
        })
        .where(and(
          eq(analytics_monthly.year, year),
          eq(analytics_monthly.month, month)
        ))
    } else {
      await db
        .insert(analytics_monthly)
        .values({
          year,
          month,
          total_orders: 1,
          total_revenue: revenue.toString(),
        })
    }
  }

  private async updateCustomerMetrics(customerId: string) {
    // Calculate customer metrics
    const customerOrders = await db
      .select({
        total_spent: sql<number>`COALESCE(SUM(CAST(${orders.total} as DECIMAL)), 0)`,
        order_count: sql<number>`COUNT(*)`,
        last_order_date: sql<string>`MAX(${orders.created_at})`,
      })
      .from(orders)
      .where(eq(orders.customer_id, customerId))

    if (customerOrders.length === 0) return

    const metrics = customerOrders[0]
    const lastOrderDate = metrics.last_order_date ? new Date(metrics.last_order_date) : new Date()

    // Calculate RFM score
    const rfmScore = this.calculateRFMScore(
      lastOrderDate,
      metrics.order_count,
      metrics.total_spent
    )

    // Calculate CLV (simple version: average order value * expected purchases)
    const avgOrderValue = metrics.order_count > 0 ? metrics.total_spent / metrics.order_count : 0
    const expectedPurchases = Math.min(metrics.order_count * 2, 20) // Simple projection
    const clv = avgOrderValue * expectedPurchases

    // Update or insert customer metrics
    await db
      .insert(customer_metrics)
      .values({
        customer_id: customerId,
        last_order_date: lastOrderDate.toISOString().split('T')[0],
        total_spent: metrics.total_spent.toString(),
        order_count: metrics.order_count,
        rfm_score: rfmScore,
        clv: clv.toString(),
      })
      .onConflictDoUpdate({
        target: customer_metrics.customer_id,
        set: {
          last_order_date: lastOrderDate.toISOString().split('T')[0],
          total_spent: metrics.total_spent.toString(),
          order_count: metrics.order_count,
          rfm_score: rfmScore,
          clv: clv.toString(),
        }
      })
  }

  private calculateRFMScore(lastOrderDate: Date, orderCount: number, totalSpent: number): number {
    const now = new Date()
    const daysSinceLastOrder = Math.floor((now.getTime() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24))

    // Recency score (1-5, where 5 is most recent)
    let recencyScore = 5
    if (daysSinceLastOrder > 365) recencyScore = 1
    else if (daysSinceLastOrder > 180) recencyScore = 2
    else if (daysSinceLastOrder > 90) recencyScore = 3
    else if (daysSinceLastOrder > 30) recencyScore = 4

    // Frequency score (1-5, where 5 is most frequent)
    let frequencyScore = 1
    if (orderCount >= 20) frequencyScore = 5
    else if (orderCount >= 10) frequencyScore = 4
    else if (orderCount >= 5) frequencyScore = 3
    else if (orderCount >= 2) frequencyScore = 2

    // Monetary score (1-5, where 5 is highest value)
    let monetaryScore = 1
    if (totalSpent >= 10000) monetaryScore = 5
    else if (totalSpent >= 5000) monetaryScore = 4
    else if (totalSpent >= 1000) monetaryScore = 3
    else if (totalSpent >= 500) monetaryScore = 2

    // Combined RFM score (3-15)
    return recencyScore + frequencyScore + monetaryScore
  }

  private getISOWeek(date: Date): number {
    const target = new Date(date.valueOf())
    const dayNum = (date.getDay() + 6) % 7
    target.setDate(target.getDate() - dayNum + 3)
    const firstThursday = target.valueOf()
    target.setMonth(0, 1)
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7)
    }
    return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000)
  }
}

// Export a singleton instance
export const analyticsWorker = new AnalyticsWorker()