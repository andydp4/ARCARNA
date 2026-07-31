/**
 * Phase 3 — documents: receipts, invoices, branding.
 *
 * Every assertion reads the PDF's actual text, not just its status or size. A
 * status-only check passes when the endpoint returns an HTML error page with a
 * 200, and a size-only check passes when branding is entirely missing.
 */
import {
  test,
  expect,
  ensureOpenShift,
  extractPdfText,
  firstLocationId,
  looksLikePdf,
  okJson,
  placeOrder,
} from "./fixtures";

type Product = { id: string; name: string; defaultSalePrice: string; stock: number };

async function orderForDocuments(api: any, locationId: string) {
  const products = await okJson<Product[]>(
    await api.get("/api/products", { headers: { "x-location-id": locationId } }),
  );
  const product = products.find((p) => p.stock > 3);
  if (!product) throw new Error("No sellable product — seed the database");

  const created = await okJson<any>(
    await placeOrder(api, locationId, [
      { productId: product.id, quantity: 1, unitPrice: Number(product.defaultSalePrice) },
    ]),
  );
  const orderId = created.orderId ?? created.id;
  if (!/^[0-9a-f-]{36}$/i.test(String(orderId))) {
    throw new Error(
      `Order creation did not return a usable id. Response: ${JSON.stringify(created)}`,
    );
  }
  return { orderId, product };
}

async function orgName(api: any): Promise<string> {
  const settings = await okJson<any>(await api.get("/api/settings"));
  return settings.businessName;
}

test.describe("documents: receipt", () => {
  test("3.3 a receipt PDF downloads from a completed order and is branded", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const { orderId } = await orderForDocuments(api, locationId);

    const res = await api.get(`/api/orders/${orderId}/receipt.pdf`);
    expect(res.status(), `receipt should generate. Body: ${await res.text()}`).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    expect(
      res.headers()["content-disposition"],
      "a download button needs an attachment disposition",
    ).toContain("attachment");

    const buf = Buffer.from(await res.body());
    expect(looksLikePdf(buf), "response must be a real PDF, not an error page").toBeTruthy();

    const text = extractPdfText(buf);
    expect(text, "receipt should be titled").toContain("RECEIPT");
    // Branding: the org's own name must appear, or the document is generic.
    expect(text, "receipt must carry the organisation's name").toContain(await orgName(api));
    expect(text, "receipt should show the amount paid").toMatch(/Total paid/i);
  });

  test("3.3 a receipt for an unknown order is 404, not 500", async ({ api }) => {
    const res = await api.get("/api/orders/00000000-0000-4000-8000-000000000000/receipt.pdf");
    expect(res.status()).toBe(404);
  });

  test("5.2 a receipt for another tenant's order is not served", async ({ api, orgId }) => {
    // Reuse this org's own order id but scope the request to a different org by
    // asking as SUPER_ADMIN with a bogus org — must not leak.
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const { orderId } = await orderForDocuments(api, locationId);

    const { apiAs } = await import("./fixtures");
    const other = await apiAs("SUPER_ADMIN", "11111111-1111-4111-8111-111111111111");
    const res = await other.get(`/api/orders/${orderId}/receipt.pdf`);
    expect(
      res.status(),
      "an order must not be readable when scoped to a different org",
    ).not.toBe(200);
    await other.dispose();
    void orgId;
  });
});

test.describe("documents: invoice", () => {
  test("3.5 an invoice PDF is reachable using the order id and is branded", async ({ api }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const { orderId } = await orderForDocuments(api, locationId);

    // loadInvoiceForPdf accepts an order id and synthesises the invoice when the
    // async InvoiceWorker has not created the record yet — so a completed order
    // can always produce paperwork.
    const res = await api.get(`/api/invoices/${orderId}/pdf`);
    expect(res.status(), `invoice should generate. Body: ${await res.text()}`).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");

    const buf = Buffer.from(await res.body());
    expect(looksLikePdf(buf)).toBeTruthy();

    const text = extractPdfText(buf);
    expect(text, "invoice should be titled").toContain("INVOICE");
    expect(text, "invoice must carry the organisation's name").toContain(await orgName(api));
  });

  test("3.4 an invoice for an unknown id is 404, not 500", async ({ api }) => {
    const res = await api.get("/api/invoices/00000000-0000-4000-8000-000000000000/pdf");
    expect(res.status()).toBe(404);
  });
});

test.describe("documents: download buttons in the UI", () => {
  /**
   * The point of the whole programme: the capability existing server-side is
   * not the same as a user being able to reach it. These click the real buttons
   * in the real order dialog and assert a real file arrives.
   */
  for (const kind of ["receipt", "invoice"] as const) {
    test(`5.4 a user can download the ${kind} from a completed order`, async ({
      api,
      browser,
      orgId,
    }) => {
      const locationId = await firstLocationId(api);
      await ensureOpenShift(api, locationId);
      const { orderId } = await orderForDocuments(api, locationId);

      const { pageAs } = await import("./fixtures");
      const page = await pageAs(browser, "ADMIN", orgId);

      await page.goto("/open-orders");
      // The order list polls; wait for our order's row to appear.
      const viewButton = page.getByTestId(`button-view-order-${orderId}`);
      await expect(viewButton).toBeVisible({ timeout: 30_000 });
      await viewButton.click();

      const button = page.getByTestId(`button-download-${kind}`);
      await expect(button, `${kind} download button should be on the order dialog`).toBeVisible({
        timeout: 15_000,
      });

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30_000 }),
        button.click(),
      ]);

      expect(download.suggestedFilename()).toMatch(new RegExp(`^${kind}-.*\\.pdf$`));

      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const buf = Buffer.concat(chunks);

      expect(looksLikePdf(buf), "the downloaded file must be a real PDF").toBeTruthy();
      const text = extractPdfText(buf);
      expect(text).toContain(kind === "receipt" ? "RECEIPT" : "INVOICE");
      expect(text, "the downloaded document must be branded").toContain(await orgName(api));

      await page.context().close();
    });
  }
});

test.describe("documents: branding gate (checkpoint 3.8)", () => {
  /**
   * The branding assertions above are only meaningful if they FAIL when the
   * branding is wrong. This proves it: rename the org, confirm the receipt
   * follows the new name and no longer contains the old one, then restore.
   *
   * If this test ever passes while the name is unchanged in the PDF, the
   * branding assertions elsewhere in this file are worthless.
   */
  test("3.8 renaming the org changes the receipt, proving branding is real", async ({
    api,
    orgId,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const { orderId } = await orderForDocuments(api, locationId);

    const originalName = await orgName(api);
    const marker = `Branding Gate ${Date.now()}`;

    try {
      // /api/settings is read-only; the org name is changed via PATCH /api/orgs/:id.
      const patch = await api.patch(`/api/orgs/${orgId}`, { data: { name: marker } });
      expect(
        patch.status(),
        `could not rename org for the gate. Body: ${await patch.text()}`,
      ).toBeLessThan(400);

      const res = await api.get(`/api/orders/${orderId}/receipt.pdf`);
      expect(res.status()).toBe(200);
      const text = extractPdfText(Buffer.from(await res.body()));

      expect(text, "receipt must reflect the org's current name").toContain(marker);
      expect(
        text,
        "and must no longer show the old name — otherwise the PDF is not reading org data",
      ).not.toContain(originalName);
    } finally {
      await api.patch(`/api/orgs/${orgId}`, { data: { name: originalName } });
    }

    // Confirm the restore took, so later tests are not polluted.
    expect(await orgName(api)).toBe(originalName);
  });
});
