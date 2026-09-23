/**
 * One order per till sale reference (v1.2 Phase 1A).
 *
 * The till sends `clientOrderId` on every attempt at a sale. The first attempt
 * that lands records the order; every repeat — a retry after a timeout, a
 * double tap, an offline replay, a manager's retry from Needs attention — is
 * answered with that same order. Three layers, each covering a gap in the one
 * before:
 *
 *   1. a lookup before any work is done (the common repeat, answered cheaply);
 *   2. a transaction-scoped advisory lock on the reference, then the lookup
 *      again, so two copies of one sale arriving together are recorded once;
 *   3. the unique index `orders_org_client_order_id_uq` (migration 080), in
 *      case anything ever writes the column without taking the lock.
 */
import { sql } from "drizzle-orm";
import { isValidClientOrderId } from "@shared/orders/saleReference";

export type RecordedSale = {
  id: string;
  status: string | null;
  total: string;
  paymentMethod: string;
  createdAt: Date | null;
  dateKind: string | null;
};

/**
 * Reads `clientOrderId` from a request body. Absent is fine (the website and
 * API callers do not send one); present but malformed is refused rather than
 * ignored, because ignoring it would silently turn off the only thing stopping
 * a double-recorded sale.
 */
export function readClientOrderId(
  body: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  const raw = (body as { clientOrderId?: unknown } | null | undefined)?.clientOrderId;
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (!isValidClientOrderId(raw)) {
    return { ok: false, message: "The sale reference from the till is not valid. Start the sale again." };
  }
  return { ok: true, value: raw };
}

type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** The order already recorded under this reference in this org, if any. */
export async function findSaleByReference(
  executor: Executor,
  orgId: string,
  clientOrderId: string,
): Promise<RecordedSale | null> {
  const result = await executor.execute(sql`
    SELECT id, status, total, payment_method, created_at, date_kind
    FROM orders
    WHERE org_id = ${orgId} AND client_order_id = ${clientOrderId}
    LIMIT 1
  `);
  const row = rowsOf(result)[0];
  if (!row) return null;
  return {
    id: String(row.id),
    status: (row.status as string | null) ?? null,
    total: String(row.total),
    paymentMethod: String(row.payment_method),
    createdAt: row.created_at ? new Date(row.created_at as string) : null,
    dateKind: (row.date_kind as string | null) ?? null,
  };
}

/**
 * Serialises every attempt at one sale reference until the transaction ends.
 * The second copy waits here, then finds the first copy's committed order.
 */
export async function lockSaleReference(tx: Executor, orgId: string, clientOrderId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sale-ref:${orgId}:${clientOrderId}`}, 0))`);
}

/** True when a write lost the race to the unique index on the reference. */
export function isSaleReferenceConflict(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === "object" && depth < 5; depth += 1) {
    const candidate = e as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === "23505") {
      const where = `${String(candidate.constraint ?? "")} ${String(candidate.message ?? "")}`;
      if (where.includes("orders_org_client_order_id_uq")) return true;
    }
    e = candidate.cause;
  }
  return false;
}

/** Thrown inside the create transaction when the lock-then-look finds the sale already recorded. */
export class SaleAlreadyRecordedError extends Error {
  constructor(public readonly sale: RecordedSale) {
    super("This sale is already recorded");
    this.name = "SaleAlreadyRecordedError";
  }
}

/**
 * The server looked at the sale and refused it. Answered 422 so the till knows
 * sending it again will not help, and hands it to a manager (Needs attention)
 * instead of retrying it for ever — which a plain 500 would cause.
 */
export class SaleRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleRefusedError";
  }
}

/**
 * The body a repeat gets: the original order, in the shape a first attempt's
 * 201 carries, marked as a repeat so the till can say so.
 */
export function alreadyRecordedResponse(sale: RecordedSale) {
  return {
    orderId: sale.id,
    duplicate: true,
    order: {
      id: sale.id,
      status: sale.status,
      total: sale.total,
      paymentMethod: sale.paymentMethod,
      createdAt: sale.createdAt,
      dateKind: sale.dateKind ?? "live",
    },
  };
}
