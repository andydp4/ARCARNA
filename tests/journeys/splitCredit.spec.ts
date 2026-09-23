/**
 * Owner bug, Sept 2026: "when split X amount cash and Y amount credit, Y
 * doesn't show up in the credit list".
 *
 * Production showed both orders stored as cash + CARD. Switching Split on
 * pre-filled the second row with Card; the cashier typed the two amounts and
 * never touched the dropdown, so the credit part was recorded as a card
 * payment and never became a debt. This walks the till the way they did.
 */
import { devices } from "@playwright/test";
import { test, expect, ensureOpenShift, firstLocationId, okJson, pageAs, uniqueSuffix } from "./fixtures";

const phone = devices["Pixel 7"];

test.describe("split payment with a credit part", () => {
  test.use({ viewport: phone.viewport, hasTouch: true, isMobile: true, userAgent: phone.userAgent });

  test("the credit part must be chosen, and then lands on the credit list", async ({ browser, api, orgId }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const suffix = uniqueSuffix();
    const product = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `Split Widget ${suffix}`,
          productCode: `SW-${suffix}`.slice(0, 40),
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
    const customer = await okJson<{ id: string; name: string }>(
      await api.post("/api/customers", { data: { name: `Split Customer ${suffix}` } }),
    );

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/create-order");
    const search = page.locator('[data-testid="line-product-new"]');
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill(`SW-${suffix}`);
    await page.getByRole("option", { name: new RegExp(product.name) }).tap();
    await expect(page.locator(`[data-testid="order-line-${product.id}"]`)).toBeVisible();

    await page.locator('[data-testid="select-customer"]').tap();
    await page.locator('[data-testid="search-customer"]').fill(customer.name);
    await page.getByRole("option", { name: new RegExp(customer.name) }).click();
    await expect(page.locator('[data-testid="select-customer"]')).toContainText(customer.name);

    await page.locator('[data-testid="mobile-checkout-button"]').tap();
    await expect(page.locator('[data-testid="pos-checkout-step"]')).toBeVisible();
    await page.locator('[data-testid="switch-split-payment"]').tap();

    // The second row says nothing until the cashier says something.
    const secondMethod = page.locator('[data-testid="select-tender-method-1"]');
    await expect(secondMethod).toContainText("Choose");

    // £4.80 with VAT: £2.80 cash, £2.00 on credit — typed, dropdown untouched.
    await page.locator('[data-testid="input-tender-amount-0"]').fill("2.80");
    await page.locator('[data-testid="input-tender-amount-1"]').fill("2.00");

    let posted = false;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/orders") && r.method() === "POST") posted = true;
    });
    await page.locator('[data-testid="button-confirm-payment"]').tap();
    await expect(page.getByText("Say how each part was paid").first()).toBeVisible();
    expect(posted, "no sale may go through with an unchosen payment type").toBe(false);

    await secondMethod.tap();
    await page.getByRole("option", { name: "On credit" }).click();
    await expect(secondMethod).toContainText("On credit");

    const placed = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
    await page.locator('[data-testid="button-confirm-payment"]').tap();
    const res = await placed;
    expect(res.status(), await res.text()).toBe(201);
    const created = (await res.json()) as { orderId?: string; order?: { id?: string } };
    const orderId = created.orderId ?? created.order?.id;
    expect(orderId).toBeTruthy();

    // Credit joins the list when the goods leave.
    await okJson(await api.post(`/api/orders/${orderId}/transition`, { data: { action: "complete" } }));
    const list = await okJson<{ id: string; totalDebt: number; orders: { id: string }[] }[]>(
      await api.get("/api/tick-customers"),
    );
    const account = list.find((c) => c.id === customer.id);
    expect(account?.totalDebt).toBe(2);
    expect(account?.orders.map((o) => o.id)).toContain(orderId);

    // And the next sale starts with Split off, not the last customer's rows.
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(`SW-${suffix}`);
    await page.getByRole("option", { name: new RegExp(product.name) }).tap();
    await page.locator('[data-testid="mobile-checkout-button"]').tap();
    await expect(page.locator('[data-testid="switch-split-payment"]')).toHaveAttribute("aria-checked", "false");

    await page.context().close();
  });
});
