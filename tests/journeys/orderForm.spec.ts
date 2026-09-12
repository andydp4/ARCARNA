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

  test("customer search stays open when the search box is tapped", async ({ browser, api, orgId }) => {
    // The customer picker used to be a Radix Select with a search input
    // dropped inside its portal content — reported closing the whole menu
    // on Android when tapping that input to raise the keyboard. Rebuilt as
    // inline content (no portal), like ProductSearch, which cannot be
    // dismissed by a Popper/focus-guard reacting to the keyboard opening,
    // because there is no Popper.
    //
    // This does not reproduce the reported failure directly: Playwright's
    // touch emulation taps and focuses but never raises a real on-screen
    // keyboard or resizes the visual viewport, and the old Select passed
    // this same assertion in that harness. What it does verify is that the
    // new implementation behaves correctly end to end (opens, keeps the
    // list open through typing, selects) — a real Android device is the
    // only way to confirm the original symptom itself is gone.
    const suffix = uniqueSuffix();
    const customer = await okJson<{ id: string; name: string }>(
      await api.post("/api/customers", { data: { name: `Phone Customer ${suffix}` } }),
    );

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/create-order");

    const trigger = page.locator('[data-testid="select-customer"]');
    await expect(trigger).toBeVisible({ timeout: 60_000 });
    await trigger.tap();

    const search = page.locator('[data-testid="search-customer"]');
    await expect(search).toBeVisible();
    // A real tap, as a thumb bringing up the keyboard would do it — the
    // reported failure was the menu closing on exactly this.
    await search.tap();
    await expect(search).toBeFocused();
    await search.fill(suffix);

    const option = page.getByRole("option", { name: new RegExp(customer.name) });
    await expect(option, "the dropdown must still be open after tapping the search box").toBeVisible();
    await option.tap();
    await expect(trigger).toContainText(customer.name);

    await page.context().close();
  });

  test("a consumed WhatsApp draft pre-selects the WhatsApp channel chip (N6)", async ({ browser, api, orgId }) => {
    const suffix = uniqueSuffix();
    // POST /api/products answers with this field named `productCode`; GET
    // /api/products (what pos.tsx actually reads) renames it to `productId`
    // (`PosProduct.productId`) — the code this test created it with either
    // way, kept locally rather than trusted from either response shape.
    const code = `WDW-${suffix}`.slice(0, 40);
    const product = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `WA Draft Widget ${suffix}`,
          productCode: code,
          costPrice: 1,
          salePrice: 5,
          defaultSalePrice: 5,
          stock: 0,
          stockLimit: 100,
        },
      }),
    );

    const page = await pageAs(browser, "ADMIN", orgId);
    // Mirrors `stashWhatsappDraft` (client/src/lib/whatsappDraft.ts): the
    // panel writes this before navigating to the till, and `consumeWhatsappDraft`
    // reads and clears it once on mount. Written via `addInitScript` so it is
    // there before the form's own consuming effect ever runs. `sku` is matched
    // against the catalogue's own code (`PosProduct.productId`), not the
    // database row id — see `pos.tsx`'s draft-consuming effect.
    await page.addInitScript(
      (value) => window.sessionStorage.setItem("arcarna.whatsapp.draftOrder", JSON.stringify(value)),
      { conversationId: `wa-${suffix}`, customerId: null, items: [{ sku: code, name: product.name, quantity: 1 }] },
    );

    await page.goto("/create-order");
    await expect(page.locator('[data-testid="line-product-new"]')).toBeVisible({ timeout: 60_000 });
    // Not the toast: the confirming toast this same effect fires auto-dismisses
    // after 5 s (`TOAST_REMOVE_DELAY`, use-toast.ts) and the consuming effect
    // itself waits on customers as well as products loading, so a toast
    // assertion sequenced after the line-product-new wait above races that
    // window and can miss it though the effect ran perfectly correctly. The
    // durable claims — the matched line, and below, the channel chip — do not
    // expire, so they are what this test checks.
    await expect(page.locator(`[data-testid="order-line-${product.id}"]`)).toBeVisible({ timeout: 45_000 });

    await page.locator('[data-testid="mobile-checkout-button"]').tap();
    await expect(page.locator('[data-testid="pos-checkout-step"]')).toBeVisible();
    // The order came in over WhatsApp — the channel chip must say so without
    // the cashier having to remember to pick it (brief, "Form embedding").
    await expect(page.locator('[data-testid="chip-channel-whatsapp"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-testid="chip-channel-walkin"]')).toHaveAttribute("aria-checked", "false");

    await page.context().close();
  });
});
