/**
 * The order form on a phone, embedded in the Operations Centre's "New order"
 * tab (Phase N, N6; docs/briefs/PHASE_N_OPERATIONS_CENTRE.md "Form
 * embedding"). `orderForm.spec.ts` proved the same no-dialog, normal-page-flow
 * form on the old standalone `/create-order`; this proves the identical
 * contract holds once that form is embedded — `/create-order` now redirects
 * here — AND that the fields it gained in N6 (channel, due time, assignee,
 * expenses) actually reach the order: read back from the database, not
 * merely accepted by the UI.
 *
 * Server-side time is real throughout (docs/testing/FAKE_TIME.md).
 */
import { devices, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { orderExpenses, orders as ordersTable } from "@shared/schema";
import { ensureOpenShift, firstLocationId, okJson, pageAs, uniqueSuffix } from "./fixtures";
import { opsTest as test } from "./opsFixtures";

const phone = devices["Pixel 7"];

async function orderRow(orderId: string) {
  const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  return row;
}

test.describe("order form on a phone, embedded in the Operations Centre", () => {
  test.use({ viewport: phone.viewport, hasTouch: true, isMobile: true, userAgent: phone.userAgent });

  test("a full sale on the Order tab sets due, channel, assignee and an expense, with zero dialogs throughout", async ({
    browser,
    api,
    orgId,
    cashierB,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const suffix = uniqueSuffix();
    const product = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `Ops Phone Widget ${suffix}`,
          productCode: `OPW-${suffix}`.slice(0, 40),
          costPrice: 1,
          salePrice: 12,
          defaultSalePrice: 12,
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

    await page.goto("/operations?pane=order");
    // `/create-order` and `/pos` redirect here (brief, "Route & nav"); this
    // goes straight to the destination so the assertion is on the form
    // itself, not on the redirect plumbing (orderForm.spec.ts still exercises
    // `/create-order` end to end).
    await expect(page).toHaveURL(/\/operations(\?|$)/);
    await expect(page.getByTestId("ops-tab-order")).toHaveAttribute("data-state", "active");
    await expect(dialogs, "no dialog on first paint").toHaveCount(0);

    const search = page.locator('[data-testid="line-product-new"]');
    await expect(search).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="mobile-cart-button"]'), "no cart sheet trigger").toHaveCount(0);

    await search.fill(`OPW-${suffix}`);
    const option = page.getByRole("option", { name: new RegExp(product.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.tap();
    await expect(page.locator(`[data-testid="order-line-${product.id}"]`)).toBeVisible();
    await expect(dialogs, "no dialog after adding a line").toHaveCount(0);

    await page.locator('[data-testid="mobile-checkout-button"]').tap();
    const step = page.locator('[data-testid="pos-checkout-step"]');
    await expect(step).toBeVisible();
    await expect(dialogs, "no dialog on the payment step").toHaveCount(0);

    // Channel: this order came in by phone, not off the street.
    await page.locator('[data-testid="chip-channel-phone"]').tap();
    await expect(page.locator('[data-testid="chip-channel-phone"]')).toHaveAttribute("aria-checked", "true");
    // Phone pre-selects +30, so this also proves the auto-default fired.
    await expect(page.locator('[data-testid="chip-due-30"]')).toHaveAttribute("aria-checked", "true");
    // Pick an explicit due chip so the read-back below is against a value
    // this test chose, not the auto-default.
    await page.locator('[data-testid="chip-due-15"]').tap();
    await expect(page.locator('[data-testid="chip-due-15"]')).toHaveAttribute("aria-checked", "true");

    // Assignee: hand it to a named colleague rather than the auto-assign
    // default, so the read-back proves the override reaches the order.
    await page.locator('[data-testid="select-assignee"]').tap();
    await expect(dialogs, "the assignee listbox is not a dialog").toHaveCount(0);
    await page.getByTestId(`assignee-option-${cashierB.userId}`).click();
    await expect(page.locator('[data-testid="select-assignee"]')).toContainText(cashierB.name);

    // Expenses: a travel cost keyed at checkout. The block is a plain
    // <details>, closed until there is at least one expense — open it first.
    await page.getByText("Order expenses (optional)").tap();
    await page.locator('[data-testid="select-expense-category"]').tap();
    await expect(dialogs, "the category listbox is not a dialog").toHaveCount(0);
    await page.getByRole("option", { name: "Travel" }).click();
    await page.locator('[data-testid="input-expense-desc"]').fill("Fuel");
    await page.locator('[data-testid="input-expense-amt"]').fill("2.50");
    await page.locator('[data-testid="button-add-order-expense"]').tap();
    await expect(page.getByText("travel: Fuel")).toBeVisible();
    await expect(dialogs, "no dialog after adding an expense").toHaveCount(0);

    const confirm = page.locator('[data-testid="button-confirm-payment"]');
    const box = await confirm.boundingBox();
    expect(box, "confirm button must be laid out").not.toBeNull();
    expect(box!.y + box!.height, "the confirm bar must clear inside the phone viewport").toBeLessThanOrEqual(
      phone.viewport.height,
    );

    const before = Date.now();
    const placed = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
    await confirm.tap();
    const res = await placed;
    expect(res.status(), await res.text()).toBe(201);
    const created = (await res.json()) as { orderId?: string; order?: { id?: string; total?: string } };
    const orderId = created.orderId ?? created.order?.id;
    expect(orderId, "the response must name the order").toBeTruthy();

    // Back on an empty form, still no dialogs, still on the Order tab.
    await expect(search).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="pos-checkout-step"]')).toHaveCount(0);
    await expect(dialogs, "no dialog once the form resets").toHaveCount(0);
    await expect(search, "focus returns to the product search").toBeFocused();

    // The form's own state reset for the next sale: channel, due and assignee
    // do not carry the last sale's picks into the next one. Checkout only
    // opens with something on the order, so a second (never-submitted) line
    // is what reaches step 2 to check the chips are back at their defaults.
    await search.fill(`OPW-${suffix}`);
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.tap();
    await page.locator('[data-testid="mobile-checkout-button"]').tap();
    await expect(page.locator('[data-testid="chip-channel-walkin"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-testid="chip-due-15"]')).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('[data-testid="select-assignee"]')).toContainText("Auto-assign");

    // Read back for real — every field this package added, from the database
    // and the API, not the client's own optimistic idea of what it sent.
    const row = await orderRow(orderId!);
    expect(row.orgId).toBe(orgId);
    expect(row.channel).toBe("phone");
    expect(row.assignedUserId, "the explicit assignee must be written").toBe(cashierB.userId);
    expect(row.etaGiven, "dueInMinutes must reach eta_given").toBeTruthy();
    const dueAt = new Date(row.etaGiven!).getTime();
    expect(dueAt).toBeGreaterThan(before + 14 * 60_000);
    expect(dueAt).toBeLessThan(before + 16 * 60_000);

    const detail = await okJson<{ total: string }>(await api.get(`/api/orders/${orderId}`));
    const saleTotal = parseFloat(detail.total);
    // £12 + org VAT, no expense mixed in — a wrongly-inflated total (+£2.50)
    // would be ~£16.90 and fail this upper bound.
    expect(saleTotal).toBeGreaterThan(12);
    expect(saleTotal).toBeLessThan(15);
    expect(parseFloat(String(row.total))).toBeCloseTo(saleTotal, 2);

    const expenseRows = await db.select().from(orderExpenses).where(eq(orderExpenses.orderId, orderId!));
    expect(expenseRows, "the checkout expense must land as an order_expenses row").toHaveLength(1);
    expect(expenseRows[0].category).toBe("travel");
    expect(parseFloat(String(expenseRows[0].amount))).toBeCloseTo(2.5, 2);
    expect(expenseRows[0].orgId).toBe(orgId);

    await page.context().close();
  });
});
