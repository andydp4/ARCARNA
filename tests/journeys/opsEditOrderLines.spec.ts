/**
 * Adding a new product to an open order from the Operations Centre board's
 * Edit dialog (OpsEditDialog.tsx) — the one thing that dialog could not do
 * before: change quantities and prices, remove a line, but never add one.
 *
 * Drives the real "..." menu → "Edit lines" → product search → Save changes
 * path in a real browser, then reads the order back from the database to
 * prove the added line actually reached `PUT /api/orders/:id` and persisted
 * as a real `order_items` row — not just a client-side list that looked right.
 */
import { eq } from "drizzle-orm";
import { expect, type Page } from "@playwright/test";
import { db } from "../../server/db";
import { orderItems as orderItemsTable } from "@shared/schema";
import { LATEST_WHATS_NEW_VERSION } from "../../shared/whatsNew";
import { LATEST_OPS_TOUR_VERSION, opsTourSeenKey } from "../../shared/opsTour";
import { FEATURE_TOURS, featureTourLocalKey } from "../../shared/uiSeen";
import { firstLocationId, okJson, uniqueSuffix } from "./fixtures";
import { opsTest as test, orderInState } from "./opsFixtures";

async function markOverlaysSeen(page: Page): Promise<void> {
  await page.addInitScript((version) => {
    window.localStorage.setItem(`whatsNew:seen:${version}`, "1");
  }, LATEST_WHATS_NEW_VERSION);
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "1");
  }, opsTourSeenKey(LATEST_OPS_TOUR_VERSION));
  // The v1.2 feature tours (Phase 9): Card (link) at checkout lives on the board.
  await page.addInitScript((keys) => {
    for (const key of keys) window.localStorage.setItem(key, "1");
  }, FEATURE_TOURS.map((feature) => featureTourLocalKey(feature)));
}

async function gotoBoard(page: Page): Promise<void> {
  await page.goto("/operations");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("ops-lane-collection")).toBeVisible({ timeout: 60_000 });
}

test.describe("Operations Centre — editing an order's lines", () => {
  test("adding a product through the Edit dialog's search persists a real new order_items row", async ({
    adminPage,
    api,
  }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });

    // A second, distinct product — never on the order until the dialog adds
    // it — so a pass just because the original line was already there is
    // impossible.
    const suffix = uniqueSuffix();
    const locationId = await firstLocationId(api);
    const addedProduct = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `ZZ-OPS Edit Add ${suffix}`,
          productCode: `OPS-ADD-${suffix}`.slice(0, 40),
          costPrice: 2,
          salePrice: 7.5,
          defaultSalePrice: 7.5,
          stock: 0,
          stockLimit: 500,
        },
      }),
    );
    await api.patch(`/api/inventory/${addedProduct.id}`, {
      headers: { "x-location-id": locationId },
      data: { adjustment: 100, type: "set" },
    });

    await markOverlaysSeen(adminPage);
    await gotoBoard(adminPage);

    await adminPage.getByTestId(`button-order-actions-${order.id}`).click();
    await adminPage.getByTestId("menu-edit-order").click();

    const dialog = adminPage.getByRole("dialog", { name: /Edit order/ });
    await expect(dialog).toBeVisible();

    const search = dialog.getByTestId("ops-edit-add-product");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill(`OPS-ADD-${suffix}`);
    const option = dialog.getByRole("option", { name: new RegExp(addedProduct.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();

    // The new line renders immediately, quantity 1, at the product's price.
    await expect(dialog.getByText(addedProduct.name)).toBeVisible();

    await dialog.getByTestId("button-save-edit").click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
    const addedLine = items.find((orderLine) => orderLine.productId === addedProduct.id);
    expect(addedLine, "the added product must persist as a real order_items row").toBeDefined();
    expect(addedLine?.quantity).toBe(1);
    expect(parseFloat(String(addedLine?.unitPrice))).toBe(7.5);
    // The original line survives alongside the new one — adding is additive,
    // not a silent replace of everything else on the order.
    expect(items.length).toBeGreaterThanOrEqual(2);
  });
});
