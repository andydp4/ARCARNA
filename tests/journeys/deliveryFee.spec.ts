/**
 * The delivery fee (v1.2.1), end to end.
 *
 *  - On the order form (the Operations Centre's New order, where /create-order
 *    and /pos land), one tap adds the org's fee to a delivery; the amount can
 *    be changed for the order, or removed. It is in the total the till shows
 *    and the total charged, and on its own line on the receipt and invoice.
 *  - Only an admin sets the fee's name and price; every role reads them.
 *  - The Evidence shows delivery fee takings apart, inside takings.
 *  - A sale queued offline, with the fee or from a till that never sent one,
 *    still lands.
 */
import { devices } from "@playwright/test";
import {
  test,
  expect,
  apiAs,
  ensureOpenShift,
  extractPdfText,
  firstLocationId,
  looksLikePdf,
  okJson,
  pageAs,
  uniqueSuffix,
} from "./fixtures";
import type { APIRequestContext } from "@playwright/test";
import { priceOrder } from "../../shared/pricing/priceOrder";
import { authMode, ROLE_GATE_OFF_REASON } from "./security/tenants";

const phone = devices["Pixel 7"];

// Every test here reads or writes the org's one fee setting: run them in turn.
test.describe.configure({ mode: "serial" });

async function feeProduct(api: APIRequestContext, locationId: string, price = 12) {
  const suffix = uniqueSuffix();
  const product = await okJson<{ id: string; name: string }>(
    await api.post("/api/products", {
      data: {
        name: `Fee Widget ${suffix}`,
        productCode: `FEE-${suffix}`.slice(0, 40),
        costPrice: 2,
        salePrice: price,
        defaultSalePrice: price,
        stock: 0,
        stockLimit: 100,
      },
    }),
  );
  await api.patch(`/api/inventory/${product.id}`, {
    headers: { "x-location-id": locationId },
    data: { adjustment: 50, type: "set" },
  });
  return { ...product, code: `FEE-${suffix}`.slice(0, 40) };
}

/** What a £12 widget and this fee come to at the org's VAT rate: the till's own sum. */
async function charged(api: APIRequestContext, deliveryFee: number): Promise<number> {
  const settings = await okJson<{ vatRate?: number }>(await api.get("/api/settings"));
  return priceOrder({ lines: [{ quantity: 1, unitPrice: 12 }], taxRatePercent: settings.vatRate ?? 0, deliveryFee }).total;
}

async function resetFeeSettings(api: APIRequestContext) {
  await okJson(
    await api.put("/api/settings/delivery-fee", {
      data: { name: "Delivery fee", defaultPrice: 3, commissionable: false },
    }),
  );
}

function deliverySale(productId: string, extra: Record<string, unknown> = {}) {
  return {
    clientOrderId: `fee-${uniqueSuffix()}`,
    lines: [{ productId, quantity: 1, unitPrice: 12 }],
    paymentMethod: "cash",
    fulfilmentMethod: "delivery",
    deliveryAddress: "1 Fictional Road",
    deliveryPostcode: "ZZ1 1ZZ",
    ...extra,
  };
}

test.describe("delivery fee on the order form, on a phone", () => {
  test.use({ viewport: phone.viewport, hasTouch: true, isMobile: true, userAgent: phone.userAgent });

  test("one tap adds the fee, the amount can be changed, and the total and receipt carry it", async ({
    browser,
    api,
    orgId,
  }) => {
    await resetFeeSettings(api);
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await feeProduct(api, locationId);

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/operations?pane=order");
    const search = page.locator('[data-testid="line-product-new"]');
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill(product.code);
    const option = page.getByRole("option", { name: new RegExp(product.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.tap();
    await page.locator('[data-testid="mobile-checkout-button"]').tap();
    await expect(page.locator('[data-testid="pos-checkout-step"]')).toBeVisible();

    // No fee control until it is a delivery.
    await expect(page.getByTestId("button-add-delivery-fee")).toHaveCount(0);
    await page.getByTestId("select-fulfilment-delivery").tap();
    await page.getByTestId("input-delivery-address").fill("1 Fictional Road");
    await page.getByTestId("input-delivery-postcode").fill("ZZ1 1ZZ");

    // One tap, at the org's price.
    const add = page.getByTestId("button-add-delivery-fee");
    await expect(add).toContainText("£3.00");
    await add.tap();
    await expect(page.getByTestId("input-delivery-fee")).toHaveValue("3.00");
    await expect(page.getByTestId("checkout-total")).toContainText((await charged(api, 3)).toFixed(2));

    // Changed for this order only.
    await page.getByTestId("input-delivery-fee").fill("4.50");
    const expected = await charged(api, 4.5);
    await expect(page.getByTestId("checkout-total")).toContainText(expected.toFixed(2));
    await expect(page.getByTestId("checkout-delivery-fee")).toContainText("4.50");

    const placed = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
    await page.getByTestId("button-confirm-payment").tap();
    const res = await placed;
    expect(res.status(), await res.text()).toBe(201);
    const orderId = ((await res.json()) as { orderId: string }).orderId;

    const stored = await okJson<{ total: string; deliveryFee: number }>(await api.get(`/api/orders/${orderId}`));
    expect(parseFloat(stored.total)).toBeCloseTo(expected, 2);
    expect(stored.deliveryFee).toBe(4.5);

    // Its own line on the receipt.
    const pdf = await api.get(`/api/orders/${orderId}/receipt.pdf`);
    expect(pdf.ok()).toBe(true);
    const body = Buffer.from(await pdf.body());
    expect(looksLikePdf(body)).toBe(true);
    expect(extractPdfText(body)).toContain("Delivery fee");

    // The next sale starts with no fee.
    await expect(search).toBeVisible({ timeout: 15_000 });
    await page.context().close();
  });
});

test.describe("refunding a delivery fee, on a phone", () => {
  test.use({ viewport: phone.viewport, hasTouch: true, isMobile: true, userAgent: phone.userAgent });

  test("the refund page gives the fee back with the goods, once, under the org's name for it", async ({
    browser,
    api,
    orgId,
  }) => {
    await resetFeeSettings(api);
    await okJson(await api.put("/api/settings/delivery-fee", { data: { name: "Van charge" } }));
    try {
      const locationId = await firstLocationId(api);
      await ensureOpenShift(api, locationId);
      const product = await feeProduct(api, locationId);
      const total = await charged(api, 3);
      const created = await okJson<{ orderId: string }>(
        await api.post("/api/orders", {
          headers: { "x-location-id": locationId },
          data: deliverySale(product.id, { deliveryFee: 3, expectedTotal: total }),
        }),
      );
      await okJson(await api.patch(`/api/orders/${created.orderId}`, { data: { status: "completed" } }));
      const before = await okJson<{ deliveryFeeRefundable: number }>(await api.get(`/api/orders/${created.orderId}`));
      expect(before.deliveryFeeRefundable).toBeGreaterThanOrEqual(3);

      const page = await pageAs(browser, "ADMIN", orgId);
      await page.goto(`/open-orders/${created.orderId}/refund`);
      const fee = page.getByTestId("refund-delivery-fee");
      await expect(fee).toBeVisible({ timeout: 60_000 });
      await expect(fee).toContainText("Van charge");
      await page.getByRole("checkbox").first().tap();
      await page.getByTestId("checkbox-refund-delivery-fee").tap();
      // The widget at what the customer paid for it (its share of the goods,
      // VAT included), and the fee as charged: the whole sale comes back, so
      // exactly what was paid.
      const expectedRefund = total;
      await expect(page.getByText(`Refund total: £${expectedRefund.toFixed(2)}`)).toBeVisible();
      // Nothing on the page is wider than the phone.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "Continue" }).tap();
      await page.getByRole("button", { name: "Review" }).tap();
      const refunded = page.waitForResponse(
        (r) => r.url().includes(`/api/orders/${created.orderId}/refunds`) && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Confirm refund" }).tap();
      const res = await refunded;
      expect(res.status(), await res.text()).toBe(201);

      const after = await okJson<{ refundedTotal: number; deliveryFeeRefunded: number; deliveryFeeRefundable: number }>(
        await api.get(`/api/orders/${created.orderId}`),
      );
      expect(after.refundedTotal).toBeCloseTo(expectedRefund, 2);
      expect(after.deliveryFeeRefunded).toBeCloseTo(before.deliveryFeeRefundable, 2);
      expect(after.deliveryFeeRefundable).toBe(0);
      // Once only.
      const again = await api.post(`/api/orders/${created.orderId}/refunds`, {
        data: { reason: "damaged", refundMethod: "cash", lines: [], deliveryFee: true },
      });
      expect(again.status()).toBe(400);
      await page.context().close();
    } finally {
      await resetFeeSettings(api);
    }
  });
});

test.describe("delivery fee on the order form, on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the fee can be removed before payment, and the sale is charged without it", async ({ browser, api, orgId }) => {
    await resetFeeSettings(api);
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await feeProduct(api, locationId);

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/operations?pane=order");
    const search = page.locator('[data-testid="line-product-new"]');
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill(product.code);
    const option = page.getByRole("option", { name: new RegExp(product.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await expect(page.locator('[data-testid="pos-checkout-step"]')).toBeVisible();

    await page.getByTestId("select-fulfilment-delivery").click();
    await page.getByTestId("input-delivery-address").fill("2 Fictional Road");
    await page.getByTestId("input-delivery-postcode").fill("ZZ1 1ZZ");
    await page.getByTestId("button-add-delivery-fee").click();
    await expect(page.getByTestId("checkout-total")).toContainText((await charged(api, 3)).toFixed(2));
    await page.getByTestId("button-remove-delivery-fee").click();
    await expect(page.getByTestId("button-add-delivery-fee")).toBeVisible();
    const withoutFee = await charged(api, 0);
    await expect(page.getByTestId("checkout-total")).toContainText(withoutFee.toFixed(2));

    const placed = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
    await page.getByTestId("button-confirm-payment").click();
    const res = await placed;
    expect(res.status(), await res.text()).toBe(201);
    const orderId = ((await res.json()) as { orderId: string }).orderId;
    const stored = await okJson<{ total: string; deliveryFee: number }>(await api.get(`/api/orders/${orderId}`));
    expect(parseFloat(stored.total)).toBeCloseTo(withoutFee, 2);
    expect(stored.deliveryFee).toBe(0);
    await page.context().close();
  });
});

test.describe("delivery fee settings, Evidence and offline sales", () => {
  test("a manager or cashier cannot change the fee's settings", async ({ api, orgId }) => {
    // requireRole() lets everything through under DEV_AUTH_BYPASS (see
    // security/roleEnforcement.spec.ts); the DB suite proves the 403 either way.
    test.skip((await authMode()).devAuthBypass, ROLE_GATE_OFF_REASON);
    await resetFeeSettings(api);
    const manager = await apiAs("MANAGER", orgId);
    const cashier = await apiAs("CASHIER", orgId);
    try {
      expect((await manager.put("/api/settings/delivery-fee", { data: { defaultPrice: 9 } })).status()).toBe(403);
      expect((await cashier.put("/api/settings/delivery-fee", { data: { defaultPrice: 9 } })).status()).toBe(403);
    } finally {
      await manager.dispose();
      await cashier.dispose();
    }
  });

  test("the admin sets the fee's name and price, and the till reads them", async ({ api, orgId }) => {
    await resetFeeSettings(api);
    const cashier = await apiAs("CASHIER", orgId);
    try {
      await okJson(await api.put("/api/settings/delivery-fee", { data: { name: "Van charge", defaultPrice: 4.25 } }));
      const seen = await okJson<{ deliveryFeeName: string; deliveryFeePrice: number }>(await cashier.get("/api/settings"));
      expect(seen.deliveryFeeName).toBe("Van charge");
      expect(seen.deliveryFeePrice).toBe(4.25);
    } finally {
      await resetFeeSettings(api);
      await cashier.dispose();
    }
  });

  test("the fee is on its own line on the invoice, and Daily Sales shows fee takings apart", async ({ api }) => {
    await resetFeeSettings(api);
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await feeProduct(api, locationId);
    const day = await okJson<{ period: { from: string } }>(await api.get("/api/reports/ARC-T1-001"));
    const tradingDay = new Date(new Date(day.period.from).getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);
    const report = async () =>
      (
        await okJson<{ summary: { totalRevenue: number; deliveryFeeRevenue: number; deliveryFeeOrders: number } }>(
          await api.get(`/api/reports/ARC-T1-001?from=${tradingDay}&to=${tradingDay}`),
        )
      ).summary;
    const before = await report();

    const total = await charged(api, 3.75);
    const settings = await okJson<{ vatRate?: number }>(await api.get("/api/settings"));
    const feeCharged = Math.round(3.75 * (1 + (settings.vatRate ?? 0) / 100) * 100) / 100;
    const created = await okJson<{ orderId: string }>(
      await api.post("/api/orders", {
        headers: { "x-location-id": locationId },
        data: deliverySale(product.id, { deliveryFee: 3.75, expectedTotal: total }),
      }),
    );
    await okJson(await api.patch(`/api/orders/${created.orderId}`, { data: { status: "completed" } }));

    const after = await report();
    // As charged, VAT included, like takings.
    expect(after.deliveryFeeRevenue - before.deliveryFeeRevenue).toBeCloseTo(feeCharged, 2);
    expect(after.deliveryFeeOrders - before.deliveryFeeOrders).toBe(1);
    // Inside takings, not on top of them (at least this sale: other journeys
    // running alongside may settle sales of their own).
    expect(after.totalRevenue - before.totalRevenue).toBeGreaterThanOrEqual(total - 0.005);

    const invoice = await okJson<{ id: string }>(await api.post(`/api/invoices/for-order/${created.orderId}`));
    const pdf = await api.get(`/api/invoices/${invoice.id}/pdf`);
    expect(pdf.ok()).toBe(true);
    const text = extractPdfText(Buffer.from(await pdf.body()));
    expect(text).toContain("Delivery fee");
    expect(text).toContain("3.75");
  });

  test("a sale queued offline lands with its fee, and one from a till that never sent a fee lands as before", async ({
    api,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await feeProduct(api, locationId);
    const withFee = await okJson<{ orderId: string }>(
      await api.post("/api/orders", {
        headers: { "x-location-id": locationId },
        data: deliverySale(product.id, {
          deliveryFee: 3,
          expectedTotal: await charged(api, 3),
          _offlineOrderReplay: true,
          _offlineQueuedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        }),
      }),
    );
    const a = await okJson<{ total: string; deliveryFee: number }>(await api.get(`/api/orders/${withFee.orderId}`));
    expect(parseFloat(a.total)).toBeCloseTo(await charged(api, 3), 2);
    expect(a.deliveryFee).toBe(3);

    const older = await okJson<{ orderId: string }>(
      await api.post("/api/orders", {
        headers: { "x-location-id": locationId },
        data: deliverySale(product.id, {
          expectedTotal: await charged(api, 0),
          _offlineOrderReplay: true,
          _offlineQueuedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        }),
      }),
    );
    const b = await okJson<{ total: string; deliveryFee: number }>(await api.get(`/api/orders/${older.orderId}`));
    expect(parseFloat(b.total)).toBeCloseTo(await charged(api, 0), 2);
    expect(b.deliveryFee).toBe(0);
  });
});
