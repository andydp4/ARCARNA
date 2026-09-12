/**
 * `POST /api/orders/:id/transition` and the routes it shares this package
 * with (`/api/operations/*`, the completion/reopen halves of `PATCH
 * /api/orders/:id`) — API journeys (Phase N, N3b; docs/briefs/
 * PHASE_N_OPERATIONS_CENTRE.md "Test matrix").
 *
 * Server-side time is real throughout (docs/testing/FAKE_TIME.md) — nothing
 * here fakes a clock. Orders are created through `orderInState` (N8), which
 * places a REAL sale (a real product, a real shift) rather than an
 * empty-lines order no other journey in this suite ever sends.
 */
import { expect } from "@playwright/test";
import { db } from "../../server/db";
import { ensureOpenShift, firstLocationId, okJson, placeOrder, uniqueSuffix } from "./fixtures";
import { apiForUser, opsTest as test, orderInState } from "./opsFixtures";
import { createOrgB, destroyProvisioned, orgFingerprint } from "./security/tenants";

/**
 * A product this spec alone owns, for the two tests that need a REAL sale
 * with no promise attached (every `orderInState` recipe sends one at
 * creation, which would make `set_due` illegal — "a due time is already
 * set"). Mirrors `money.spec.ts`'s `sellableProduct`.
 */
async function sellableProduct(api: any, locationId: string): Promise<{ id: string }> {
  const suffix = uniqueSuffix();
  const created = await okJson<{ id: string }>(
    await api.post("/api/products", {
      data: {
        name: `Ops API Widget ${suffix}`,
        productCode: `OAW-${suffix}`.slice(0, 40),
        costPrice: 2,
        salePrice: 10,
        defaultSalePrice: 10,
        stock: 0,
        stockLimit: 1000,
      },
    }),
  );
  await api.patch(`/api/inventory/${created.id}`, {
    headers: { "x-location-id": locationId },
    data: { adjustment: 100, type: "set" },
  });
  return created;
}

test.describe("Order transitions — API journeys", () => {
  test.afterAll(async () => {
    await destroyProvisioned();
  });

  test("claim → ready → arrived → complete: monotonic stamps, read back from the board", async ({ api }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });

    const claim = await okJson<{ order: any; changed: boolean }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "claim" } }),
    );
    expect(claim.changed).toBe(true);
    expect(claim.order.assignedUserId).toBeTruthy();

    const ready = await okJson<{ order: any; changed: boolean }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "ready" } }),
    );
    expect(ready.changed).toBe(true);
    expect(ready.order.readyAt).toBeTruthy();
    expect(Date.parse(ready.order.readyAt)).toBeGreaterThanOrEqual(Date.parse(claim.order.assignedAt));

    const arrived = await okJson<{ order: any }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "arrived" } }),
    );
    expect(Date.parse(arrived.order.customerArrivedAt)).toBeGreaterThanOrEqual(Date.parse(ready.order.readyAt));

    const complete = await okJson<{ order: any; changed: boolean }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "complete" } }),
    );
    expect(complete.order.status).toBe("completed");
    expect(Date.parse(complete.order.settledAt)).toBeGreaterThanOrEqual(Date.parse(arrived.order.customerArrivedAt));

    const board = await okJson<{ orders: any[] }>(await api.get("/api/orders/board"));
    const boardRow = board.orders.find((o) => o.id === order.id);
    expect(boardRow?.status).toBe("completed");
  });

  test("repeating an idempotent stamp returns changed:false and no event", async ({ api }) => {
    const order = await orderInState(api, db, "on-time");

    const first = await okJson<{ changed: boolean }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "hold", reason: "test" } }),
    );
    expect(first.changed).toBe(true);
    const second = await okJson<{ changed: boolean; event: unknown }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "hold", reason: "test again" } }),
    );
    expect(second.changed).toBe(false);
    expect(second.event).toBeNull();
  });

  test("an illegal transition 409s and writes nothing (org fingerprint unchanged)", async ({ api, orgId }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });

    const before = await orgFingerprint(orgId);
    // "arrived" applies to collection orders; "out_for_delivery" does not.
    const res = await api.post(`/api/orders/${order.id}/transition`, { data: { action: "out_for_delivery" } });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ORDER_TRANSITION_INVALID");
    expect(await orgFingerprint(orgId)).toEqual(before);
  });

  test("claim conflict: the loser gets 409 naming the winner", async ({ api, cashierB }) => {
    const order = await orderInState(api, db, "on-time");

    const first = await api.post(`/api/orders/${order.id}/transition`, { data: { action: "claim" } });
    expect(first.status()).toBe(200);

    const apiB = await apiForUser(cashierB.userId, cashierB.orgId);
    const second = await apiB.post(`/api/orders/${order.id}/transition`, { data: { action: "claim" } });
    expect(second.status()).toBe(409);
    const body = await second.json();
    await apiB.dispose();

    expect(body.code).toBe("ORDER_ALREADY_ASSIGNED");
    expect(body.assignedUserId).toBeTruthy();
  });

  test("cross-tenant: org B gets 404 on the transition route, never a peek at org A's order", async ({ api }) => {
    const order = await orderInState(api, db, "on-time");

    const orgB = await createOrgB();
    const transitionRes = await orgB.api.post(`/api/orders/${order.id}/transition`, { data: { action: "claim" } });
    expect(transitionRes.status()).toBe(404);
    await orgB.api.dispose();
  });

  test("set_due (dueInMinutes) reads back as eta_given === original_eta on the board", async ({ api }) => {
    // Every `orderInState` recipe sends a promise at creation, which would
    // make `set_due` illegal here ("a due time is already set") — a plain
    // sale with no due-time chip chosen is the real case this covers.
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);
    const created = await okJson<{ orderId?: string; id?: string }>(
      await placeOrder(api, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }]),
    );
    const orderId = (created.orderId ?? created.id)!;

    const before = Date.now();
    const result = await okJson<{ order: any }>(
      await api.post(`/api/orders/${orderId}/transition`, { data: { action: "set_due", dueInMinutes: 20 } }),
    );
    expect(result.order.etaGiven).toBeTruthy();
    expect(result.order.originalEta).toBe(result.order.etaGiven);
    const dueAt = Date.parse(result.order.etaGiven);
    expect(dueAt).toBeGreaterThan(before + 19 * 60_000);
    expect(dueAt).toBeLessThan(before + 21 * 60_000);
  });

  test("expenses land on the order but never in its total", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);

    const created = await okJson<{ orderId?: string; id?: string; order?: { total?: string } }>(
      await placeOrder(api, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }], "cash", {
        expenses: [{ category: "delivery_fuel", description: "Fuel", amount: 3.5 }],
      }),
    );
    const orderId = (created.orderId ?? created.id)!;
    // The total charged to the customer is exactly the order's own reported
    // total (the sale, plus the org's tax rate) — never that plus the £3.50
    // fuel expense line.
    const createdTotal = parseFloat(String(created.order?.total ?? "0"));
    const detail = await okJson<{ total: string }>(await api.get(`/api/orders/${orderId}`));
    expect(parseFloat(detail.total)).toBeCloseTo(createdTotal, 2);
    expect(parseFloat(detail.total)).not.toBeCloseTo(createdTotal + 3.5, 2);
  });

  test("a re-completed order carries the new settlement and a resettled marker", async ({ api }) => {
    const order = await orderInState(api, db, "on-time");

    const firstComplete = await okJson<{ order: any }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "complete" } }),
    );
    expect(firstComplete.order.status).toBe("completed");

    const reopen = await okJson<{ order: any; event: { kind: string } | null }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "reopen" } }),
    );
    expect(reopen.order.status).not.toBe("completed");
    expect(reopen.event?.kind).toBe("reopened");

    const secondComplete = await okJson<{ order: any }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "complete" } }),
    );
    expect(secondComplete.order.status).toBe("completed");
    expect(Date.parse(secondComplete.order.settledAt)).toBeGreaterThan(Date.parse(firstComplete.order.settledAt));
  });

  // NOTE: this test closes TODAY's trading day for the shared seeded org —
  // there is no lightweight way to provision a fresh org with a location, a
  // product and an open shift just for one test, and every other journey in
  // this suite works in that same org. Harmless in CI (`workers: 1`, so
  // nothing else is mid-flight), but two local workers racing this file
  // against another that also depends on "today" being open in the seeded
  // org could interact. Flagged rather than hidden; a follow-up could sink a
  // `provisionFreshOrg()` helper into `security/tenants.ts` if this proves
  // troublesome locally.
  test("reopen after the trading day has closed refuses with ORDER_REOPEN_CLOSED_DAY", async ({ api, orgId }) => {
    const order = await orderInState(api, db, "on-time");

    const complete = await okJson<{ order: any }>(
      await api.post(`/api/orders/${order.id}/transition`, { data: { action: "complete" } }),
    );
    const settledAt = new Date(complete.order.settledAt);

    // Close the trading day the settlement fell on, exactly as the 06:00
    // scheduler would — imported directly, the same way security/tenants.ts
    // reaches into the server for setup no HTTP endpoint exposes.
    const { closeTradingDay } = await import("../../server/services/dailyClose");
    const { currentTradingDay } = await import("../../shared/time/tradingDay");
    const { orgTimeZone } = await import("../../server/services/tradingDayShift");
    const timeZone = await orgTimeZone(orgId);
    const tradingDay = currentTradingDay(timeZone, settledAt);
    await closeTradingDay(orgId, tradingDay, timeZone);

    const reopenRes = await api.post(`/api/orders/${order.id}/transition`, { data: { action: "reopen" } });
    expect(reopenRes.status()).toBe(409);
    const body = await reopenRes.json();
    expect(body.code).toBe("ORDER_REOPEN_CLOSED_DAY");
  });
});
