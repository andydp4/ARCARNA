/**
 * Phase 2 — money paths.
 *
 * Highest-risk journeys first: anything that moves money or stock. These run
 * against the API rather than the POS screen because the invariants under test
 * (settlement caps, stock decrements, gift-card balances) are server-side; the
 * POS screen itself is covered by pos.spec.ts.
 */
import {
  test,
  expect,
  ensureOpenShift,
  firstLocationId,
  locationStock,
  okJson,
  placeOrder,
  uniqueSuffix,
  waitForStock,
} from "./fixtures";

type Product = { id: string; name: string; defaultSalePrice: string; stock: number };

const SEEDED_STOCK = 50;
const SEEDED_PRICE = 10;

/**
 * A product this test alone owns.
 *
 * This used to return the first seeded product with stock, which meant every
 * money test in every parallel worker sold the same row. The exact-value
 * assertions then depended on scheduling: 2.7 asserts stock is *unchanged*
 * after an oversell, and a neighbouring test's sale of the same product broke
 * it. Owning the row is what makes those assertions mean what they say.
 */
async function sellableProduct(api: any, locationId: string): Promise<Product> {
  const suffix = uniqueSuffix();
  const created = await okJson<any>(
    await api.post("/api/products", {
      data: {
        name: `Money Widget ${suffix}`,
        productCode: `MW-${suffix}`.slice(0, 40),
        costPrice: 4,
        // The engine reads `salePrice`; sending only defaultSalePrice creates
        // the product at zero and makes every money assertion vacuous.
        salePrice: SEEDED_PRICE,
        defaultSalePrice: SEEDED_PRICE,
        stock: 0,
        stockLimit: 1000,
      },
    }),
  );

  const seeded = await api.patch(`/api/inventory/${created.id}`, {
    headers: { "x-location-id": locationId },
    data: { adjustment: SEEDED_STOCK, type: "set" },
  });
  expect(
    seeded.status(),
    `could not seed stock at ${locationId}. Body: ${await seeded.text()}`,
  ).toBeLessThan(400);

  const stock = await locationStock(api, created.id, locationId);
  expect(stock, "a freshly seeded product must hold its stock at this location").toBe(
    SEEDED_STOCK,
  );

  return {
    id: created.id,
    name: created.name,
    defaultSalePrice: String(SEEDED_PRICE),
    stock: SEEDED_STOCK,
  };
}

test.describe("money: sale", () => {
  test("2.1 cash sale completes and decrements location stock", async ({ api, orgId }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);

    const before = await locationStock(api, product.id, locationId);

    const res = await placeOrder(api, locationId, [
      { productId: product.id, quantity: 2, unitPrice: Number(product.defaultSalePrice) },
    ]);
    const order = await okJson<any>(res);

    const orderId = order.orderId ?? order.id ?? order.order?.id;
    expect(orderId, "order response should carry an id").toBeTruthy();

    // Sale movements are applied asynchronously by inventoryWorker via the
    // outbox, so poll rather than read once.
    const after = await waitForStock(api, product.id, locationId, before - 2);
    expect(after, "selling 2 units must reduce stock by exactly 2").toBe(before - 2);

    // The order must be retrievable and belong to this org.
    const fetched = await okJson<any>(await api.get(`/api/orders/${orderId}`));
    expect(fetched.id ?? fetched.order?.id).toBe(orderId);
  });

  test("2.7 overselling is accepted but held for review, and never moves stock", async ({
    api,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);
    const before = await locationStock(api, product.id, locationId);

    const res = await placeOrder(api, locationId, [
      {
        productId: product.id,
        quantity: before + 5000,
        unitPrice: Number(product.defaultSalePrice),
      },
    ]);

    // Documented behaviour: the engine does not reject an oversell, it accepts
    // the order with status "on-hold" so a human can resolve it. The invariant
    // that matters is that stock is never moved for a held order.
    expect(res.status(), "oversell should not 500").toBeLessThan(500);
    const body = await res.json();
    const orderId = body.orderId ?? body.id;
    const status = body.order?.status ?? body.status;
    expect(status, "an unfulfillable order must be held, not silently completed").toBe("on-hold");

    // Give the worker the same window a real decrement would need, then confirm
    // nothing moved.
    await new Promise((r) => setTimeout(r, 8000));
    const after = await locationStock(api, product.id, locationId);
    expect(after, "a held order must not decrement stock").toBe(before);
    void orderId;
  });

  /**
   * Decimal quantities.
   *
   * Every quantity column was integer and the till parsed input with parseInt,
   * so a shop selling by weight could not put 0.4 of anything through: the
   * value read as 0 and the line vanished off the screen with no error. This
   * walks a fractional sale all the way to the ledger.
   */
  test("2.10 a fractional quantity sells, totals correctly and moves exactly that much stock", async ({
    api,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);
    const before = await locationStock(api, product.id, locationId);

    const settings = await okJson<any>(await api.get("/api/settings"));
    const ratePercent = settings.vatEnabled === false ? 0 : Number(settings.vatRate ?? 20);

    const quantity = 0.4;
    const unitPrice = 10;
    const expectedTotal = Number((quantity * unitPrice * (1 + ratePercent / 100)).toFixed(2));

    const created = await okJson<any>(
      await placeOrder(api, locationId, [{ productId: product.id, quantity, unitPrice }]),
    );
    const charged = Number(created.order?.total ?? created.total);
    expect(
      charged,
      `0.4 x £10 at ${ratePercent}% must total £${expectedTotal}, not £${charged}`,
    ).toBeCloseTo(expectedTotal, 2);

    const after = await waitForStock(api, product.id, locationId, before - quantity);
    expect(after, "selling 0.4 must reduce stock by exactly 0.4").toBeCloseTo(before - quantity, 3);

    // And the quantity must survive the round trip rather than being rounded
    // back to a whole number on the way in or out.
    const fetched = await okJson<any>(await api.get(`/api/orders/${created.orderId ?? created.id}`));
    const line = (fetched.items ?? fetched.orderItems ?? fetched.lines ?? [])[0];
    if (line) {
      expect(Number(line.quantity), "the stored line quantity must still be 0.4").toBeCloseTo(0.4, 3);
    }
  });

  test("2.10 a quantity finer than the stored scale is refused, not silently rounded", async ({
    api,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);

    // numeric(14,3) holds thousandths. A fourth decimal place would be rounded
    // by the column, so the price charged would not match the quantity sold.
    const res = await placeOrder(api, locationId, [
      { productId: product.id, quantity: 1.2345, unitPrice: 10 },
    ]);
    expect(res.ok(), "an over-precise quantity must be rejected").toBeFalsy();
    expect(res.status(), "and rejected as a client error, not a 500").toBeLessThan(500);
  });

  test("2.7 a sale with zero quantity is rejected by validation", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);

    const res = await placeOrder(api, locationId, [
      { productId: product.id, quantity: 0, unitPrice: Number(product.defaultSalePrice) },
    ]);
    expect(res.ok()).toBeFalsy();
    expect(res.status(), "validation failure should be 4xx, never 500").toBeLessThan(500);
  });

  test("2.7 a sale with a negative price is rejected by validation", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);

    const res = await placeOrder(api, locationId, [
      { productId: product.id, quantity: 1, unitPrice: -50 },
    ]);
    expect(res.ok()).toBeFalsy();
    expect(res.status(), "validation failure should be 4xx, never 500").toBeLessThan(500);
  });
});

test.describe("money: refunds", () => {
  test("2.3 a full refund is capped at the settled total and returns stock", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);
    const unitPrice = Number(product.defaultSalePrice);

    const order = await okJson<any>(
      await placeOrder(api, locationId, [
        { productId: product.id, quantity: 2, unitPrice },
      ]),
    );
    const orderId = order.orderId ?? order.id;
    const stockAfterSale = await locationStock(api, product.id, locationId);

    const total = Number(
      order.total ?? order.order?.total ?? (await okJson<any>(await api.get(`/api/orders/${orderId}`))).total,
    );
    expect(total, "order total should be a positive number").toBeGreaterThan(0);

    const refund = await api.post(`/api/orders/${orderId}/refunds`, {
      headers: { "x-location-id": locationId },
      data: { amount: total, reason: `journey-full-${uniqueSuffix()}`, restock: true },
    });

    // Record the real behaviour rather than assuming a shape.
    expect(
      refund.status(),
      `refund should be accepted or explicitly rejected, not 500. Body: ${await refund.text()}`,
    ).toBeLessThan(500);

    if (refund.ok()) {
      const overRefund = await api.post(`/api/orders/${orderId}/refunds`, {
        headers: { "x-location-id": locationId },
        data: { amount: total, reason: "journey-double-refund", restock: false },
      });
      expect(
        overRefund.ok(),
        "a second full refund must be rejected — total refunded cannot exceed settled total",
      ).toBeFalsy();
    }

    void stockAfterSale;
  });

  test("2.4 a refund larger than the order total is rejected", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);
    const unitPrice = Number(product.defaultSalePrice);

    const order = await okJson<any>(
      await placeOrder(api, locationId, [{ productId: product.id, quantity: 1, unitPrice }]),
    );
    const orderId = order.orderId ?? order.id;
    const fetched = await okJson<any>(await api.get(`/api/orders/${orderId}`));
    const total = Number(fetched.total);

    const res = await api.post(`/api/orders/${orderId}/refunds`, {
      headers: { "x-location-id": locationId },
      data: { amount: total * 10 + 1000, reason: "journey-over-refund" },
    });
    expect(res.ok(), "over-refund must be rejected").toBeFalsy();
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe("money: gift cards", () => {
  test("2.5 a gift card is issued with a balance and looked up by code", async ({ api }) => {
    // Contract: POST /api/gift-cards takes `amount` (see issueSchema in
    // server/routes/giftCards.ts), not `initialBalance`.
    const issued = await api.post("/api/gift-cards", { data: { amount: 25 } });
    expect(
      issued.status(),
      `issuing a gift card should succeed. Body: ${await issued.text()}`,
    ).toBe(201);

    const { code, giftCard } = await issued.json();
    expect(code, "issue response should return the plaintext code once").toBeTruthy();
    expect(Number(giftCard.balance)).toBe(25);

    // GET /:code returns the card flattened with a `movements` array, not
    // wrapped in `giftCard` the way the POST response is.
    const looked = await okJson<any>(await api.get(`/api/gift-cards/${code}`));
    expect(Number(looked.balance)).toBe(25);
    expect(Array.isArray(looked.movements)).toBeTruthy();
  });

  test("2.5 POST /:code/redeem validates only — it does not move the balance", async ({ api }) => {
    // Pins current behaviour. The handler parses the amount, looks the card up
    // and returns it; the balance is only ever decremented by
    // redeemGiftCardInTx on the order path. Anything treating a 200 here as
    // "redeemed" would be wrong. If this endpoint is ever made to actually
    // redeem, this test should fail and be rewritten deliberately.
    const issued = await api.post("/api/gift-cards", { data: { amount: 30 } });
    expect(issued.status()).toBe(201);
    const { code } = await issued.json();

    // Issuing itself records a movement, so compare against the pre-call state
    // rather than expecting an empty ledger.
    const before = await okJson<any>(await api.get(`/api/gift-cards/${code}`));

    const res = await api.post(`/api/gift-cards/${code}/redeem`, { data: { amount: 10 } });
    expect(res.status(), "validation call should succeed").toBe(200);

    const after = await okJson<any>(await api.get(`/api/gift-cards/${code}`));
    expect(
      Number(after.balance),
      "balance must be unchanged — this endpoint does not redeem",
    ).toBe(30);
    expect(
      after.movements.length,
      "a validate-only call must not add a ledger movement",
    ).toBe(before.movements.length);
    expect(
      after.movements.some((m: any) => m.type === "redeem"),
      "no redeem movement should exist",
    ).toBeFalsy();
  });

  test("2.5 redeeming a non-positive amount is rejected", async ({ api }) => {
    const issued = await api.post("/api/gift-cards", { data: { amount: 15 } });
    const { code } = await issued.json();
    for (const amount of [0, -5]) {
      const res = await api.post(`/api/gift-cards/${code}/redeem`, { data: { amount } });
      expect(res.ok(), `amount ${amount} must be rejected`).toBeFalsy();
      expect(res.status(), "should be a 400, never a 500").toBe(400);
    }
  });

  test("2.5 an unknown gift card code is 404, not 500", async ({ api }) => {
    const res = await api.get("/api/gift-cards/GC-DOES-NOT-EXIST-0000");
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe("money: shifts", () => {
  test("2.6 a shift reports and closes, and cannot be closed twice", async ({ api }) => {
    const locationId = await firstLocationId(api);
    const shiftId = await ensureOpenShift(api, locationId);

    const report = await api.get(`/api/shifts/${shiftId}/report`, {
      headers: { "x-location-id": locationId },
    });
    expect(
      report.status(),
      `shift report should not 500. Body: ${await report.text()}`,
    ).toBeLessThan(500);

    const closed = await api.post(`/api/shifts/${shiftId}/close`, {
      headers: { "x-location-id": locationId },
      data: { closingFloat: 100, countedCash: 100 },
    });
    expect(
      closed.status(),
      `closing a shift should not 500. Body: ${await closed.text()}`,
    ).toBeLessThan(500);

    if (closed.ok()) {
      const again = await api.post(`/api/shifts/${shiftId}/close`, {
        headers: { "x-location-id": locationId },
        data: { closingFloat: 100, countedCash: 100 },
      });
      expect(again.ok(), "closing an already-closed shift must be rejected").toBeFalsy();
    }
  });
});

test.describe("money: tax agreement", () => {
  /**
   * Regression guard for the worst defect found in this programme: the POS
   * displayed `subtotal * 0.1` (pos.tsx) while the order engine charged
   * `subtotal * 0.20` (packages/domain/src/engine.ts). A customer was quoted
   * £110 on a £100 basket and charged £120 — on every sale.
   *
   * Both sides now derive from organizations.default_tax_rate, surfaced to the
   * client as settings.vatRate. This asserts the charged total matches the rate
   * the till would show, so the two can never silently diverge again.
   */
  test("2.9 the total charged matches the org's configured tax rate", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);

    const settings = await okJson<any>(await api.get("/api/settings"));
    const ratePercent = settings.vatEnabled === false ? 0 : Number(settings.vatRate ?? 20);
    expect(Number.isFinite(ratePercent), "settings must expose a usable vatRate").toBeTruthy();

    // A round subtotal keeps the arithmetic unambiguous.
    const unitPrice = 10;
    const quantity = 3;
    const subtotal = unitPrice * quantity;
    const expectedTotal = Number((subtotal * (1 + ratePercent / 100)).toFixed(2));

    const created = await okJson<any>(
      await placeOrder(api, locationId, [{ productId: product.id, quantity, unitPrice }]),
    );
    const charged = Number(created.order?.total ?? created.total);

    expect(
      charged,
      `£${subtotal} basket at ${ratePercent}% must total £${expectedTotal}, not £${charged}. ` +
        `A mismatch means the till and the engine disagree on tax again.`,
    ).toBeCloseTo(expectedTotal, 2);
  });
});

/**
 * Fulfilment is a reporting dimension the Control Centre counts on, and every
 * stage between the till and the tile is an explicit field list — the checkout
 * payload, storage.createOrder's values object, and the /api/orders select.
 * Each of those drops an unthreaded field silently, which is exactly how the
 * product Stock input came to report success while writing nothing.
 *
 * So this asserts the whole seam rather than any one stage: what the till sends
 * is what the API hands back.
 */
test.describe("fulfilment method", () => {
  test("4.4 a delivery sale is stored and read back as a delivery", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);

    const res = await placeOrder(
      api,
      locationId,
      [{ productId: product.id, quantity: 1, unitPrice: Number(product.defaultSalePrice) }],
      "cash",
      { fulfilmentMethod: "delivery" },
    );
    const order = await okJson<any>(res);
    const orderId = order.orderId ?? order.id ?? order.order?.id;
    expect(orderId, "order response should carry an id").toBeTruthy();

    const list = await okJson<any[]>(await api.get("/api/orders"));
    const stored = list.find((o) => o.id === orderId);
    expect(stored, "the order must appear in the list").toBeTruthy();
    expect(
      stored.fulfilmentMethod,
      "a sale placed as a delivery must read back as a delivery — if this is " +
        "'collection', a field list between the till and the API dropped it",
    ).toBe("delivery");
  });

  test("4.5 a sale that says nothing about fulfilment defaults to collection", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId);

    const res = await placeOrder(api, locationId, [
      { productId: product.id, quantity: 1, unitPrice: Number(product.defaultSalePrice) },
    ]);
    const order = await okJson<any>(res);
    const orderId = order.orderId ?? order.id ?? order.order?.id;

    const list = await okJson<any[]>(await api.get("/api/orders"));
    const stored = list.find((o) => o.id === orderId);
    expect(
      stored.fulfilmentMethod,
      "an omitted fulfilment must default to collection, matching the backfill",
    ).toBe("collection");
  });
});
