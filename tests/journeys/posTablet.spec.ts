/**
 * The order form embedded in the Operations Centre's 42% pane (Phase N, N6;
 * docs/briefs/PHASE_N_OPERATIONS_CENTRE.md "Form embedding" and "UI" →
 * "Layout"). Rewritten from `tests/visual/pos-tablet.spec.ts` (a `visual`
 * project the CI job never ran, asserting `.pos-tablet-shell` /
 * `.pos-product-grid` classes no component had rendered since the tile-grid
 * POS was replaced — finding G26) against the real, current
 * `@container`-rooted form.
 *
 * The pane is well under the form's own 640 px narrow breakpoint at BOTH
 * viewports this asserts (a 1194 px tablet with the sidebar collapsed to its
 * icon rail leaves a ~1130 px main area, 42% of which is ~461 px; 1024 px
 * leaves ~960 px main, where 42% falls under the pane's own 400 px floor) —
 * so the form is expected to show its phone structure here, and the point of
 * this suite is that doing so never clips or scrolls the page sideways.
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
    await expect(pane.locator(".pos-cart-rail"), "the pane is narrow — no desktop cart rail").toHaveCount(0);

    const paneBox = await pane.boundingBox();
    expect(paneBox, "the pane must be laid out").not.toBeNull();
    expect(paneBox!.width).toBeLessThan(600);
    expect(paneBox!.width).toBeGreaterThanOrEqual(390);

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
    await expect(pane.locator(".pos-cart-rail"), "the pane is narrow — no desktop cart rail").toHaveCount(0);

    const paneBox = await pane.boundingBox();
    expect(paneBox, "the pane must be laid out").not.toBeNull();
    // 42% of a ~960 px main area falls under the pane's 400 px floor, so
    // this viewport pins the pane to its minimum rather than the percentage.
    expect(paneBox!.width).toBeGreaterThanOrEqual(390);
    expect(paneBox!.width).toBeLessThan(500);

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
