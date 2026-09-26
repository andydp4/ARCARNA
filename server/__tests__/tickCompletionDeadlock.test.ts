/**
 * Completing a tick order while the loyalty worker earns points on it
 * (v1.2.1): the two must never deadlock.
 *
 * The CI flake (creditAtTill / creditCustomerDetail journeys, about one run
 * in four) was a real Postgres deadlock, 40P01, when an order was completed
 * straight after it was created and the loyalty worker was still handling
 * its OrderCreated event:
 *
 *   completion (PATCH /api/orders/:id)       loyalty worker (OrderCreated)
 *   1. orders row  FOR UPDATE                2. customers row FOR UPDATE
 *   3. INSERT order_credit → FK check takes  4. INSERT loyalty_ledger → FK check
 *      KEY SHARE on the customers row:          takes KEY SHARE on the orders
 *      waits for the worker (2)                 row: waits for completion (1)
 *
 * The worker now takes the orders row first (KEY SHARE) and the customers row
 * second (NO KEY UPDATE, all a balance change needs), the same order the
 * completion takes them in, so one simply waits for the other.
 *
 * A second deadlock hid behind the first, between two tick completions in
 * the same org at once (two tills, or the journeys running in parallel). Each
 * completion's `order_credit` insert takes KEY SHARE on the organizations row
 * (its org_id foreign key); the invoice number then locked that same row
 * FOR UPDATE. Two transactions each holding KEY SHARE and each asking to
 * upgrade to FOR UPDATE wait on each other. The invoice counter now takes
 * FOR NO KEY UPDATE, which still queues one invoice number behind the other
 * but does not conflict with a foreign-key check.
 *
 * Each deadlock gets a case that forces its exact interleaving and a case
 * that races the real code many times over. In CI's unit-db job by file name;
 * `../db` is imported inside beforeAll, so the no-DATABASE_URL run skips it.
 */
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("tick-order completion never deadlocks", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let withTransaction: (typeof import("../../apps/server/src/db"))["withTransaction"];
  let rawOrders: (typeof import("../../apps/server/src/db/schema"))["orders"];
  let completeOrderTx: (typeof import("../services/orderCompletion"))["completeOrderTx"];
  let LoyaltyWorker: (typeof import("../workers/loyaltyWorker"))["LoyaltyWorker"];
  let issueInvoiceForOrder: (typeof import("../services/invoices"))["issueInvoiceForOrder"];
  const orgId = randomUUID();
  const customerId = randomUUID();
  const orderIds: string[] = [];

  beforeAll(async () => {
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    ({ withTransaction } = await import("../../apps/server/src/db"));
    ({ orders: rawOrders } = await import("../../apps/server/src/db/schema"));
    ({ completeOrderTx } = await import("../services/orderCompletion"));
    ({ LoyaltyWorker } = await import("../workers/loyaltyWorker"));
    ({ issueInvoiceForOrder } = await import("../services/invoices"));
    await db.insert(schema.organizations).values({ id: orgId, name: "ZZ Tick Deadlock Test" });
    await db.insert(schema.customers).values({ id: customerId, orgId, name: "Tab Tester" });
  });

  afterAll(async () => {
    if (!db) return;
    const ids = orderIds.length ? orderIds : [randomUUID()];
    await db.delete(schema.loyaltyLedger).where(eq(schema.loyaltyLedger.customerId, customerId));
    await db.delete(schema.invoices).where(eq(schema.invoices.orgId, orgId));
    await db.delete(schema.orderCredit).where(eq(schema.orderCredit.orgId, orgId));
    await db.delete(schema.orderEvents).where(inArray(schema.orderEvents.orderId, ids));
    await db.delete(schema.orders).where(eq(schema.orders.orgId, orgId));
    await db.delete(schema.customers).where(eq(schema.customers.id, customerId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  async function newTickOrder(): Promise<string> {
    const orderId = randomUUID();
    orderIds.push(orderId);
    await db.insert(schema.orders).values({
      id: orderId,
      orgId,
      customerId,
      total: "20.00",
      paymentMethod: "tick",
      status: "pending",
    } as never);
    return orderId;
  }

  function orderCreated(orderId: string) {
    return {
      eventId: randomUUID(),
      eventType: "OrderCreated" as const,
      occurredAt: new Date().toISOString(),
      correlationId: orderId,
      version: 1,
      payload: { order: { orderId, customerId, totals: { total: 20 } } },
    };
  }

  /** Lock the order, run `between`, then complete it — the PATCH route's own shape. */
  function complete(orderId: string, between: () => Promise<void> = async () => {}) {
    return withTransaction(async (tx: any) => {
      const [row] = await tx.select().from(rawOrders).where(eq(rawOrders.id, orderId)).for("update").limit(1);
      await between();
      return completeOrderTx(tx, row, { userId: null, role: "CASHIER" });
    });
  }

  /** Waits until some backend in this database is blocked on a lock. */
  async function someoneWaitsOnALock() {
    for (let i = 0; i < 200; i++) {
      const result: any = await db.execute(sql`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`);
      const n = (result.rows ?? result)[0]?.n ?? 0;
      if (n > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("nobody ever waited on a lock");
  }

  async function expectSettled(orderId: string) {
    const [credit] = await db.select().from(schema.orderCredit).where(eq(schema.orderCredit.orderId, orderId));
    expect(credit?.status).toBe("outstanding");
    const earned = await db.select().from(schema.loyaltyLedger).where(eq(schema.loyaltyLedger.orderId, orderId));
    expect(earned).toHaveLength(1);
  }

  it("completes while the worker is mid-earn on the same order, with no deadlock", async () => {
    const orderId = await newTickOrder();
    const worker = new LoyaltyWorker();
    let earn: ReturnType<InstanceType<typeof LoyaltyWorker>["handle"]> | null = null;

    // Completion holds the orders row; the worker starts its earn and blocks;
    // only then does completion go on to open the credit.
    const completion = complete(orderId, async () => {
      earn = worker.handle(orderCreated(orderId) as never);
      await someoneWaitsOnALock();
    });

    const [completed, earned] = await Promise.allSettled([completion, completion.then(() => earn!)]);
    expect(completed.status, String((completed as PromiseRejectedResult).reason?.message)).toBe("fulfilled");
    const result = (earned as PromiseFulfilledResult<any>).value;
    expect(result.status, result.error).toBe("success");
    await expectSettled(orderId);
  });

  it("races completion and the earn 40 times without a single deadlock", async () => {
    const worker = new LoyaltyWorker();
    const failures: string[] = [];
    for (let i = 0; i < 40; i++) {
      const orderId = await newTickOrder();
      const [completed, earned] = await Promise.allSettled([
        complete(orderId),
        worker.handle(orderCreated(orderId) as never),
      ]);
      if (completed.status === "rejected") failures.push(`completion: ${completed.reason?.cause?.code ?? completed.reason?.code} ${completed.reason?.cause?.message ?? completed.reason?.message}`);
      if (earned.status === "fulfilled" && earned.value.status !== "success") {
        failures.push(`earn: ${earned.value.error}`);
      }
      if (failures.length === 0) await expectSettled(orderId);
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it("numbers two tick invoices in one org at once, each after its credit's foreign-key check", async () => {
    const [a, b] = [await newTickOrder(), await newTickOrder()];
    let arrived = 0;
    let release!: () => void;
    const bothHoldTheirKeyShare = new Promise<void>((r) => (release = r));

    // Each transaction opens its tab first (the insert's foreign-key check
    // takes KEY SHARE on the organizations row), waits for the other to do
    // the same, then numbers its invoice — the order completion runs them in.
    const settle = (orderId: string) =>
      withTransaction(async (tx: any) => {
        await tx.insert(schema.orderCredit).values({
          orderId,
          orgId,
          customerId,
          amountGiven: "20.00",
          amountOutstanding: "20.00",
          status: "outstanding",
          givenOn: "2026-09-24",
        });
        if (++arrived === 2) release();
        await bothHoldTheirKeyShare;
        return issueInvoiceForOrder(tx, orgId, orderId);
      });

    const results = await Promise.allSettled([settle(a), settle(b)]);
    const errors = results.flatMap((r) =>
      r.status === "rejected" ? [`${r.reason?.cause?.code ?? r.reason?.code} ${r.reason?.cause?.message ?? r.reason?.message}`] : [],
    );
    expect(errors).toEqual([]);
    const numbers = results.map((r) => (r as PromiseFulfilledResult<any>).value.sequenceNumber);
    expect(new Set(numbers).size).toBe(2);
  });

  it("completes six tick orders in one org at once, ten times over, without a deadlock", async () => {
    const failures: string[] = [];
    for (let round = 0; round < 10; round++) {
      const ids = await Promise.all(Array.from({ length: 6 }, () => newTickOrder()));
      const results = await Promise.allSettled(ids.map((orderId) => complete(orderId)));
      for (const r of results) {
        if (r.status === "rejected") {
          failures.push(`${r.reason?.cause?.code ?? r.reason?.code} ${r.reason?.cause?.message ?? r.reason?.message}`);
        }
      }
    }
    expect(failures).toEqual([]);
    const numbers = await db
      .select({ n: schema.invoices.sequenceNumber })
      .from(schema.invoices)
      .where(eq(schema.invoices.orgId, orgId));
    expect(new Set(numbers.map((r) => r.n)).size).toBe(numbers.length);
  }, 180_000);
});
