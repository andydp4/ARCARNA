import { drizzle } from 'drizzle-orm/node-postgres'
import pkg from 'pg'
const { Pool } = pkg

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle(pool)

export async function withTransaction<T>(fn: (tx: any)=>Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const txDb = drizzle(client)
    const result = await fn(txDb)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK'); throw e
  } finally {
    client.release()
  }
}