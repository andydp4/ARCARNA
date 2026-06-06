import { test, expect } from "@playwright/test";
import { prepareTenantContext } from "../helpers/e2eTenant";

/** iPad Pro 11" landscape — brief U7 reference viewport */
test.use({ viewport: { width: 1194, height: 834 } });

test.describe("POS tablet layout", () => {
  test("shell renders grid and cart rail without horizontal scroll", async ({ page, request }) => {
    await prepareTenantContext(page, request);
    await page.goto("/midnight/pos");
    await expect(page.locator(".pos-shell")).toBeVisible({ timeout: 30_000 });
    const shell = page.locator(".pos-tablet-shell");
    await expect(shell).toBeVisible();
    await expect(page.locator(".pos-product-grid")).toBeVisible();
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollW).toBeLessThanOrEqual(clientW + 2);
  });
});
