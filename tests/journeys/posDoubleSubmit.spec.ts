/**
 * v1.2.1 e2e — the till under a heavy thumb, on a desk and on a phone.
 *
 * A cashier double-taps "Take cash", refreshes mid-sale, or loses signal the
 * moment they press it. Whatever happens, exactly one sale may land, and the
 * page must never scroll sideways while it happens. Counted from the database
 * side (orders carrying this test's own product), not from the screen, so a
 * duplicate that the UI hides still fails the test.
 */
import type { Page } from "@playwright/test";
import { sql } from "drizzle-orm";
import { db } from "../../server/db";
import {
  apiAs,
  ensureOpenShift,
  expect,
  firstLocationId,
  okJson,
  pageAs,
  test,
  uniqueSuffix,
} from "./fixtures";

async function ordersWithProduct(productId: string): Promise<number> {
  const res = await db.execute(
    sql`SELECT count(DISTINCT order_id)::int AS n FROM order_items WHERE product_id = ${productId}::uuid`,
  );
  const row = (res as any).rows?.[0] ?? (res as any)[0];
  return Number(row?.n ?? 0);
}

async function noSidewaysScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw, "the till must not scroll sideways").toBeLessThanOrEqual(cw + 2);
}

async function setUp(orgId: string) {
  const admin = await apiAs("ADMIN", orgId);
  const cashier = await apiAs("CASHIER", orgId);
  const locationId = await firstLocationId(admin);
  await ensureOpenShift(cashier, locationId);
  const suffix = uniqueSuffix();
  const product = await okJson<{ id: string; name: string }>(
    await admin.post("/api/products", {
      data: {
        name: `Tap Test ${suffix}`,
        productCode: `TT-${suffix}`.slice(0, 40),
        costPrice: 1,
        salePrice: 5,
        defaultSalePrice: 5,
        stock: 0,
        stockLimit: 100,
      },
    }),
  );
  await admin.patch(`/api/inventory/${product.id}`, {
    headers: { "x-location-id": locationId },
    data: { adjustment: 20, type: "set" },
  });
  await Promise.all([admin.dispose(), cashier.dispose()]);
  return { product, code: `TT-${suffix}`.slice(0, 40) };
}

/** Rings the product up and opens the payment step, on either layout. */
async function ringUp(page: Page, product: { id: string; name: string }, code: string) {
  await page.goto("/pos");
  const search = page.getByTestId("line-product-new");
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill(code);
  const option = page.getByRole("option", { name: new RegExp(product.name) });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(page.getByTestId(`order-line-${product.id}`)).toBeVisible();
  await noSidewaysScroll(page);
  const mobile = page.getByTestId("mobile-checkout-button");
  if (await mobile.isVisible()) await mobile.click();
  else await page.getByTestId("button-checkout").click();
  const confirm = page.getByTestId("button-confirm-payment");
  await expect(confirm).toBeVisible();
  await noSidewaysScroll(page);
  return confirm;
}

for (const [label, viewport] of [
  ["desktop 1440×900", { width: 1440, height: 900 }],
  ["phone 412×915", { width: 412, height: 915 }],
] as const) {
  test.describe(`till under a heavy thumb — ${label}`, () => {
    test.use({ viewport });

    test("a double tap on the pay button records one sale", async ({ browser, orgId }) => {
      const { product, code } = await setUp(orgId);
      const page = await pageAs(browser, "CASHIER", orgId);
      await page.setViewportSize(viewport);
      const confirm = await ringUp(page, product, code);
      const box = await confirm.boundingBox();
      expect(box!.y + box!.height, "the pay button must be on screen").toBeLessThanOrEqual(viewport.height + 1);
      await confirm.dblclick();
      await confirm.click({ force: true, timeout: 2_000 }).catch(() => undefined);
      await expect(page.getByTestId("line-product-new")).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(2_000);
      expect(await ordersWithProduct(product.id), "one sale, however many taps").toBe(1);
      await page.context().close();
    });

    test("refreshing straight after pressing pay does not record the sale twice", async ({ browser, orgId }) => {
      const { product, code } = await setUp(orgId);
      const page = await pageAs(browser, "CASHIER", orgId);
      await page.setViewportSize(viewport);
      const confirm = await ringUp(page, product, code);
      const posted = page.waitForRequest((r) => r.url().endsWith("/api/orders") && r.method() === "POST");
      await confirm.click();
      await posted;
      await page.reload();
      await expect(page.getByTestId("line-product-new")).toBeVisible({ timeout: 60_000 });
      // If the draft survived the reload, pressing pay again must be answered
      // with the sale that already landed, not a second one.
      const again = page.getByTestId(`order-line-${product.id}`);
      if (await again.isVisible().catch(() => false)) {
        const mobile = page.getByTestId("mobile-checkout-button");
        if (await mobile.isVisible()) await mobile.click();
        else await page.getByTestId("button-checkout").click();
        await page.getByTestId("button-confirm-payment").click();
        await page.waitForTimeout(3_000);
      }
      await page.waitForTimeout(2_000);
      expect(await ordersWithProduct(product.id)).toBeLessThanOrEqual(1);
      await noSidewaysScroll(page);
      await page.context().close();
    });

    test("losing signal as pay is pressed queues the sale and lands it once when back online", async ({ browser, orgId }) => {
      const { product, code } = await setUp(orgId);
      const page = await pageAs(browser, "CASHIER", orgId);
      await page.setViewportSize(viewport);
      const confirm = await ringUp(page, product, code);
      await page.context().setOffline(true);
      await confirm.click();
      await page.waitForTimeout(3_000);
      await noSidewaysScroll(page);
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect
        .poll(() => ordersWithProduct(product.id), { timeout: 60_000, message: "the queued sale must land once back online" })
        .toBe(1);
      await page.waitForTimeout(5_000);
      expect(await ordersWithProduct(product.id), "and only once").toBe(1);
      await page.context().close();
    });
  });
}
