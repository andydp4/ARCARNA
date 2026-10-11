import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { refunds } from "@shared/schema";
import type { UnattachedCashRefundList, UnattachedCashRefundSummary } from "@shared/reports/zReport";
import { refundCashOut } from "@shared/refunds/refundRules";
import { db } from "../db";

type Reader = Pick<typeof db, "select">;

// `original` means cash after resolveRefundTender has normalised card/tab
// refunds. Match refundCashOut, including partial refunds taken off a tab.
const cashOut = sql<number>`GREATEST(0, ${refunds.total} - GREATEST(0, COALESCE(${refunds.creditAmount}, 0)))`;
const unlinkedCash = (orgId: string) => and(
  eq(refunds.orgId, orgId),
  isNull(refunds.shiftId),
  inArray(refunds.refundMethod, ["cash", "original"]),
  sql`${cashOut} > 0`,
);

/**
 * No date/location filter: an older refund or one issued while NO drawer was
 * open still needs review. Refund rows do not record the source drawer's
 * location, and the sale's location is not proof of where cash was paid out.
 */
export async function loadUnattachedCashRefundSummary(orgId: string, client: Reader = db): Promise<UnattachedCashRefundSummary> {
  const [totals] = await client.select({
    count: sql<number>`COUNT(*)::int`,
    cashTotal: sql<string>`COALESCE(SUM(${cashOut}), 0)`,
  }).from(refunds).where(unlinkedCash(orgId));
  return { count: Number(totals?.count ?? 0), cashTotal: Number(totals?.cashTotal ?? 0) };
}

export async function loadUnattachedCashRefundList(orgId: string, offset = 0): Promise<UnattachedCashRefundList> {
  // One snapshot keeps the all-time total and bounded detail list consistent.
  return db.transaction(async (tx) => {
    const summary = await loadUnattachedCashRefundSummary(orgId, tx);
    const rows = await tx.select({
      id: refunds.id, orderId: refunds.orderId, createdAt: refunds.createdAt,
      total: refunds.total, creditAmount: refunds.creditAmount, refundMethod: refunds.refundMethod,
    }).from(refunds).where(unlinkedCash(orgId)).orderBy(desc(refunds.createdAt), desc(refunds.id)).limit(100).offset(offset);
    return {
      ...summary,
      generatedAt: new Date().toISOString(),
      offset,
      refunds: rows.map((row) => ({
        id: row.id, orderId: row.orderId, createdAt: row.createdAt?.toISOString() ?? null,
        cashAmount: refundCashOut({ ...row, total: Number(row.total), creditAmount: Number(row.creditAmount ?? 0) }),
      })),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
