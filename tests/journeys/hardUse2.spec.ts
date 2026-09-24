/**
 * v1.2.1 e2e, second pass: more ways a busy shop breaks the till.
 *
 * hardUse.spec.ts covers two tills on one last unit, double refunds, tab
 * refunds, weighed refunds, counted drawers and fat fingers. This file adds
 * the rest of the brief's list: refunds of orders that were never paid or
 * were cancelled, a shift closed with a sale still in flight, an edit racing
 * a completion, 0p, emoji and very long names, and the receipt and invoice
 * those names end up on. Every assertion is the outcome the shop needs, so a
 * red test is a real bug with its repro attached.
 */
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { inArray, sql } from "drizzle-orm";
import { db } from "../../server/db";
import { allowedUsers } from "@shared/schema";
import {
  apiAs,
  ensureOpenShift,
  expect,
  firstLocationId,
  looksLikePdf,
  okJson,
  placeOrder,
  test,
  uniqueSuffix,
} from "./fixtures";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";
const SECRET = process.env.PHASE2D_TEST_SECRET ?? "journey-suite-local-secret";

async function ownProduct(api: APIRequestContext, locationId: string, stock: number, price = 10, name?: string) {
  const suffix = uniqueSuffix();
  const created = await okJson<{ id: string; name: string }>(
    await api.post("/api/products", {
      data: {
        name: name ?? `Hard Use Two ${suffix}`,
        productCode: `HU2-${suffix}`.slice(0, 40),
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

/** A fictional customer on a free 07700 900xxx number (the duplicate check refuses a number already on file). */
async function newCustomer(api: APIRequestContext, name: string): Promise<{ id: string }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const phone = `07700900${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    const res = await api.post("/api/customers", { data: { name, phone } });
    if (res.status() === 409) continue;
    return okJson<{ id: string }>(res);
  }
  throw new Error("no free 07700 900xxx number after 20 tries");
}

const freshIds: string[] = [];

/** A cashier of their own, so opening and closing their drawer disturbs nobody else's journey. */
async function freshCashier(orgId: string): Promise<{ id: string; api: APIRequestContext }> {
  const id = `e2e-hard2-${uniqueSuffix()}`;
  await db.insert(allowedUsers).values({
    replitUserId: id,
    authUserId: id,
    authProvider: "replit",
    name: "Hard use two cashier",
    email: `${id}@example.invalid`,
    role: "CASHIER",
    orgId,
    isOwner: 0,
  });
  freshIds.push(id);
  const api = await playwrightRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "x-test-replit-user-id": id, "x-test-secret": SECRET, "x-org-id": orgId },
  });
  return { id, api };
}

test.afterAll(async () => {
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

type CashSummary = { cashSales: number; cashRefunds: number; expectedCash: number };
async function cashSummary(api: APIRequestContext, shiftId: string): Promise<CashSummary> {
  return (await okJson<any>(await api.get(`/api/shifts/${shiftId}/report`))).report.cashSummary;
}

test.describe("hard use two: refunds of money never taken", () => {
  test("a Card (link) sale the customer has not paid yet cannot be refunded in cash", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    const { api: cashier } = await freshCashier(orgId);
    const shiftId = await ensureOpenShift(cashier, locationId);
    const product = await ownProduct(admin, locationId, 20);
    // Stripe cannot be reached from the test server, so the sale is taken as
    // card and its leg put in exactly the state a Card (link) sale has before
    // the customer pays: method card_link, status 'awaiting', no paid_at.
    const placed = await okJson<any>(await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }], "card"));
    await db.execute(sql`UPDATE order_payments SET method = 'card_link', status = 'awaiting', paid_at = NULL WHERE order_id = ${placed.orderId}`);
    await db.execute(sql`UPDATE orders SET payment_method = 'card_link' WHERE id = ${placed.orderId}`);
    const lines = await orderLines(cashier, placed.orderId);
    const before = await cashSummary(cashier, shiftId);
    const refund = await cashier.post(`/api/orders/${placed.orderId}/refunds`, {
      data: { reason: "damaged", refundMethod: "cash", lines: [{ orderLineId: lines[0].id, qty: 1 }] },
    });
    const after = await cashSummary(cashier, shiftId);
    expect(
      { status: refund.status() >= 400, cashRefundsDelta: Math.round((after.cashRefunds - before.cashRefunds) * 100) / 100 },
      `a refund of a Card (link) sale nobody has paid handed cash out of the drawer: ${await refund.text()}`,
    ).toEqual({ status: true, cashRefundsDelta: 0 });
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });

  test("refunding more units than were sold is refused", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    const { api: cashier } = await freshCashier(orgId);
    await ensureOpenShift(cashier, locationId);
    const product = await ownProduct(admin, locationId, 20);
    const placed = await okJson<any>(await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }]));
    await complete(cashier, placed.orderId);
    const lines = await orderLines(cashier, placed.orderId);
    const over = await cashier.post(`/api/orders/${placed.orderId}/refunds`, {
      data: { reason: "damaged", refundMethod: "cash", lines: [{ orderLineId: lines[0].id, qty: 3 }] },
    });
    expect(over.status()).toBe(400);
    const negative = await cashier.post(`/api/orders/${placed.orderId}/refunds`, {
      data: { reason: "damaged", refundMethod: "cash", lines: [{ orderLineId: lines[0].id, qty: -1 }] },
    });
    expect(negative.status()).toBe(400);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });
});

test.describe("hard use two: a shift closed with a sale in flight", () => {
  test("a sale completed after its drawer was counted does not change that count", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    const { api: cashier } = await freshCashier(orgId);
    const shiftId = await ensureOpenShift(cashier, locationId, 50);
    const product = await ownProduct(admin, locationId, 20);
    // Rung up, customer walks to the cashpoint; the drawer is counted meanwhile.
    const placed = await okJson<any>(await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }]));
    const closed = await okJson<any>(
      await cashier.post(`/api/shifts/${shiftId}/close`, { headers: { "x-location-id": locationId }, data: { closingCount: 50 } }),
    );
    const zAtClose: CashSummary = closed.report.cashSummary;
    // They come back and pay; the cashier completes the sale.
    const done = await cashier.post(`/api/orders/${placed.orderId}/transition`, {
      headers: { "x-location-id": locationId },
      data: { action: "complete" },
    });
    const zLater = await cashSummary(admin, shiftId);
    expect(
      { cashSales: zLater.cashSales, expectedCash: zLater.expectedCash },
      `a counted drawer's Z report moved after the count (complete answered ${done.status()}); the £10 belongs in the next drawer`,
    ).toEqual({ cashSales: zAtClose.cashSales, expectedCash: zAtClose.expectedCash });
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });

  test("closing a drawer while a sale is being rung up leaves the sale in some drawer's count", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    const { api: cashier } = await freshCashier(orgId);
    const shiftId = await ensureOpenShift(cashier, locationId, 0);
    const product = await ownProduct(admin, locationId, 50);
    const [close, sale] = await Promise.all([
      cashier.post(`/api/shifts/${shiftId}/close`, { headers: { "x-location-id": locationId }, data: { closingCount: 0 } }),
      placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: 7 }]),
    ]);
    expect(close.status(), await close.text()).toBe(200);
    if (!sale.ok()) return; // refused cleanly: nothing to count
    const order = await sale.json();
    const row = await okJson<any>(await admin.get(`/api/orders/${order.orderId}`));
    const sid = row.cashierShiftId ?? row.cashier_shift_id ?? row.shiftId ?? null;
    // Either the sale landed before the count (and is in it), or it lives in
    // a drawer that is still open. Never in a drawer counted without it.
    const closedReport = await cashSummary(admin, shiftId);
    const closeBody = await close.json();
    expect(
      closeBody.report.cashSummary.cashSales === closedReport.cashSales,
      `the counted Z report (${closeBody.report.cashSummary.cashSales}) differs from the same shift read afterwards (${closedReport.cashSales}); order shift ${sid}`,
    ).toBe(true);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });
});

test.describe("hard use two: an edit racing a completion", () => {
  test("a manager's edit and the till's completion at the same moment leave paid = total", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const manager = await apiAs("MANAGER", orgId);
    const locationId = await firstLocationId(admin);
    const { api: cashier } = await freshCashier(orgId);
    const shiftId = await ensureOpenShift(cashier, locationId, 0);
    const product = await ownProduct(admin, locationId, 50);
    const placed = await okJson<any>(await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }]));
    const [edit, done] = await Promise.all([
      manager.put(`/api/orders/${placed.orderId}`, { data: { lines: [{ productId: product.id, quantity: 3, unitPrice: 10 }] } }),
      cashier.post(`/api/orders/${placed.orderId}/transition`, { headers: { "x-location-id": locationId }, data: { action: "complete" } }),
    ]);
    const row = await okJson<any>(await admin.get(`/api/orders/${placed.orderId}`));
    const total = Number(row.total);
    const qty = (row.items as Array<any>).reduce((s, i) => s + Number(i.quantity), 0);
    const z = await cashSummary(admin, shiftId);
    // Whichever wins, the lines, the total and the cash taken must be one story:
    // the edit landed (3 units, £36 incl. VAT) or it did not (1 unit, £12).
    expect(
      { qty, total, cashSales: z.cashSales },
      `edit ${edit.status()} / complete ${done.status()}: the order, its lines and the drawer must agree`,
    ).toEqual(edit.ok() ? { qty: 3, total: 36, cashSales: 36 } : { qty: 1, total: 12, cashSales: 12 });
    await Promise.all([admin.dispose(), manager.dispose(), cashier.dispose()]);
  });
});

test.describe("hard use two: 0p, emoji and very long names", () => {
  test("a 0p line is accepted, completes, and adds nothing to the drawer", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    const { api: cashier } = await freshCashier(orgId);
    const shiftId = await ensureOpenShift(cashier, locationId, 0);
    const product = await ownProduct(admin, locationId, 20, 0);
    const res = await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: 0 }]);
    expect(res.status(), await res.text()).toBeLessThan(300);
    const placed = await res.json();
    const done = await cashier.post(`/api/orders/${placed.orderId}/transition`, { data: { action: "complete" } });
    expect(done.status(), await done.text()).toBe(200);
    const z = await cashSummary(cashier, shiftId);
    expect(z.cashSales).toBe(0);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });

  test("a negative price is refused, not sold as money out of the drawer", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    const { api: cashier } = await freshCashier(orgId);
    await ensureOpenShift(cashier, locationId, 0);
    const product = await ownProduct(admin, locationId, 20);
    const res = await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 1, unitPrice: -10 }]);
    expect(res.status(), await res.text()).toBe(400);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });

  test("emoji and a very long name survive the sale, the receipt and the invoice", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    const { api: cashier } = await freshCashier(orgId);
    await ensureOpenShift(cashier, locationId, 0);
    const longName = `🍕🔥 Très long gâteau ${"🎂".repeat(20)} ${"x".repeat(150)} ${uniqueSuffix()}`.slice(0, 250);
    const product = await ownProduct(admin, locationId, 20, 3.5, longName);
    const customer = await newCustomer(admin, `Zoë 🧁 O'Brien-Śmith ${uniqueSuffix()}`);
    const placed = await okJson<any>(
      await placeOrder(cashier, locationId, [{ productId: product.id, quantity: 2, unitPrice: 3.5 }], "cash", { customerId: customer.id }),
    );
    await complete(cashier, placed.orderId);
    const receipt = await cashier.get(`/api/orders/${placed.orderId}/receipt.pdf`);
    expect(receipt.status(), (await receipt.body()).toString().slice(0, 300)).toBe(200);
    expect(looksLikePdf(await receipt.body())).toBe(true);
    const inv = await admin.post(`/api/invoices/for-order/${placed.orderId}`);
    expect(inv.status(), await inv.text()).toBeLessThan(300);
    const invBody = await inv.json();
    const invId = invBody.id ?? invBody.invoice?.id;
    const pdf = await admin.get(`/api/invoices/${invId}/pdf`);
    expect(pdf.status(), (await pdf.body()).toString().slice(0, 300)).toBe(200);
    expect(looksLikePdf(await pdf.body())).toBe(true);
    await Promise.all([admin.dispose(), cashier.dispose()]);
  });

  test("an absurdly long product name is refused with a message, not a 500", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const res = await admin.post("/api/products", {
      data: { name: "y".repeat(20_000), productCode: `HU2L-${uniqueSuffix()}`, costPrice: 1, salePrice: 2, defaultSalePrice: 2, stock: 0 },
    });
    expect(res.status(), (await res.text()).slice(0, 300)).toBeLessThan(500);
    const cust = await admin.post("/api/customers", { data: { name: "z".repeat(20_000), phone: `07700900${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}` } });
    expect(cust.status(), (await cust.text()).slice(0, 300)).toBeLessThan(500);
    await admin.dispose();
  });
});

test.describe("hard use two: taps at the same instant", () => {
  test("Open shift tapped at once on several tills never answers with a 500", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    // Ten people, four taps each: the pre-check and the insert are not one
    // step, so the losers of the race hit the one-open-shift index and the
    // route answers "Failed to open shift" (500) instead of the 409 it gives
    // a tap that arrives a moment later.
    const people = await Promise.all(Array.from({ length: 10 }, () => freshCashier(orgId)));
    const statuses = (
      await Promise.all(
        people.map(({ api }) =>
          Promise.all(
            [0, 1, 2, 3].map(() =>
              api.post("/api/shifts/open", { headers: { "x-location-id": locationId }, data: { locationId, openingFloat: 20 } }),
            ),
          ),
        ),
      )
    ).map((taps) => taps.map((t) => t.status()));
    expect(statuses.flat().filter((s) => s >= 500), `statuses per person: ${JSON.stringify(statuses)}`).toEqual([]);
    for (const taps of statuses) expect(taps.filter((s) => s === 201).length).toBe(1);
    await Promise.all([admin.dispose(), ...people.map((p) => p.api.dispose())]);
  });

  test("the first sales of a shift rung up at once on two tablets both land", async ({ orgId }) => {
    const admin = await apiAs("ADMIN", orgId);
    const locationId = await firstLocationId(admin);
    const product = await ownProduct(admin, locationId, 100);
    // No shift open yet: a sale opens one (requireOpenShift). Two tablets
    // signed in as the same person press pay together.
    const people = await Promise.all(Array.from({ length: 6 }, () => freshCashier(orgId)));
    const statuses = (
      await Promise.all(
        people.map(({ api }) =>
          Promise.all([0, 1].map(() => placeOrder(api, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }]))),
        ),
      )
    ).map((sales) => sales.map((s) => s.status()));
    expect(statuses.flat().filter((s) => s >= 400), `statuses per person: ${JSON.stringify(statuses)}`).toEqual([]);
    await Promise.all([admin.dispose(), ...people.map((p) => p.api.dispose())]);
  });
});
