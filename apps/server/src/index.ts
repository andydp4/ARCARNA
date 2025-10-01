import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { engine } from './engine.wiring'
import invoicesRouter from './routes/invoices'
import { requireAuth } from './middleware/auth'
import analyticsRouter from './routes/analytics'
import authRouter from './routes/auth'

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
  secret: process.env.SESSION_SECRET || 'dev_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}))

app.use(helmet()); app.use(cors({ origin: true, credentials: true })); app.use(express.json()); app.use(cookieParser())

app.get('/healthz', (_, res)=> res.json({ ok:true }))
app.post('/api/orders', requireAuth, async (req, res, next)=>{
  try{
    const result = await engine.placeOrder(req.body)
    res.status(201).json(result)
  }catch(e){ next(e) }
})
app.use('/api/invoices', requireAuth, invoicesRouter)
app.use('/api/analytics', requireAuth, analyticsRouter)
app.use('/api/auth', authRouter)

const port = process.env.PORT || 5000
if (process.env.NODE_ENV !== 'test') app.listen(port, ()=> console.log(`Server :${port}`))

export default app