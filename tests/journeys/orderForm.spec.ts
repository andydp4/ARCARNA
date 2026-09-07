/**
 * The order form on a phone, end to end, with no pop-ups.
 *
 * The old form stacked a cart sheet and a checkout dialog, and on Android the
 * two portals fought until the dialog sometimes did not appear. This drives
 * the whole sale at a phone viewport and asserts the structural fact that
 * makes the difference: from first tap to confirmed payment, nothing with a
 * dialog role is ever on screen.
 */
import { devices } from "@playwright/test";
import { test, expect, apiAs, ensureOpenShift, firstLocationId, okJson, pageAs, uniqueSuffix } from "./fixtures";

const phone = devices["Pixel 7"];

test.describe("order form on a phone", () => {
  test.use({ viewport: phone.viewport, hasTouch: true, isMobile: true, userAgent: phone.userAgent });

  test("builds an order and takes payment without a single dialog", async ({ browser, api, orgId }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const suffix = uniqueSuffix();
    const product = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `Phone Widget ${suffix}`,
          productCode: `PW-${suffix}`.slice(0, 40),
          costPrice: 1,
          salePrice: 4,
          defaultSalePrice: 4,
          stock: 0,
          stockLimit: 100,
        },
      }),
    );
    await api.patch(`/api/inventory/${product.id}`, {
      headers: { "x-location-id": locationId },
      data: { adjustment: 10, type: "set" },
    });

    const page = await pageAs(browser, "ADMIN", orgId);
    const dialogs = page.locator('[role="dialog"]');
    await page.goto("/create-order");

    const search = page.locator('[data-testid="line-product-new"]');
    await expect(search).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="mobile-cart-button"]'), "no cart sheet trigger").toHaveCount(0);

    await search.fill(`PW-${suffix}`);
    const option = page.getByRole("option", { name: new RegExp(product.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    // A real tap, as a thumb would do it.
    await option.tap();
    await expect(page.locator(`[data-testid="order-line-${product.id}"]`)).toBeVisible();
    await expect(dialogs).toHaveCount(0);

    // One more of it, on the line itself.
    await page.getByRole("button", { name: `One more ${product.name}` }).tap();
    await expect(page.locator('[data-testid="line-qty-0"]')).toHaveValue("2");
    await expect(page.locator('[data-testid="mobile-order-total"]')).toContainText("9.60");

    await page.locator('[data-testid="mobile-checkout-button"]').tap();

    // The payment step replaces the lines. It is page content, not a layer.
    const step = page.locator('[data-testid="pos-checkout-step"]');
    await expect(step).toBeVisible();
    await expect(dialogs).toHaveCount(0);
    await expect(page.locator('[data-testid="payment-method-cash"]')).toHaveAttribute("aria-checked", "true");
    await page.locator('[data-testid="payment-method-card"]').tap();
    await expect(page.locator('[data-testid="payment-method-card"]')).toHaveAttribute("aria-checked", "true");

    const confirm = page.locator('[data-testid="button-confirm-payment"]');
    // The confirm bar has to be inside the viewport, not below the fold.
    const box = await confirm.boundingBox();
    expect(box, "confirm button must be laid out").not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(phone.viewport.height);

    const placed = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
    await confirm.tap();
    const res = await placed;
    expect(res.status(), await res.text()).toBe(201);
    // POST /api/orders answers with the engine result (orderId) plus the row.
    const created = (await res.json()) as { orderId?: string; order?: { id?: string } };
    const orderId = created.orderId ?? created.order?.id;
    expect(orderId, "the response must name the order").toBeTruthy();

    // Back on an empty order form, still no dialogs.
    await expect(search).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="pos-checkout-step"]')).toHaveCount(0);
    await expect(dialogs).toHaveCount(0);

    const stored = await okJson<{ paymentMethod: string; total: string }>(await api.get(`/api/orders/${orderId}`));
    expect(stored.paymentMethod).toBe("card");
    expect(parseFloat(stored.total)).toBeCloseTo(9.6, 2);

    await page.context().close();
  });

  test("top-seller chips add a line with one tap", async ({ browser, api, orgId }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const suffix = uniqueSuffix();
    const product = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `Chip Widget ${suffix}`,
          productCode: `CW-${suffix}`.slice(0, 40),
          costPrice: 1,
          salePrice: 2,
          defaultSalePrice: 2,
          stock: 0,
          stockLimit: 100,
        },
      }),
    );
    // Stock first, and plenty of it: an oversold order is held for review,
    // which is not a sale, so it would never count towards the ranking.
    await api.patch(`/api/inventory/${product.id}`, {
      headers: { "x-location-id": locationId },
      data: { adjustment: 100_000, type: "set" },
    });
    // Enough units through the till to land in the top dozen whatever else
    // this database has sold this month (the seeded org accumulates sales
    // from every other journey).
    for (let i = 0; i < 3; i++) {
      const sale = await api.post("/api/orders", {
        headers: { "x-location-id": locationId },
        data: {
          lines: [{ productId: product.id, quantity: 5_000, unitPrice: 2 }],
          paymentMethod: "cash",
        },
      });
      expect(sale.status(), await sale.text()).toBe(201);
    }

    const ranked = await okJson<{ productId: string; units: number }[]>(
      await api.get("/api/products/top-sellers"),
    );
    const mine = ranked.find((r) => r.productId === product.id);
    expect(mine, "the fresh seller must be in the chip strip's dozen").toBeTruthy();
    expect(mine!.units).toBeGreaterThanOrEqual(15_000);

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/create-order");
    const chip = page.locator(`[data-testid="top-seller-${product.id}"]`);
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await chip.tap();
    await expect(page.locator(`[data-testid="order-line-${product.id}"]`)).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    await page.context().close();
  });
});
