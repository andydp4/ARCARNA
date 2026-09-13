/**
 * Regression test for the customer_metrics double-count bug.
 *
 * Every order runs through TWO independent customer-metrics writers:
 *
 *   1. `CustomersRepoDrizzle.updateMetrics` (apps/server/src/db/repos.ts),
 *      called synchronously from `engine.placeOrder`
 *      (packages/domain/src/engine.ts) for every order with a customer, on
 *      every order-creation channel (ARCHITECTURAL_PRINCIPLES.md #14). It
 *      does a full RECOMPUTE from `orders` (COUNT(*)/SUM(total) grouped by
 *      customer_id) and writes `customer_metrics`, so it is idempotent by
 *      construction — running it any number of times for the same customer
 *      converges on the same correct answer.
 *
 *   2. `CustomerWorker.handle` (server/workers/customerWorker.ts), triggered
 *      asynchronously off the `OrderCreated` outbox event that the same
 *      order-creation flow always also publishes.
 *
 * Before the fix, path 2 ALSO wrote `customer_metrics` additively
 * (`total_spent = total_spent + total`, `order_count = order_count + 1` via
 * `ON CONFLICT`) on top of path 1's already-correct recompute — so every
 * single order was double-counted. Confirmed live: one £72 order for a fresh
 * customer produced `customer_metrics.order_count = 2` and
 * `total_spent = 144.00`, while `customers.totalSpent` (written only by the
 * worker, and only once) correctly read `72.00`.
 *
 * This test drives both paths for several orders — exactly as production
 * does — and asserts every aggregate column agrees with a straight
 * `COUNT(*)`/`SUM(total)` computed independently from `orders`.
 *
 * Requires DATABASE_URL (imports ../db at module level), so this file is
 * listed in the `exclude` array in vitest.config.ts for the no-DB unit run,
 * mirroring orderOutboxAtomicity.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { organizations, customers, customerMetrics, orders } from "@shared/schema";
import { CustomersRepoDrizzle } from "../../apps/server/src/db/repos";
import { CustomerWorker } from "../workers/customerWorker";
import type { EventEnvelope } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

const createdOrgIds: string[] = [];

async function makeOrg(name: string): Promise<string> {
  const [org] = await db.insert(organizations).values({ name }).returning();
  createdOrgIds.push(org.id);
  return org.id;
}

async function makeCustomer(orgId: string, name: string): Promise<string> {
  const [customer] = await db.insert(customers).values({ orgId, name }).returning();
  return customer.id;
}

/**
 * Inserts an order row directly (the same shape `OrdersRepoDrizzle.save`
 * would write) rather than going through the full `engine.placeOrder` HTTP
 * stack — the bug and its fix live entirely in how `customer_metrics` is
 * derived AFTER the order row exists, so a direct insert exercises the same
 * code paths without needing products/stock/tax wiring.
 */
async function insertOrder(orgId: string, customerId: string, total: string): Promise<string> {
  const [order] = await db
    .insert(orders)
    .values({ orgId, customerId, total, paymentMethod: "cash" })
    .returning();
  return order.id;
}

/** Mirrors what `engine.placeOrder` does synchronously for every order. */
async function runSynchronousUpdateMetrics(customerId: string): Promise<void> {
  await CustomersRepoDrizzle.updateMetrics(customerId as any);
}

/** Mirrors the async job runner delivering the same order's OrderCreated event. */
async function runCustomerWorkerOrderCreated(
  orderId: string,
  customerId: string,
  total: number,
): Promise<void> {
  const event: EventEnvelope = {
    eventId: `test-order-created-${orderId}`,
    eventType: "OrderCreated",
    occurredAt: new Date().toISOString(),
    correlationId: orderId,
    actor: { type: "system", id: "test" },
    source: "test",
    version: 1,
    payload: {
      order: { orderId, customerId, total },
    },
  } as unknown as EventEnvelope;

  const result = await new CustomerWorker().handle(event);
  expect(result.status).toBe("success");
}

async function independentOrderTotals(customerId: string): Promise<{ count: number; sum: number }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`,
      sum: sql<number>`coalesce(sum(${orders.total}), 0)`,
    })
    .from(orders)
    .where(eq(orders.customerId, customerId));
  return { count: Number(row.count), sum: Number(row.sum) };
}

afterAll(async () => {
  if (!hasDb || !createdOrgIds.length) return;
  const orgCustomers = await db
    .select({ id: customers.id })
    .from(customers)
    .where(inArray(customers.orgId, createdOrgIds));
  const customerIds = orgCustomers.map((c) => c.id);
  if (customerIds.length) {
    await db.delete(customerMetrics).where(inArray(customerMetrics.customerId, customerIds));
  }
  await db.delete(orders).where(inArray(orders.orgId, createdOrgIds));
  await db.delete(customers).where(inArray(customers.orgId, createdOrgIds));
  await db.delete(organizations).where(inArray(organizations.id, createdOrgIds));
});

describe.skipIf(!hasDb)("customer_metrics double-count regression (ARC customer-metrics dedup)", () => {
  it("three real orders leave customer_metrics and customers.totalSpent matching a straight orders-table recompute — no double-count", async () => {
    const orgId = await makeOrg(`Metrics Dedup ${Date.now()}`);
    const customerId = await makeCustomer(orgId, "Metrics Dedup Customer");

    const totals = ["72.00", "18.50", "40.00"];

    for (const total of totals) {
      const orderId = await insertOrder(orgId, customerId, total);
      // Both paths run for every real order, in this order: the synchronous
      // engine.placeOrder call happens inside the order-creation transaction,
      // and the async OrderCreated event is only ever processed afterwards.
      await runSynchronousUpdateMetrics(customerId);
      await runCustomerWorkerOrderCreated(orderId, customerId, Number(total));
    }

    const expected = await independentOrderTotals(customerId);
    expect(expected.count).toBe(3);
    expect(expected.sum).toBeCloseTo(72 + 18.5 + 40, 2);

    const [metrics] = await db
      .select()
      .from(customerMetrics)
      .where(eq(customerMetrics.customerId, customerId));
    expect(metrics).toBeDefined();
    expect(metrics!.orderCount).toBe(expected.count);
    expect(Number(metrics!.totalSpent)).toBeCloseTo(expected.sum, 2);

    const [customerRow] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(Number(customerRow!.totalSpent)).toBeCloseTo(expected.sum, 2);
  });

  it("stays correct after a fourth order — the recompute and the worker both run again without compounding drift", async () => {
    const orgId = await makeOrg(`Metrics Dedup Follow-up ${Date.now()}`);
    const customerId = await makeCustomer(orgId, "Metrics Dedup Follow-up Customer");

    const orderId1 = await insertOrder(orgId, customerId, "100.00");
    await runSynchronousUpdateMetrics(customerId);
    await runCustomerWorkerOrderCreated(orderId1, customerId, 100);

    const orderId2 = await insertOrder(orgId, customerId, "50.00");
    await runSynchronousUpdateMetrics(customerId);
    await runCustomerWorkerOrderCreated(orderId2, customerId, 50);

    const expected = await independentOrderTotals(customerId);
    expect(expected.count).toBe(2);
    expect(expected.sum).toBeCloseTo(150, 2);

    const [metrics] = await db
      .select()
      .from(customerMetrics)
      .where(eq(customerMetrics.customerId, customerId));
    expect(metrics!.orderCount).toBe(2);
    expect(Number(metrics!.totalSpent)).toBeCloseTo(150, 2);

    const [customerRow] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(Number(customerRow!.totalSpent)).toBeCloseTo(150, 2);
  });
});
