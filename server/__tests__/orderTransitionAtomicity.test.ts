/**
 * A mid-transaction failure must leave NO partial state — no `order_events`
 * row without the matching `orders` update, or vice versa (Phase N, N3b;
 * brief DoD "PATCH and transition produce identical rows"; stress
 * requirement "the atomicity test must prove a mid-transaction failure
 * leaves no partial state").
 *
 * `complete` on a tick sale with no customer is the real, reachable failure:
 * `completeOrderTx` (server/services/orderCompletion.ts) updates `orders`
 * to `status:'completed'` FIRST, then calls `openCreditForOrder`, which
 * throws `CREDIT_CUSTOMER_REQUIRED` — inside the SAME `withTransaction`. If
 * the transaction genuinely rolls back, the order must still read exactly as
 * it did before the call: `status` unchanged, `settled_total`/`settled_at`
 * still null, and no `completed` event.
 *
 * Runs against a real database — excluded from the no-DB run in
 * vitest.config.ts, included in `unit-db` by explicit file name.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db";
import { customers, orderEvents, orderPayments, orders, organizations } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { runOrderTransition } from "../services/orderTransitions";

const SUFFIX = Date.now().toString(36);
let orgId: string;

beforeAll(async () => {
  const [org] = await db.insert(organizations).values({ name: `tx-atomicity-${SUFFIX}` }).returning();
  orgId = org.id;
});

afterAll(async () => {
  if (!orgId) return;
  await db.delete(orderPayments).where(eq(orderPayments.orgId, orgId));
  await db.delete(orderEvents).where(eq(orderEvents.orgId, orgId));
  await db.delete(orders).where(eq(orders.orgId, orgId));
  await db.delete(customers).where(eq(customers.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("mid-transaction failure leaves no partial state", () => {
  it("complete on a tick sale with no customer: rolls back the status flip AND writes no event", async () => {
    const [order] = await db
      .insert(orders)
      .values({ orgId, total: "18.00", paymentMethod: "tick", customerId: null })
      .returning();
    // One tender leg for the whole total, on tick — the real shape a sale on
    // credit carries (server/routes/orders.ts's create route always writes
    // one, whatever the payment method).
    await db.insert(orderPayments).values({ orgId, orderId: order.id, method: "tick", amount: "18.00" });

    await expect(
      runOrderTransition({
        orgId,
        orderId: order.id,
        actor: { userId: "sam", role: "CASHIER" },
        input: { action: "complete" },
      }),
    ).rejects.toMatchObject({ code: "CREDIT_CUSTOMER_REQUIRED" });

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("pending");
    expect(row.settledTotal).toBeNull();
    expect(row.settledAt).toBeNull();
    expect(row.completedUserId).toBeNull();

    const events = await db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, order.id), eq(orderEvents.kind, "completed")));
    expect(events).toHaveLength(0);
  });

  it("the SAME order, given a customer, completes cleanly (the failure above was the credit check, not the order)", async () => {
    const [customer] = await (async () => {
      const { customers } = await import("@shared/schema");
      return db.insert(customers).values({ orgId, name: "Credit Customer" }).returning();
    })();
    const [order] = await db
      .insert(orders)
      .values({ orgId, total: "18.00", paymentMethod: "tick", customerId: customer.id })
      .returning();
    await db.insert(orderPayments).values({ orgId, orderId: order.id, method: "tick", amount: "18.00" });

    const result = await runOrderTransition({
      orgId,
      orderId: order.id,
      actor: { userId: "sam", role: "CASHIER" },
      input: { action: "complete" },
    });
    expect(result.order.status).toBe("completed");

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("completed");
    expect(row.settledTotal).toBe("18.00");

    const events = await db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.orgId, orgId), eq(orderEvents.orderId, order.id), eq(orderEvents.kind, "completed")));
    expect(events).toHaveLength(1);
  });
});
