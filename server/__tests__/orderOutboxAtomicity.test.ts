/**
 * Integration test: event_outbox writes roll back with the apps/server transaction.
 * Requires DATABASE_URL. Skipped when unset.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { withTransaction } from "../../apps/server/src/db";
import { eventOutbox, jobQueue, REQUIRED_WORKERS } from "@shared/schema";
import { dispatchPendingEvents, publishEventTx } from "../eventBus";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("orderOutboxAtomicity", () => {
  it("rolls back outbox row when the transaction aborts", async () => {
    const { db: serverDb } = await import("../db");
    const correlationId = randomUUID();

    await expect(
      withTransaction(async (tx) => {
        await publishEventTx(
          tx,
          "OrderCreated",
          correlationId,
          { order: { orderId: correlationId } },
          { source: "test" },
        );
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const rows = await serverDb
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.correlationId, correlationId));
    expect(rows).toHaveLength(0);
  });

  it("persists outbox row when the transaction commits", async () => {
    const { db: serverDb } = await import("../db");
    const correlationId = randomUUID();

    await withTransaction(async (tx) => {
      await publishEventTx(
        tx,
        "OrderCreated",
        correlationId,
        { order: { orderId: correlationId } },
        { source: "test" },
      );
    });

    const rows = await serverDb
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.correlationId, correlationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");

    await serverDb.delete(eventOutbox).where(eq(eventOutbox.correlationId, correlationId));
  });

  it("creates at most one job per worker when dispatchers overlap", async () => {
    const { db: serverDb } = await import("../db");
    const eventId = randomUUID();
    const correlationId = randomUUID();
    const eventType = "OrderCreated" as const;

    await serverDb.insert(eventOutbox).values({
      eventId,
      eventType,
      occurredAt: new Date(),
      correlationId,
      actor: { type: "system", id: "test" },
      source: "test",
      version: 1,
      payload: { order: { orderId: correlationId } },
      status: "pending",
    });

    try {
      await Promise.all(Array.from({ length: 6 }, () => dispatchPendingEvents()));

      const jobs = await serverDb
        .select()
        .from(jobQueue)
        .where(eq(jobQueue.eventId, eventId));
      const workers = new Set(jobs.map((job) => job.workerName));
      const [outboxRow] = await serverDb
        .select()
        .from(eventOutbox)
        .where(eq(eventOutbox.eventId, eventId));

      expect(jobs).toHaveLength(REQUIRED_WORKERS[eventType].length);
      expect(workers.size).toBe(REQUIRED_WORKERS[eventType].length);
      expect(outboxRow?.status).toBe("dispatched");
    } finally {
      await serverDb.delete(jobQueue).where(eq(jobQueue.eventId, eventId));
      await serverDb.delete(eventOutbox).where(eq(eventOutbox.eventId, eventId));
    }
  });
});
