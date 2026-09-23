import { and, eq, inArray, sql } from 'drizzle-orm'
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
function toValues(rows: PriceExceptionRecord[]) {
  return rows.map((r) => ({
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
}

/** Runs `fn` under a savepoint when inside the sale's transaction. */
async function underSavepoint(fn: () => Promise<void>): Promise<void> {
  const db = getDb()
  if (!inTransaction()) return fn()
  await db.execute(sql`SAVEPOINT price_exceptions_record`)
  try {
    await fn()
    await db.execute(sql`RELEASE SAVEPOINT price_exceptions_record`)
  } catch (error) {
    await db.execute(sql`ROLLBACK TO SAVEPOINT price_exceptions_record`)
    throw error
  }
}

const num = (v: unknown) => Number(v) || 0

export const PriceExceptionsDrizzle: PriceExceptionsPort = {
  async record(rows: PriceExceptionRecord[]) {
    if (rows.length === 0) return
    await underSavepoint(async () => {
      await getDb().insert(priceExceptions).values(toValues(rows))
    })
  },

  async forOrder(orgId: string, orderId: string) {
    const rows = await getDb()
      .select()
      .from(priceExceptions)
      .where(and(eq(priceExceptions.orgId, orgId), eq(priceExceptions.orderId, orderId)))
    return rows.map((r) => ({
      orgId: r.orgId,
      orderId: r.orderId,
      productId: r.productId as string,
      userId: r.userId,
      source: r.source as 'sale' | 'edit',
      channel: r.channel,
      quantity: num(r.quantity),
      unitPrice: num(r.unitPrice),
      listPrice: num(r.listPrice),
      floorPrice: num(r.floorPrice),
      unitCost: r.unitCost == null ? null : num(r.unitCost),
      belowMinimum: r.belowMinimum,
      belowCost: r.belowCost,
      underList: num(r.underList),
      underCost: num(r.underCost),
    }))
  },

  async replaceForOrder(orgId: string, orderId: string, productIds: string[], rows: PriceExceptionRecord[]) {
    if (productIds.length === 0 && rows.length === 0) return
    await underSavepoint(async () => {
      const db = getDb()
      if (productIds.length > 0) {
        await db
          .delete(priceExceptions)
          .where(
            and(
              eq(priceExceptions.orgId, orgId),
              eq(priceExceptions.orderId, orderId),
              inArray(priceExceptions.productId, productIds),
            ),
          )
      }
      if (rows.length > 0) await db.insert(priceExceptions).values(toValues(rows))
    })
  },
}
