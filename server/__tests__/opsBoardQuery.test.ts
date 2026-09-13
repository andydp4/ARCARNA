/**
 * The board's read side reflects what N3b's transitions actually wrote
 * (Phase N, N3b; server/services/opsBoard.ts read against real transition
 * output). N3a's own `orderBoardRoute.test.ts` proved the query shape before
 * any of these columns had a writer; this proves the two sides agree now
 * that one exists — a stage stamp, an assignment, and a completion, each
 * read back through `getOpsBoardOrder` exactly as the transition left it.
 *
 * Runs against a real database — excluded from the no-DB run in
 * vitest.config.ts, included in `unit-db` by explicit file name.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db";
import { orderEvents, orders, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { runOrderTransition } from "../services/orderTransitions";
import { getOpsBoardOrder } from "../services/opsBoard";

const SUFFIX = Date.now().toString(36);
let orgId: string;

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `ops-board-query-${SUFFIX}` }).returning();
  orgId = org.id;
});

afterAll(async () => {
  if (!orgId) return;
  await db.delete(orderEvents).where(eq(orderEvents.orgId, orgId));
  await db.delete(orders).where(eq(orders.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

async function makeOrder(overrides: Partial<typeof orders.$inferInsert> = {}) {
  const [order] = await db
    .insert(orders)
    .values({ orgId, total: "15.00", paymentMethod: "cash", ...overrides })
    .returning();
  return order.id;
}

describe("getOpsBoardOrder reflects real transitions", () => {
  it("claim → ready → arrived, on a collection order", async () => {
    const orderId = await makeOrder({ fulfilmentMethod: "collection" });

    await runOrderTransition({ orgId, orderId, actor: { userId: "sam", role: "CASHIER" }, input: { action: "claim" } });
    await runOrderTransition({ orgId, orderId, actor: { userId: "sam", role: "CASHIER" }, input: { action: "ready" } });
    await runOrderTransition({ orgId, orderId, actor: { userId: "sam", role: "CASHIER" }, input: { action: "arrived" } });

    const board = await getOpsBoardOrder(orgId, orderId);
    expect(board).not.toBeNull();
    expect(board!.assignedUserId).toBe("sam");
    expect(board!.readyAt).not.toBeNull();
    expect(board!.customerArrivedAt).not.toBeNull();
    expect(board!.status).not.toBe("completed");
  });

  it("out_for_delivery on a delivery order implicitly stamps ready_at too", async () => {
    const orderId = await makeOrder({ fulfilmentMethod: "delivery" });
    await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "out_for_delivery" },
    });
    const board = await getOpsBoardOrder(orgId, orderId);
    expect(board!.readyAt).not.toBeNull();
    expect(board!.outForDeliveryAt).not.toBeNull();
    expect(board!.assignedUserId).toBe("sam"); // auto-claimed
  });

  it("hold → unhold restores the prior status and clears held_at", async () => {
    const orderId = await makeOrder();
    await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "hold", reason: "waiting on stock" },
    });
    let board = await getOpsBoardOrder(orgId, orderId);
    expect(board!.heldAt).not.toBeNull();
    expect(board!.status).toBe("on-hold");

    await runOrderTransition({ orgId, orderId, actor: { userId: "sam", role: "CASHIER" }, input: { action: "unhold" } });
    board = await getOpsBoardOrder(orgId, orderId);
    expect(board!.heldAt).toBeNull();
    expect(board!.status).toBe("pending");
  });

  it("complete settles the order and the board carries the completer's name and settledAt", async () => {
    const orderId = await makeOrder();
    const result = await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "complete" },
    });
    expect(result.order.status).toBe("completed");
    expect(result.order.settledAt).not.toBeNull();
    expect(result.order.completedUserId).toBe("sam");

    const board = await getOpsBoardOrder(orgId, orderId);
    expect(board!.status).toBe("completed");
    expect(board!.completedUserId).toBe("sam");
    expect(board!.handoverAt).toBe(board!.settledAt);
  });

  it("a resettle with no new actualAt reports the current settlement's time, not a stale earlier override", async () => {
    const orderId = await makeOrder();

    // First completion carries a driver-reported actualAt well in the past —
    // the ordinary "delivered a bit before the tap" case.
    const staleActualAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString();
    await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "complete", actualAt: staleActualAt },
    });

    // Reopened (e.g. to fix a line-item error) and re-completed normally,
    // with no actualAt override this time — the common resettle case.
    await runOrderTransition({ orgId, orderId, actor: { userId: "sam", role: "CASHIER" }, input: { action: "reopen" } });
    await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "complete" },
    });

    const board = await getOpsBoardOrder(orgId, orderId);
    // The current completion has no actualAt, so the board must fall through
    // to the order's own settledAt — never reach past the current completion
    // into the superseded one's stale actualAt.
    expect(board!.handoverAt).toBe(board!.settledAt);
    expect(board!.handoverAt).not.toBe(staleActualAt);
  });

  it("set_due writes eta_given and original_eta together on first write", async () => {
    const orderId = await makeOrder();
    await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "set_due", dueInMinutes: 30 },
    });
    const board = await getOpsBoardOrder(orgId, orderId);
    expect(board!.etaGiven).not.toBeNull();
    expect(board!.originalEta).toBe(board!.etaGiven);

    // A second `set_due` is illegal — the promise already exists.
    await expect(
      runOrderTransition({
        orgId,
        orderId,
        actor: { userId: "sam", role: "CASHIER" },
        input: { action: "set_due", dueInMinutes: 45 },
      }),
    ).rejects.toMatchObject({ code: "ORDER_TRANSITION_INVALID" });
  });

  it("repeating an idempotent stamp reports changed:false and writes no second event", async () => {
    const orderId = await makeOrder();
    const first = await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "ready" },
    });
    expect(first.changed).toBe(true);

    const second = await runOrderTransition({
      orgId,
      orderId,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "ready" },
    });
    expect(second.changed).toBe(false);
    expect(second.event).toBeNull();

    const { and } = await import("drizzle-orm");
    const events = await db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, orderId), eq(orderEvents.kind, "ready")));
    expect(events).toHaveLength(1);
  });
});
