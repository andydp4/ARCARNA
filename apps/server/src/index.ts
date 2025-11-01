import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { engine } from './engine.wiring'
import invoicesRouter from './routes/invoices'
import { requireAuth } from './middleware/auth'
import analyticsRouter from './routes/analytics'
import authRouter from './routes/auth'
import { analyticsWorker } from './workers/analytics.worker'

const app = express()

import session from 'express-session'
const PgSession = require('connect-pg-simple')(session)
import { Pool } from 'pg'

const pgPool = new Pool({ connectionString: process.env.DATABASE_URL })

app.use(session({
  store: new PgSession({
    pool: pgPool,
    tableName: 'user_sessions'
  }),
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}))

app.use(helmet())
app.use(cors({ 
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.REPLIT_DOMAINS?.split(',') || ['https://*.replit.app', 'https://*.replit.dev']
    : true, 
  credentials: true 
}))
app.use(express.json())
app.use(cookieParser())

app.get('/healthz', (_, res)=> res.json({ ok:true }))
app.post('/api/orders', requireAuth, async (req, res, next)=>{
  try{
    const result = await engine.placeOrder(req.body)
    res.status(201).json(result)
  }catch(e){ next(e) }
})
app.get('/api/orders', requireAuth, async (req, res, next) => {
  try {
    const { db } = await import('./db')
    const schema = await import('./db/schema')
    const orders = await db.select({
      id: schema.orders.id,
      customerId: schema.orders.customer_id,
      total: schema.orders.total,
      paymentMethod: schema.orders.payment_method,
      status: schema.orders.status,
      createdAt: schema.orders.created_at,
    }).from(schema.orders).orderBy(schema.orders.created_at)
    res.json(orders)
  } catch(e) { next(e) }
})
app.patch('/api/orders/:id', requireAuth, async (req, res, next) => {
  try {
    const { db } = await import('./db')
    const schema = await import('./db/schema')
    const { eq } = await import('drizzle-orm')
    const { updateOrderStatusSchema } = await import('../../../shared/schema')
    
    // Validate status
    const validation = updateOrderStatusSchema.safeParse(req.body)
    if (!validation.success) {
      return res.status(400).json({ 
        message: 'Invalid status value',
        errors: validation.error.errors
      })
    }
    
    const [updated] = await db.update(schema.orders)
      .set({ status: validation.data.status, updated_at: new Date() })
      .where(eq(schema.orders.id, req.params.id))
      .returning()
    if (!updated) {
      return res.status(404).json({ message: 'Order not found' })
    }
    res.json(updated)
  } catch(e) { next(e) }
})
app.use('/api/invoices', requireAuth, invoicesRouter)
app.use('/api/analytics', requireAuth, analyticsRouter)
app.use('/api/auth', authRouter)

// Direct auth routes for backward compatibility
app.get('/api/login', (req, res) => res.redirect('/api/auth/login'))
app.get('/api/logout', (req, res) => res.redirect('/api/auth/logout'))
app.post('/api/logout', (req, res) => res.redirect(307, '/api/auth/logout'))

const port = process.env.PORT || 5000
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Server :${port}`)
    // Start analytics worker
    if (process.env.DATABASE_URL) {
      analyticsWorker.start().catch(console.error)
      console.log('Analytics worker started')
    }
  })
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...')
  analyticsWorker.stop()
  process.exit(0)
})

export default app