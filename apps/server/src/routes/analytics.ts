import { Router } from 'express'
import { db } from '../db'
import * as s from '../db/schema'
import { desc } from 'drizzle-orm'

const router = Router()

// Top customers by CLV
router.get('/top-customers', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 10
  const rows = await db.select().from(s.customer_metrics)
    .orderBy(desc(s.customer_metrics.clv))
    .limit(limit)
  res.json(rows)
})

// Daily revenue trend (last 30 days)
router.get('/daily-revenue', async (req, res) => {
  const rows = await db.select().from(s.analytics_daily)
    .orderBy(desc(s.analytics_daily.date))
    .limit(30)
  res.json(rows.reverse())
})

// Monthly summary (last 12 months)
router.get('/monthly-summary', async (req, res) => {
  const rows = await db.select().from(s.analytics_monthly)
    .orderBy(desc(s.analytics_monthly.year), desc(s.analytics_monthly.month))
    .limit(12)
  res.json(rows.reverse())
})

export default router