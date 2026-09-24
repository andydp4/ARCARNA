/**
 * v1.2.1 e2e — trying to break the till the way a busy shop does.
 *
 * Each test here is one thing a cashier, driver or manager really does on a
 * bad day: two tills selling the last one at once, a refund pressed twice, a
 * refund for a tab nobody has paid, a sale deleted after the drawer was
 * counted, a typo that adds four zeros, a double tap on "Open shift". Every
 * assertion is the outcome the shop needs, so a red test is a real bug with
 * its repro attached.
 *
 * API-level on purpose: the invariants are server-side, and the till's own
 * guards (a disabled button, a sale reference) are covered by
 * posDoubleSubmit.spec.ts in the browser.
 */
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { allowedUsers } from "@shared/schema";
import {
  apiAs,
  ensureOpenShift,
  expect,
  firstLocationId,
  locationStock,
  okJson,
  placeOrder,
  test,
  uniqueSuffix,
  waitForStock,
  type Role,
} from "./fixtures";

async function ownProduct(api: APIRequestContext, locationId: string, stock: number, price = 10) {
  const suffix = uniqueSuffix();
  const created = await okJson<{ id: string; name: string }>(
    await api.post("/api/products", {
      data: {
        name: `Hard Use ${suffix}`,
        productCode: `HU-${suffix}`.slice(0, 40),
        costPrice: 4,
        salePrice: price,
        defaultSalePrice: price,
        stock: 0,
        stockLimit: 1000,
      },
    }),
  );
  const seeded = await api.patch(`/api/inventory/${created.id}`, {
    headers: { "x-location-id": locationId },
    data: { adjustment: stock, type: "set" },
  });
  expect(seeded.status(), await seeded.text()).toBeLessThan(400);
  return created;
}

async function roleApi(role: Role, orgId: string) {
  return apiAs(role, orgId);
}

const freshIds: string[] = [];

/**
 * A member of staff of their own, for tests that open and close a drawer:
 * closing seed-cashier's shift would pull it out from under every other
 * journey running in parallel.
 */
async function freshStaff(role: "CASHIER" | "MANAGER", orgId: string): Promise<APIRequestContext> {
  const id = `e2e-hard-${role.toLowerCase()}-${uniqueSuffix()}`;
  await db.insert(allowedUsers).values({
    replitUserId: id,
    authUserId: id,
    authProvider: "replit",
    name: `Hard use ${role.toLowerCase()}`,
    email: `${id}@example.invalid`,
    role,
    orgId,
    isOwner: 0,
  });
  freshIds.push(id);
  return playwrightRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 5000}`,
    extraHTTPHeaders: {
      "x-test-replit-user-id": id,
      "x-test-secret": process.env.PHASE2D_TEST_SECRET ?? "journey-suite-local-secret",
      "x-org-id": orgId,
    },
  });
}

test.afterAll(async () => {
  // Shifts and orders keep their user id as plain text, so the access rows
  // can go; the till history they made stays, as any leaver's does.
  if (freshIds.length) await db.delete(allowedUsers).where(inArray(allowedUsers.replitUserId, freshIds));
});

async function orderLines(api: APIRequestContext, orderId: string) {
  const order = await okJson<{ items: Array<{ id: string; quantity: number | string }> }>(await api.get(`/api/orders/${orderId}`));
  return order.items;
}

async function complete(api: APIRequestContext, orderId: string) {
  const res = await api.post(`/api/orders/${orderId}/transition`, { data: { action: "complete" } });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe("hard use: two tills, one last unit", () => {
  test("two tills selling the last unit at once: the second is held, as it is when they sell one after the other", async ({ orgId }) => {
    const admin = await roleApi("ADMIN", orgId);
    const cashier = await freshStaff("CASHIER", orgId);
    const manager = await freshStaff("MANAGER", orgId);
    const locationId = await firstLocationId(admin);
    await ensureOpenShift(cashier, locationId);
    await ensureOpenShift(manager, locationId);
    const product = await ownProduct(admin, locationId, 1);

    const [a, b] = await Promise.all([
      placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }]),
      placeOrder(manager, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }]),
    ]);
    const bodies = [await okJson<any>(a), await okJson<any>(b)];
    const statuses = bodies.map((o) => o.order?.status);

    // One after the other, the second sale of a last unit comes back
    // "on-hold" with an "Insufficient stock" warning (money.spec 2.7). Two
    // tills pressing at the same moment both read stock 1 before the outbox
    // worker moved it, so both are recorded as ordinary pending sales…
    expect(
      statuses.filter((s) => s === "on-hold").length,
      `exactly one of the two sales of the last unit must be held for review; got ${JSON.stringify(statuses)}`,
    ).toBe(1);

    // …and the second sale's stock movement is then refused by the worker
    // ("Insufficient stock at location") and dropped: stock stays at 0, not
    // -1, so the oversell is invisible in Stock Truths as well.
    await waitForStock(admin, product.id, locationId, 0);
    await new Promise((r) => setTimeout(r, 4000));
    const soldTwice = bodies.every((o) => o.order?.status === "pending");
    const stock = await locationStock(admin, product.id, locationId);
    expect(
      soldTwice && stock === 0,
      "two recorded sales of one unit must not leave stock at 0 with one sale's movement silently dropped",
    ).toBe(false);

    await Promise.all([admin.dispose(), cashier.dispose(), manager.dispose()]);
  });
});

test.describe("hard use: refunds", () => {
  test("a refund pressed twice at once cannot refund the same unit twice", async ({ orgId }) => {
    const admin = await roleApi("ADMIN", orgId);
    const cashier = await roleApi("CASHIER", orgId);
    const locationId = await firstLocationId(admin);
    await ensureOpenShift(cashier, locationId);
    const a = await ownProduct(admin, locationId, 20);
    const b = await ownProduct(admin, locationId, 20);
    // Two lines, so the money ceiling (the order total) does not stop a
    // second refund of line A: only the per-line quantity check can.
    const placed = await okJson<any>(
      await placeOrder(cashier, locationId, [
        { productId: a.id, quantity: 1, unitPrice: 10 },
        { productId: b.id, quantity: 1, unitPrice: 10 },
      ]),
    );
    const orderId = placed.orderId;
    await complete(cashier, orderId);
    const lines = await orderLines(cashier, orderId);
    const lineA = lines[0].id;

    const results = await Promise.all(
      [0, 1].map(() =>
        cashier.post(`/api/orders/${orderId}/refunds`, {
          data: { reason: "damaged", refundMethod: "cash", lines: [{ orderLineId: lineA, qty: 1 }] },
        }),
      ),
    );
    const created = results.filter((r) => r.status() === 201).length;
    const list = await okJson<{ refunds: Array<{ lines: Array<{ orderLineId: string; qty: number }> }> }>(
      await cashier.get(`/api/orders/${orderId}/refunds`),
    );
    const refundedQtyA = list.refunds.flatMap((r) => r.lines).filter((l) => l.orderLineId === lineA).reduce((s, l) => s + l.qty, 0);
    expect(created, "only one of two simultaneous refunds of a single unit may succeed").toBe(1);
    expect(refundedQtyA, "a line of quantity 1 must never show 2 refunded").toBeLessThanOrEqual(1);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });

  test("refunding a credit (tick) sale nobody has paid does not hand out cash", async ({ orgId }) => {
    const admin = await roleApi("ADMIN", orgId);
    const cashier = await roleApi("CASHIER", orgId);
    const locationId = await firstLocationId(admin);
    const shiftId = await ensureOpenShift(cashier, locationId);
    const product = await ownProduct(admin, locationId, 20);
    // A free 07700 900xxx number: the duplicate check refuses one already on
    // file, so a fixed number fails the second run against the same database.
    let customer: { id: string } | null = null;
    for (let attempt = 0; attempt < 20 && !customer; attempt++) {
      const phone = `07700900${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
      const res = await admin.post("/api/customers", { data: { name: `Tab Refund ${uniqueSuffix()}`, phone } });
      if (res.status() === 409) continue;
      customer = await okJson<{ id: string }>(res);
    }
    if (!customer) throw new Error("no free 07700 900xxx number after 20 tries");
    const placed = await okJson<any>(
      await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }], "tick", {
        customerId: customer.id,
      }),
    );
    await complete(cashier, placed.orderId);
    const lines = await orderLines(cashier, placed.orderId);

    const cashBefore = (await okJson<any>(await cashier.get(`/api/shifts/${shiftId}/report`))).report.cashSummary;
    const refund = await cashier.post(`/api/orders/${placed.orderId}/refunds`, {
      data: { reason: "damaged", refundMethod: "original", lines: [{ orderLineId: lines[0].id, qty: 1 }] },
    });
    const cashAfter = (await okJson<any>(await cashier.get(`/api/shifts/${shiftId}/report`))).report.cashSummary;
    const refundBody = refund.ok() ? await refund.json() : null;

    // "Original" payment for a tick sale was never money in the drawer: the
    // route maps every non-cash original to cash, so £10 leaves the till for
    // goods that were never paid for — and the customer still owes £12.
    expect(
      refundBody?.refund?.refundMethod === "cash" && cashAfter.cashRefunds > cashBefore.cashRefunds,
      `refunding an unpaid tab paid out cash: ${JSON.stringify(refundBody?.refund ?? (await refund.text()))}`,
    ).toBe(false);

    const tabs = await okJson<Array<{ id: string; totalDebt: number }>>(await admin.get("/api/tick-customers"));
    const tab = tabs.find((t) => t.id === customer.id);
    if (refund.ok()) {
      // If a refund of an unpaid tab is allowed at all, it must come off
      // what they owe, not stay on the Credit List as well.
      expect(tab?.totalDebt ?? 0, "a refunded tab must not still be owed in full").toBeLessThan(12);
    }
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });

  test("a line sold by weight (0.5) can be refunded", async ({ orgId }) => {
    const admin = await roleApi("ADMIN", orgId);
    const cashier = await roleApi("CASHIER", orgId);
    const locationId = await firstLocationId(admin);
    await ensureOpenShift(cashier, locationId);
    const product = await ownProduct(admin, locationId, 20);
    const placed = await okJson<any>(
      await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 0.5, unitPrice: 10 }]),
    );
    await complete(cashier, placed.orderId);
    const lines = await orderLines(cashier, placed.orderId);

    const half = await cashier.post(`/api/orders/${placed.orderId}/refunds`, {
      data: { reason: "damaged", refundMethod: "cash", lines: [{ orderLineId: lines[0].id, qty: 0.5 }] },
    });
    const one = await cashier.post(`/api/orders/${placed.orderId}/refunds`, {
      data: { reason: "damaged", refundMethod: "cash", lines: [{ orderLineId: lines[0].id, qty: 1 }] },
    });
    // Sales take decimals (money.spec 2.10) but refunds take whole units
    // only, so 0.5 is refused as "Expected integer" and 1 as "more than
    // remaining": a weighed line can never be refunded at all.
    expect(
      [half.status(), one.status()].includes(201),
      `neither refund of a 0.5 line was accepted: ${await half.text()} / ${await one.text()}`,
    ).toBe(true);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });
});

test.describe("hard use: past days stay put", () => {
  test("deleting a sale after its drawer was counted does not rewrite that Z report", async ({ orgId }) => {
    const admin = await roleApi("ADMIN", orgId);
    const manager = await roleApi("MANAGER", orgId);
    const locationId = await firstLocationId(admin);
    // A person with no other open shift, so this drawer holds only this sale.
    const cashier = await freshStaff("CASHIER", orgId);
    const shiftId = await ensureOpenShift(cashier, locationId);
    const product = await ownProduct(admin, locationId, 20);
    const placed = await okJson<any>(await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }]));
    await complete(cashier, placed.orderId);
    const report = await okJson<any>(await cashier.get(`/api/shifts/${shiftId}/report`));
    const expectedCash = report.report.cashSummary.expectedCash;
    const closed = await cashier.post(`/api/shifts/${shiftId}/close`, { data: { closingCount: expectedCash } });
    expect(closed.status(), await closed.text()).toBe(200);
    const z1 = (await okJson<any>(await manager.get(`/api/shifts/${shiftId}/report`))).report.cashSummary;

    const del = await manager.delete(`/api/orders/${placed.orderId}`);
    const z2 = (await okJson<any>(await manager.get(`/api/shifts/${shiftId}/report`))).report.cashSummary;

    // The counted drawer is frozen: cashSales 12 → 0 while expectedCash
    // stays at what was counted, so the sheet no longer adds up.
    expect(
      { del: del.status(), cashSales: z2.cashSales },
      "a counted drawer's sales must not change after the count — refuse the delete, or refund instead",
    ).toEqual({ del: expect.any(Number), cashSales: z1.cashSales });
    expect(
      Math.round((z2.openingFloat + z2.cashSales - z2.cashRefunds + z2.cashTabRepayments) * 100) / 100,
      "the Z report must still add up after anything done to it later",
    ).toBe(z2.expectedCash);
    await Promise.all([admin.dispose(), manager.dispose(), cashier.dispose()]);
  });
});

test.describe("hard use: fat fingers and double taps", () => {
  test("a typo that makes a sale enormous is refused with a message, not a 500", async ({ orgId }) => {
    const admin = await roleApi("ADMIN", orgId);
    const cashier = await roleApi("CASHIER", orgId);
    const locationId = await firstLocationId(admin);
    await ensureOpenShift(cashier, locationId);
    const product = await ownProduct(admin, locationId, 20);
    // Each line passes validation (qty < 10,000, price < 1,000,000) but the
    // total overflows orders.total NUMERIC(10,2) at the database. A 500 is
    // also what makes an offline-queued sale retry for ever instead of going
    // to Needs attention.
    const res = await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 9999, unitPrice: 999_999 }]);
    expect(res.status(), await res.text()).toBe(400);
    const body = await res.json();
    expect(String(body.message ?? "")).not.toMatch(/Failed to create order/);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });

  test("a negative quantity is refused in plain words, not a JSON dump", async ({ orgId }) => {
    const admin = await roleApi("ADMIN", orgId);
    const cashier = await roleApi("CASHIER", orgId);
    const locationId = await firstLocationId(admin);
    await ensureOpenShift(cashier, locationId);
    const product = await ownProduct(admin, locationId, 20);
    const res = await placeOrder(cashier, locationId, [{ productId: product.id, quantity: -1, unitPrice: 10 }]);
    expect(res.status()).toBe(400);
    const body = await res.json();
    // The till shows `message` in its toast. It is currently the whole Zod
    // issue array serialised: `[\n  {\n    "code": "too_small", ...`.
    expect(String(body.message), "the till's toast text must be a sentence").not.toMatch(/^\s*\[/);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });

  test("a double tap on Open shift opens one shift and answers both taps without a 500", async ({ orgId }) => {
    const admin = await roleApi("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    // A fresh person, so there is no open shift to reuse.
    const cashier = await freshStaff("CASHIER", orgId);
    const taps = await Promise.all(
      [0, 1, 2].map(() =>
        cashier.post("/api/shifts/open", { headers: { "x-location-id": locationId }, data: { locationId, openingFloat: 50 } }),
      ),
    );
    const statuses = taps.map((t) => t.status());
    expect(statuses.filter((s) => s === 201).length, JSON.stringify(statuses)).toBe(1);
    expect(statuses.filter((s) => s >= 500), `a double tap must not 500: ${JSON.stringify(statuses)}`).toEqual([]);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });
});
