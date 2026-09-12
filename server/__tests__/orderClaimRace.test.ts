/**
 * Proves a REAL race: two (and four) genuinely concurrent `claim` calls on
 * the same order resolve to exactly one winner (Phase N, N3b; brief DoD
 * "race proves one winner"). `SELECT … FOR UPDATE` inside `withTransaction`
 * (server/services/orderTransitions.ts) is what makes this a real lock
 * rather than a sequential test that merely looks like one: the requests are
 * fired with `Promise.all` so every connection reaches Postgres before any
 * of them commits, and the second (and third, and fourth) genuinely block on
 * the row lock rather than racing in application memory.
 *
 * Runs against a real database (imports ../db and apps/server/src/db), so it
 * is excluded from the no-DB run in vitest.config.ts and runs in the
 * `unit-db` CI job by explicit file name (server/__tests__/orderClaimRace.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db";
import { orderEvents, orders, organizations } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { runOrderTransition } from "../services/orderTransitions";
import { OrderAlreadyAssignedError } from "../services/orderTransitions";

const SUFFIX = Date.now().toString(36);
let orgId: string;

async function makeOpenOrder(): Promise<string> {
  const [order] = await db
    .insert(orders)
    .values({ orgId, total: "10.00", paymentMethod: "cash" })
    .returning();
  return order.id;
}

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `claim-race-${SUFFIX}` }).returning();
  orgId = org.id;
});

afterAll(async () => {
  if (!orgId) return;
  await db.delete(orderEvents).where(eq(orderEvents.orgId, orgId));
  await db.delete(orders).where(eq(orders.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("claim race", () => {
  it("two concurrent claims on the same order: exactly one wins, one 409s", async () => {
    const orderId = await makeOpenOrder();

    const results = await Promise.allSettled([
      runOrderTransition({ orgId, orderId, actor: { userId: "cashier-a", role: "CASHIER" }, input: { action: "claim" } }),
      runOrderTransition({ orgId, orderId, actor: { userId: "cashier-b", role: "CASHIER" }, input: { action: "claim" } }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OrderAlreadyAssignedError);

    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(["cashier-a", "cashier-b"]).toContain(row.assignedUserId);

    // Exactly one `assigned` event — the loser wrote nothing.
    const events = await db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId), eq(orderEvents.kind, "assigned")));
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBe(row.assignedUserId);
  });

  it("four concurrent claims on the same order: exactly one wins, three 409", async () => {
    const orderId = await makeOpenOrder();
    const actors = ["cashier-1", "cashier-2", "cashier-3", "cashier-4"];

    const results = await Promise.allSettled(
      actors.map((userId) =>
        runOrderTransition({ orgId, orderId, actor: { userId, role: "CASHIER" }, input: { action: "claim" } }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const r of rejected as PromiseRejectedResult[]) {
      expect(r.reason).toBeInstanceOf(OrderAlreadyAssignedError);
    }

    const events = await db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId), eq(orderEvents.kind, "assigned")));
    expect(events).toHaveLength(1);
  });

  it("claim publishes NO OrderStatusChanged and creates ZERO job_queue rows", async () => {
    const orderId = await makeOpenOrder();
    const { eventOutbox, jobQueue } = await import("@shared/schema");
    const { dispatchPendingEvents } = await import("../eventBus");
    const { inArray } = await import("drizzle-orm");

    await runOrderTransition({ orgId, orderId, actor: { userId: "cashier-a", role: "CASHIER" }, input: { action: "claim" } });

    const outboxRows = await db.select().from(eventOutbox).where(eq(eventOutbox.correlationId, orderId));
    expect(outboxRows.some((r) => r.eventType === "OrderStatusChanged")).toBe(false);
    expect(outboxRows.some((r) => r.eventType === "OrderStageChanged")).toBe(true);

    // Force the real dispatch step (ordinarily run by the worker runner on a
    // poll) so `REQUIRED_WORKERS.OrderStageChanged === []` is proved against
    // actual `job_queue` rows, not merely asserted never to have run.
    await dispatchPendingEvents();
    const eventIds = outboxRows.map((r) => r.eventId);
    const jobs = eventIds.length
      ? await db.select().from(jobQueue).where(inArray(jobQueue.eventId, eventIds))
      : [];
    expect(jobs).toHaveLength(0);
  });
});
