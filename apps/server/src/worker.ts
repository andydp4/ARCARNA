/**
 * Analytics Worker - consumes domain_outbox and projects aggregates, RFM, CLV
 */
import { db } from './db'
import * as s from './db/schema'
import { eq, isNull, sql } from 'drizzle-orm'

function getISOWeek(d: Date){
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1))
  return Math.ceil((((date.getTime() - yearStart.getTime())/86400000)+1)/7)
}

async function processOnce(){
  const rows = await db.select().from(s.domain_outbox).where(isNull(s.domain_outbox.processed_at)).limit(10)
  for (const row of rows){
    console.log('[Worker] Processing', row.type, row.payload)
    if (row.type === 'OrderAggregatesRequested'){
      const { orderId } = row.payload
      const orders = await db.select().from(s.orders).where(eq(s.orders.id, orderId)).limit(1)
      if (orders.length===0) continue
      const order = orders[0] as any
      const orderDate = new Date(order.created_at)
      const revenue = Number(order.total)
      const year = orderDate.getUTCFullYear()
      const week = getISOWeek(orderDate)
      const month = orderDate.getUTCMonth()+1

      // Daily
      await db.execute(sql`INSERT INTO analytics_daily(date,total_orders,total_revenue)
        VALUES (${orderDate.toISOString().slice(0,10)},1,${revenue})
        ON CONFLICT(date) DO UPDATE SET 
          total_orders=analytics_daily.total_orders+1,
          total_revenue=analytics_daily.total_revenue+${revenue}`)

      // Weekly
      await db.execute(sql`INSERT INTO analytics_weekly(year,week,total_orders,total_revenue)
        VALUES (${year},${week},1,${revenue})
        ON CONFLICT(year,week) DO UPDATE SET 
          total_orders=analytics_weekly.total_orders+1,
          total_revenue=analytics_weekly.total_revenue+${revenue}`)

      // Monthly
      await db.execute(sql`INSERT INTO analytics_monthly(year,month,total_orders,total_revenue)
        VALUES (${year},${month},1,${revenue})
        ON CONFLICT(year,month) DO UPDATE SET 
          total_orders=analytics_monthly.total_orders+1,
          total_revenue=analytics_monthly.total_revenue+${revenue}`)

      // Customer metrics + RFM/CLV
      if (order.customer_id){
        // Upsert base metrics
        await db.execute(sql`INSERT INTO customer_metrics(customer_id,last_order_date,total_spent,order_count)
          VALUES (${order.customer_id},${orderDate.toISOString().slice(0,10)},${revenue},1)
          ON CONFLICT(customer_id) DO UPDATE SET 
            last_order_date=excluded.last_order_date,
            total_spent=customer_metrics.total_spent+${revenue},
            order_count=customer_metrics.order_count+1`)

        // Now compute RFM & CLV
        const recencyDays = Math.floor((Date.now() - orderDate.getTime()) / (1000*60*60*24))
        const recencyScore = recencyDays <= 30 ? 5 : recencyDays <= 90 ? 4 : recencyDays <= 180 ? 3 : recencyDays <= 365 ? 2 : 1

        // Frequency + Monetary scoring based on thresholds
        await db.execute(sql`
          UPDATE customer_metrics
          SET rfm_score = ${recencyScore} 
            + CASE WHEN order_count > 50 THEN 5 WHEN order_count > 20 THEN 4 WHEN order_count > 10 THEN 3 WHEN order_count > 5 THEN 2 ELSE 1 END
            + CASE WHEN total_spent > 5000 THEN 5 WHEN total_spent > 2000 THEN 4 WHEN total_spent > 1000 THEN 3 WHEN total_spent > 500 THEN 2 ELSE 1 END,
            clv = (CASE WHEN order_count=0 THEN 0 ELSE (total_spent::numeric / order_count) END) * (order_count/3.0)
          WHERE customer_id=${order.customer_id}`)
      }
    }
    await db.update(s.domain_outbox).set({ processed_at: new Date() }).where(eq(s.domain_outbox.id,row.id))
  }
}

export async function runWorker(){
  console.log('[Worker] Starting loop...')
  while(true){
    await processOnce()
    await new Promise(r=>setTimeout(r,5000))
  }
}

if (require.main === module){
  runWorker().catch(err=>{ console.error(err); process.exit(1) })
}