/**
 * Phase 4 — cross-stage flows.
 *
 * The defect class that started this programme: every stage worked and none of
 * the seams between them did. These walk a record from one stage to the next
 * and assert the state each stage hands the following one, rather than testing
 * any stage in isolation.
 */
import {
  activeLocations,
  type LocationRow,
  test,
  expect,
  ensureOpenShift,
  firstLocationId,
  okJson,
  uniqueSuffix,
  waitForStock,
} from "./fixtures";

type Product = { id: string; name: string; defaultSalePrice: string; stock: number };

/** A location other than `notThis`, creating one if the org has only a single site. */
async function secondLocationId(api: any, notThis: string): Promise<string> {
  const locations = activeLocations(await okJson<LocationRow[]>(await api.get("/api/locations")));
  const other = locations.find((l) => l.id !== notThis);
  if (other) return other.id;

  const created = await okJson<{ id: string }>(
    await api.post("/api/locations", {
      data: {
        name: `Journey Annex ${uniqueSuffix()}`,
        address: "2 Journey Street",
        city: "Testville",
        state: "TS",
        zipCode: "TS2",
        phone: "0000000000",
        email: "annex@example.com",
      },
    }),
  );
  return created.id;
}

test.describe("cross-stage: replenishment → purchase draft → receiving", () => {
  /**
   * The original flow. Each assertion is a seam: the recommendation must carry
   * a supplier the draft can use, the draft must become receivable, receiving
   * must move stock, and the recommendation must then reflect what is on order.
   */
  test("4.1 a purchase draft raised from a recommendation receives into stock", async ({
    api,
  }) => {
    const locationId = await firstLocationId(api);
    const suffix = uniqueSuffix();

    // A product with a supplier mapping, so replenishment can propose a buy.
    const product = await okJson<any>(
      await api.post("/api/products", {
        data: {
          name: `Journey Widget ${suffix}`,
          productCode: `JW-${suffix}`.slice(0, 40),
          costPrice: 2,
          // The engine reads `salePrice`; sending only defaultSalePrice
          // creates the product at zero and poisons price-sensitive tests.
          salePrice: 5,
          defaultSalePrice: 5,
          stock: 0,
          stockLimit: 100,
        },
      }),
    );
    const supplier = await okJson<any>(
      await api.post("/api/suppliers", { data: { name: `Journey Supplier ${suffix}`, leadTimeDays: 2 } }),
    );
    await api.post("/api/product-suppliers", {
      data: { productId: product.id, supplierId: supplier.id, costPrice: 2, packSize: 1, isPreferred: true },
    });

    // Stage 1 → 2: raise a draft the way the replenishment tab does.
    const batch = await okJson<any>(
      await api.post("/api/replenishment/create-purchase-drafts", {
        data: {
          lines: [
            {
              supplierId: supplier.id,
              locationId,
              productId: product.id,
              quantity: 12,
              estimatedCost: 2,
              recommendation: { productName: product.name, explain: { whyAction: "journey 4.1" } },
            },
          ],
        },
      }),
    );
    expect(batch.created, "one supplier should yield exactly one draft").toBe(1);
    const draftId = batch.drafts[0].id;

    // The draft must carry the provenance the UI renders.
    const draft = await okJson<any>(await api.get(`/api/purchase-drafts/${draftId}`));
    expect(draft.sourceRecommendationJson, "draft must record why it was raised").toBeTruthy();

    // On-order must now be visible to replenishment, so the same shortfall is
    // not recommended twice — the bug this flow was built around.
    const recs = await okJson<any>(
      await api.get(`/api/replenishment/recommendations?locationId=${locationId}&limit=200`),
    );
    const mine = recs.items.find((r: any) => r.productId === product.id);
    if (mine) {
      expect(mine.onOrderQty, "the open draft must count as on order").toBeGreaterThanOrEqual(12);
    }

    // Stage 2 → 3: approve, then receive.
    await api.patch(`/api/purchase-drafts/${draftId}/status`, { data: { status: "reviewed" } });
    await api.patch(`/api/purchase-drafts/${draftId}/status`, { data: { status: "approved" } });

    const receiving = await okJson<any>(await api.get(`/api/purchase-drafts/${draftId}/receiving`));
    const line = receiving.items[0];
    expect(line.remaining, "an approved draft must be fully receivable").toBe(12);

    const receipt = await okJson<any>(
      await api.post("/api/goods-receipts", {
        data: {
          purchaseDraftId: draftId,
          items: [{ purchaseDraftItemId: line.id, productId: product.id, quantityReceived: 12 }],
        },
      }),
    );
    expect(receipt.status, "a new receipt is pending until completed").toBe("pending");

    // Stock must not move until completion.
    const beforeComplete = await okJson<Product[]>(
      await api.get("/api/products", { headers: { "x-location-id": locationId } }),
    );
    expect(
      beforeComplete.find((p) => p.id === product.id)?.stock ?? 0,
      "a pending receipt must not move stock",
    ).toBe(0);

    await api.post(`/api/goods-receipts/${receipt.id}/complete`, { data: {} });

    const after = await waitForStock(api, product.id, locationId, 12);
    expect(after, "completing the receipt must bring 12 units into stock").toBe(12);

    const finalDraft = await okJson<any>(await api.get(`/api/purchase-drafts/${draftId}`));
    expect(finalDraft.status, "a fully received draft must say so").toBe("fully_received");
  });
});

test.describe("cross-stage: transfer between locations", () => {
  /**
   * Stock must leave one site and arrive at the other — and the totals must
   * balance. This is the flow whose completion previously had no row lock and
   * could apply twice.
   */
  test("4.2 completing a transfer moves stock from source to destination", async ({ api }) => {
    const source = await firstLocationId(api);
    const destination = await secondLocationId(api, source);
    const suffix = uniqueSuffix();

    const product = await okJson<any>(
      await api.post("/api/products", {
        data: {
          name: `Transfer Widget ${suffix}`,
          productCode: `TW-${suffix}`.slice(0, 40),
          costPrice: 1,
          salePrice: 3,
          defaultSalePrice: 3,
          stock: 0,
          stockLimit: 100,
        },
      }),
    );

    // Seed stock at the source via the inventory adjustment route.
    const seeded = await api.patch(`/api/inventory/${product.id}`, {
      headers: { "x-location-id": source },
      data: { adjustment: 30, type: "set" },
    });
    expect(seeded.status(), `could not seed stock. Body: ${await seeded.text()}`).toBeLessThan(400);

    const created = await api.post("/api/inventory/transfers", {
      data: {
        fromLocationId: source,
        toLocationId: destination,
        notes: `journey-4.2-${suffix}`,
        items: [{ productId: product.id, quantity: 10 }],
      },
    });
    expect(created.status(), `transfer create failed: ${await created.text()}`).toBeLessThan(400);
    const transfer = await created.json();
    const transferId = transfer.id ?? transfer.transfer?.id;
    expect(transferId).toBeTruthy();

    const sourceBefore = await okJson<Product[]>(
      await api.get("/api/products", { headers: { "x-location-id": source } }),
    );
    const startingSource = sourceBefore.find((p) => p.id === product.id)?.stock ?? 0;
    expect(startingSource, "source should hold the seeded stock").toBe(30);

    // Drive the status chain to completion.
    for (const status of ["requested", "in_transit", "completed"]) {
      const res = await api.patch(`/api/inventory/transfers/${transferId}/status`, {
        data: { status },
      });
      expect(
        res.status(),
        `transition to ${status} failed: ${await res.text()}`,
      ).toBeLessThan(400);
    }

    const sourceAfter = await okJson<Product[]>(
      await api.get("/api/products", { headers: { "x-location-id": source } }),
    );
    const destAfter = await okJson<Product[]>(
      await api.get("/api/products", { headers: { "x-location-id": destination } }),
    );

    expect(
      sourceAfter.find((p) => p.id === product.id)?.stock,
      "10 units must leave the source",
    ).toBe(20);
    expect(
      destAfter.find((p) => p.id === product.id)?.stock,
      "10 units must arrive at the destination",
    ).toBe(10);

    // A completed transfer cannot be completed again.
    const again = await api.patch(`/api/inventory/transfers/${transferId}/status`, {
      data: { status: "completed" },
    });
    expect(again.ok(), "re-completing a transfer must be rejected").toBeFalsy();

    // And the totals must still balance after the rejected attempt.
    const sourceFinal = await okJson<Product[]>(
      await api.get("/api/products", { headers: { "x-location-id": source } }),
    );
    expect(
      sourceFinal.find((p) => p.id === product.id)?.stock,
      "a rejected re-completion must not move stock again",
    ).toBe(20);
  });
});

test.describe("cross-stage: order → documents", () => {
  /**
   * An order must be able to produce its own paperwork, and the figures on the
   * paperwork must match the order. Covers the seam that had the invoice
   * reachable only from the Invoices page.
   */
  test("4.3 an order's invoice and receipt both reconcile with the order total", async ({
    api,
  }) => {
    const { extractPdfText, looksLikePdf, placeOrder } = await import("./fixtures");
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);

    const products = await okJson<Product[]>(
      await api.get("/api/products", { headers: { "x-location-id": locationId } }),
    );
    const product = products.find((p) => p.stock > 3);
    expect(product, "need a sellable product").toBeTruthy();

    const created = await okJson<any>(
      await placeOrder(api, locationId, [
        { productId: product!.id, quantity: 2, unitPrice: 10 },
      ]),
    );
    const orderId = created.orderId ?? created.id;
    const total = Number(created.order?.total ?? created.total);
    expect(total, "order should have a total").toBeGreaterThan(0);

    const expectedAmount = total.toFixed(2);

    for (const [kind, path] of [
      ["receipt", `/api/orders/${orderId}/receipt.pdf`],
      ["invoice", `/api/invoices/${orderId}/pdf`],
    ] as const) {
      const res = await api.get(path);
      expect(res.status(), `${kind} should generate`).toBe(200);
      const buf = Buffer.from(await res.body());
      expect(looksLikePdf(buf), `${kind} must be a real PDF`).toBeTruthy();

      const text = extractPdfText(buf);
      expect(
        text,
        `the ${kind} must show the same total the order was charged (£${expectedAmount})`,
      ).toContain(expectedAmount);
    }
  });
});
