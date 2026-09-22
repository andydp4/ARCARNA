/**
 * A background job must run once, however many workers ask for it at the same
 * moment — and a loyalty earn must land once, however many times its event is
 * handled.
 *
 * Found through CI on PR #225: a journey saw a customer earn a sale's points
 * twice (1018 instead of 959). acquireJob claimed with a bare
 * SELECT ... FOR UPDATE SKIP LOCKED (autocommit, so the lock ended with the
 * statement) followed by a separate UPDATE; runTick runs several processJob
 * calls at once, and two could claim the same job. LoyaltyWorker then checked
 * its ledger and wrote an absolute balance with no lock, so both runs credited.
 *
 * Runs against a real database, in CI's unit-db job by explicit file name.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { customers, eventOutbox, jobQueue, loyaltyLedger, orders, organizations } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("background job claiming and loyalty earn", () => {
  let db: (typeof import("../db"))["db"];
  let orgId: string;
  const eventIds: string[] = [];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Job Claim Race Test" });
  });

  afterEach(async () => {
    if (eventIds.length) {
      await db.delete(jobQueue).where(inArray(jobQueue.eventId, eventIds));
      await db.delete(loyaltyLedger).where(inArray(loyaltyLedger.eventId, eventIds));
      await db.delete(eventOutbox).where(inArray(eventOutbox.eventId, eventIds));
      eventIds.length = 0;
    }
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(customers).where(eq(customers.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  /** The ledger references orders, so an earn needs a real order row. */
  async function orderFor(customerId: string, total: number) {
    const [order] = await db
      .insert(orders)
      .values({ orgId, customerId, total: total.toFixed(2), paymentMethod: "cash", status: "completed" } as never)
      .returning();
    return order.id as string;
  }

  async function outboxEvent(payload: Record<string, unknown>) {
    const eventId = randomUUID();
    eventIds.push(eventId);
    await db.insert(eventOutbox).values({
      eventId,
      eventType: "OrderCreated",
      correlationId: randomUUID(),
      payload,
      status: "dispatched",
    });
    return eventId;
  }

  it("hands one queued job to exactly one of many simultaneous claimers", async () => {
    const { acquireJob } = await import("../eventBus");
    const eventId = await outboxEvent({});
    // Oldest run_at in the queue, so it is the first thing any claimer takes.
    const [job] = await db
      .insert(jobQueue)
      .values({ eventId, workerName: "LoyaltyWorker", status: "queued", runAt: new Date("2000-01-01T00:00:00Z") })
      .returning();

    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => acquireJob(`race-${i}`)));

    // Other queued work in this database may be claimed by the other callers;
    // put it back exactly as it was.
    const others = claims.filter((c) => c && c.jobId !== job.jobId).map((c) => c!.jobId);
    if (others.length) {
      await db
        .update(jobQueue)
        .set({ status: "queued", lockedAt: null, lockedBy: null, attempts: sql`${jobQueue.attempts} - 1` })
        .where(inArray(jobQueue.jobId, others));
    }

    expect(claims.filter((c) => c?.jobId === job.jobId)).toHaveLength(1);
    const [after] = await db.select().from(jobQueue).where(eq(jobQueue.jobId, job.jobId));
    expect(after.status).toBe("running");
    expect(after.attempts).toBe(1);
  });

  it("credits a sale's points once even when its event is handled twice at the same moment", async () => {
    const { LoyaltyWorker } = await import("../workers/loyaltyWorker");
    const [customer] = await db
      .insert(customers)
      .values({ orgId, name: "Race Customer" })
      .returning();
    await db.update(customers).set({ loyaltyPoints: 900 }).where(eq(customers.id, customer.id));

    const orderId = await orderFor(customer.id, 59.4);
    const eventId = await outboxEvent({ customerId: customer.id, orderId, total: 59.4 });
    const envelope = {
      eventId,
      eventType: "OrderCreated" as const,
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      version: 1,
      payload: { customerId: customer.id, orderId, total: 59.4 },
    };

    const worker = new LoyaltyWorker();
    const results = await Promise.all([worker.handle(envelope), worker.handle(envelope), worker.handle(envelope)]);
    expect(results.every((r) => r.status === "success")).toBe(true);

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(row.loyaltyPoints).toBe(959);
    const ledger = await db.select().from(loyaltyLedger).where(eq(loyaltyLedger.eventId, eventId));
    expect(ledger).toHaveLength(1);
  });

  it("never loses one of two different earns landing on the same customer together", async () => {
    const { LoyaltyWorker } = await import("../workers/loyaltyWorker");
    const [customer] = await db.insert(customers).values({ orgId, name: "Two Sales Customer" }).returning();

    const envelopes = await Promise.all(
      [10, 20].map(async (total) => {
        const orderId = await orderFor(customer.id, total);
        const eventId = await outboxEvent({ customerId: customer.id, orderId, total });
        return {
          eventId,
          eventType: "OrderCreated" as const,
          occurredAt: new Date().toISOString(),
          correlationId: randomUUID(),
          version: 1,
          payload: { customerId: customer.id, orderId, total },
        };
      }),
    );

    const worker = new LoyaltyWorker();
    await Promise.all(envelopes.map((e) => worker.handle(e)));

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    expect(row.loyaltyPoints).toBe(30);
  });
});
