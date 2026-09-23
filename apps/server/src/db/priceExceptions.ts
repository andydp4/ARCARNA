import { sql } from 'drizzle-orm'
import { getDb, inTransaction } from './index'
import { priceExceptions } from '../../../../shared/schema'
import type { PriceExceptionsPort, PriceExceptionRecord } from '@midnight/domain'

/**
 * Writes underpriced lines (PRC-03, CMP-03) inside the sale's own transaction,
 * under a savepoint. A failed insert in Postgres poisons the whole
 * transaction, so without the savepoint a recording problem would fail the
 * sale — the one thing silent recording must never do. The engine catches the
 * error; the savepoint is what leaves the transaction usable after it.
 */
export const PriceExceptionsDrizzle: PriceExceptionsPort = {
  async record(rows: PriceExceptionRecord[]) {
    if (rows.length === 0) return
    const db = getDb()
    const values = rows.map((r) => ({
      orgId: r.orgId,
      orderId: r.orderId,
      productId: r.productId,
      userId: r.userId,
      source: r.source,
      channel: r.channel,
      quantity: r.quantity,
      unitPrice: String(r.unitPrice),
      listPrice: String(r.listPrice),
      floorPrice: String(r.floorPrice),
      unitCost: r.unitCost == null ? null : String(r.unitCost),
      belowMinimum: r.belowMinimum,
      belowCost: r.belowCost,
      underList: String(r.underList),
      underCost: String(r.underCost),
    }))
    if (!inTransaction()) {
      await db.insert(priceExceptions).values(values)
      return
    }
    await db.execute(sql`SAVEPOINT price_exceptions_record`)
    try {
      await db.insert(priceExceptions).values(values)
      await db.execute(sql`RELEASE SAVEPOINT price_exceptions_record`)
    } catch (error) {
      await db.execute(sql`ROLLBACK TO SAVEPOINT price_exceptions_record`)
      throw error
    }
  },
}
