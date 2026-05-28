/**
 * Integration test: event_outbox writes roll back with the apps/server transaction.
 * Requires DATABASE_URL. Skipped when unset.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { withTransaction } from "../../apps/server/src/db";
import { eventOutbox } from "@shared/schema";
import { publishEventTx } from "../eventBus";

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
});
