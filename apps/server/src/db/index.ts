import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle } from 'drizzle-orm/node-postgres'
import pkg from 'pg'
const { Pool } = pkg

/** Active Drizzle transaction client when inside `withTransaction`. */
const txStore = new AsyncLocalStorage<ReturnType<typeof drizzle>>()

export function getDb() {
  return txStore.getStore() ?? db
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
})

// Handle pool errors to prevent crashes
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err)
  // Don't throw - just log it
})

export const db = drizzle(pool)

export async function withTransaction<T>(fn: (tx: any)=>Promise<T>): Promise<T> {
  const parent = txStore.getStore()
  if (parent) {
    return fn(parent)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const txDb = drizzle(client)
    const result = await txStore.run(txDb, () => fn(txDb))
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}