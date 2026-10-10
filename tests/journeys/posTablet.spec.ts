/**
 * The order form as a larger window over the Operations Centre board.
 * The board stays on screen to the left of the window and keeps updating.
 * The window must not clip the page sideways, and Create order must sit
 * inside the window and the viewport.
 */
import { expect } from "@playwright/test";
import { ensureOpenShift, firstLocationId, okJson, pageAs, test, uniqueSuffix } from "./fixtures";

async function noHorizontalScroll(page: import("@playwright/test").Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "the page must not scroll horizontally").toBeLessThanOrEqual(clientWidth + 2);
}

test.describe("POS embedded in the Operations Centre pane — 1194×834 (rail)", () => {
  test.use({ viewport: { width: 1194, height: 834 } });

  test("form renders in the pane with no clipping or horizontal scroll", async ({ browser, api, orgId }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const suffix = uniqueSuffix();
    const product = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `Ops Tablet Widget ${suffix}`,
          productCode: `OTW-${suffix}`.slice(0, 40),
          costPrice: 1,
          salePrice: 6,
          defaultSalePrice: 6,
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
    await page.goto("/operations");
    const pane = page.getByTestId("ops-form-pane");
    await expect(page.getByTestId("ops-lane-collection")).toBeVisible({ timeout: 60_000 });
    await expect(pane).toBeVisible();
    await noHorizontalScroll(page);

    const search = pane.getByTestId("line-product-new");
    await expect(search).toBeVisible({ timeout: 30_000 });
    await expect(pane.locator(".pos-cart-rail"), "the old side rail is gone").toHaveCount(0);

    const paneBox = await pane.boundingBox();
    expect(paneBox, "the pane must be laid out").not.toBeNull();
    expect(paneBox!.x, "the board stays visible to the left of the order window").toBeGreaterThan(24);
    expect(paneBox!.width).toBeGreaterThan(500);

    await search.fill(`OTW-${suffix}`);
    const option = page.getByRole("option", { name: new RegExp(product.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();
    await expect(pane.getByTestId(`order-line-${product.id}`)).toBeVisible();
    await expect(pane.getByTestId("mobile-order-total")).toBeVisible();
    await noHorizontalScroll(page);

    await pane.getByTestId("mobile-checkout-button").click();
    await expect(pane.getByTestId("pos-checkout-step")).toBeVisible();
    await expect(pane.getByTestId("chip-channel-walkin")).toBeVisible();
    await expect(pane.getByTestId("select-assignee")).toBeVisible();
    await noHorizontalScroll(page);

    const confirm = pane.getByTestId("button-confirm-payment");
    const confirmBox = await confirm.boundingBox();
    expect(confirmBox, "the confirm button must be laid out").not.toBeNull();
    expect(confirmBox!.x).toBeGreaterThanOrEqual(paneBox!.x - 1);
    expect(confirmBox!.x + confirmBox!.width).toBeLessThanOrEqual(paneBox!.x + paneBox!.width + 1);
    expect(confirmBox!.y + confirmBox!.height, "confirm bar must clear inside the viewport").toBeLessThanOrEqual(834);

    const placed = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
    await confirm.click();
    const res = await placed;
    expect(res.status(), await res.text()).toBe(201);

    await expect(search).toBeVisible({ timeout: 15_000 });
    await noHorizontalScroll(page);

    await page.context().close();
  });
});

test.describe("POS embedded in the Operations Centre pane — 1024×768", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("form renders in the pane with no clipping or horizontal scroll", async ({ browser, api, orgId }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const suffix = uniqueSuffix();
    const product = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `Ops Tablet Widget ${suffix}`,
          productCode: `OTW2-${suffix}`.slice(0, 40),
          costPrice: 1,
          salePrice: 6,
          defaultSalePrice: 6,
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
    await page.goto("/operations");
    const pane = page.getByTestId("ops-form-pane");
    await expect(page.getByTestId("ops-lane-collection")).toBeVisible({ timeout: 60_000 });
    await expect(pane).toBeVisible();
    await noHorizontalScroll(page);

    const search = pane.getByTestId("line-product-new");
    await expect(search).toBeVisible({ timeout: 30_000 });
    await expect(pane.locator(".pos-cart-rail"), "the old side rail is gone").toHaveCount(0);

    const paneBox = await pane.boundingBox();
    expect(paneBox, "the pane must be laid out").not.toBeNull();
    expect(paneBox!.x, "the board stays visible to the left of the order window").toBeGreaterThan(24);
    expect(paneBox!.width).toBeGreaterThan(500);

    await search.fill(`OTW2-${suffix}`);
    const option = page.getByRole("option", { name: new RegExp(product.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();
    await expect(pane.getByTestId(`order-line-${product.id}`)).toBeVisible();
    await noHorizontalScroll(page);

    await pane.getByTestId("mobile-checkout-button").click();
    await expect(pane.getByTestId("pos-checkout-step")).toBeVisible();
    await expect(pane.getByTestId("chip-channel-walkin")).toBeVisible();
    await expect(pane.getByTestId("select-assignee")).toBeVisible();
    await noHorizontalScroll(page);

    const confirm = pane.getByTestId("button-confirm-payment");
    const confirmBox = await confirm.boundingBox();
    expect(confirmBox, "the confirm button must be laid out").not.toBeNull();
    expect(confirmBox!.x).toBeGreaterThanOrEqual(paneBox!.x - 1);
    expect(confirmBox!.x + confirmBox!.width).toBeLessThanOrEqual(paneBox!.x + paneBox!.width + 1);
    expect(confirmBox!.y + confirmBox!.height, "confirm bar must clear inside the viewport").toBeLessThanOrEqual(768);

    const placed = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
    await confirm.click();
    const res = await placed;
    expect(res.status(), await res.text()).toBe(201);

    await expect(search).toBeVisible({ timeout: 15_000 });
    await noHorizontalScroll(page);

    await page.context().close();
  });
});
