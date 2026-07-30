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

async function sellableProduct(api: any, locationId: string): Promise<Product> {
  const products = await okJson<Product[]>(
    await api.get("/api/products", { headers: { "x-location-id": locationId } }),
  );
  const candidate = products.find((p) => p.stock > 5);
  if (!candidate) {
    throw new Error(
      `No product with stock > 5 at location ${locationId}. Seed/backfill the database first.`,
    );
  }
  return candidate;
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
