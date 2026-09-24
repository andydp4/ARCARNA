/**
 * "This customer already owes" at order start, and Take a payment
 * (v1.2.1 credit).
 *
 * A customer with a tab is chosen on the order form: the till says how much
 * they owe, over how many tabs and since when, and reminds staff to record
 * any payment against the credit. Paying £X from there brings the balance
 * down by exactly £X and, for cash, raises the till's expected cash by
 * exactly £X. The notice never stops the sale.
 *
 * Walked as a CASHIER (the Credit List is manager and above; the till is not;
 * the dev server waves role gates through, so the 403s are proved in
 * server/__tests__/customerCreditTill.test.ts),
 * on the till at desktop width, and in the Operations Centre's order form on
 * a phone order.
 */
import type { APIRequestContext } from "@playwright/test";
import { test, expect, apiAs, ensureOpenShift, firstLocationId, okJson, pageAs, placeOrder, uniqueSuffix } from "./fixtures";

type Summary = { customerId: string; owed: number; tabs: number; oldestGivenOn: string | null };

const round = (n: number) => Math.round(n * 100) / 100;

async function sellableProduct(api: APIRequestContext, locationId: string, code: string) {
  const suffix = uniqueSuffix();
  const product = await okJson<{ id: string; name: string }>(
    await api.post("/api/products", {
      data: {
        name: `Tab Widget ${code} ${suffix}`,
        productCode: `${code}-${suffix}`.slice(0, 40),
        costPrice: 2,
        salePrice: 10,
        defaultSalePrice: 10,
        stock: 0,
        stockLimit: 1000,
      },
    }),
  );
  await okJson(
    await api.patch(`/api/inventory/${product.id}`, {
      headers: { "x-location-id": locationId },
      data: { adjustment: 200, type: "set" },
    }),
  );
  return { ...product, code: `${code}-${suffix}`.slice(0, 40) };
}

/** A customer with two tick sales, completed so they are on the Credit List. */
async function customerWithTabs(api: APIRequestContext, locationId: string, productId: string) {
  const suffix = uniqueSuffix();
  const customer = await okJson<{ id: string; name: string }>(
    await api.post("/api/customers", { data: { name: `Tab Customer ${suffix}`, confirmNew: true } }),
  );
  for (const quantity of [2, 1]) {
    const placed = await okJson<{ orderId?: string; id?: string }>(
      await placeOrder(api, locationId, [{ productId, quantity, unitPrice: 10 }], "tick", { customerId: customer.id }),
    );
    const orderId = (placed.orderId ?? placed.id)!;
    await okJson(await api.patch(`/api/orders/${orderId}`, { data: { status: "completed" } }));
  }
  return customer;
}

async function summaryOf(api: APIRequestContext, customerId: string): Promise<Summary> {
  return okJson<Summary>(await api.get(`/api/customers/${customerId}/credit-summary`));
}

async function expectedCash(api: APIRequestContext, shiftId: string): Promise<number> {
  const body = await okJson<{ report: { cashSummary: { expectedCash: number } } }>(
    await api.get(`/api/shifts/${shiftId}/report`),
  );
  return body.report.cashSummary.expectedCash;
}

test.describe("already owes, at order start", () => {
  // One cashier drawer is shared by these journeys; opening it twice at once is refused.
  test.describe.configure({ mode: "serial" });

  test("a customer with a tab shows the message; paying £X in cash takes exactly £X off and puts £X in expected cash", async ({
    browser,
    api,
    orgId,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId, "TAB");
    const customer = await customerWithTabs(api, locationId, product.id);

    const cashierApi = await apiAs("CASHIER", orgId);
    const shiftId = await ensureOpenShift(cashierApi, locationId);
    const before = await summaryOf(cashierApi, customer.id);
    expect(before.tabs).toBe(2);
    expect(before.owed).toBeGreaterThan(0);
    const cashBefore = await expectedCash(cashierApi, shiftId);

    const page = await pageAs(browser, "CASHIER", orgId);
    await page.goto("/create-order");
    const search = page.getByTestId("line-product-new");
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill(product.code);
    await page.getByRole("option", { name: new RegExp(product.name) }).click();
    await expect(page.getByTestId(`order-line-${product.id}`)).toBeVisible();

    await page.getByTestId("select-customer").click();
    await page.getByTestId("search-customer").fill(customer.name);
    await page.getByRole("option", { name: new RegExp(customer.name) }).click();

    const notice = page.getByTestId("customer-credit-notice");
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("customer-credit-owed")).toHaveText(`This customer already owes £${before.owed.toFixed(2)}`);
    await expect(page.getByTestId("customer-credit-detail")).toContainText("On 2 tabs, the oldest from");
    await expect(notice).toContainText("record it against their credit");

    // Pay £X of it, in cash, from the same screen.
    const paid = 7.35;
    await page.getByTestId("button-take-credit-payment").click();
    await page.getByTestId("input-credit-payment-amount").fill(paid.toFixed(2));
    await page.getByTestId("chip-credit-payment-cash").click();
    const recorded = page.waitForResponse(
      (r) => r.url().includes(`/api/customers/${customer.id}/credit-payments`) && r.request().method() === "POST",
    );
    await page.getByTestId("button-record-credit-payment").click();
    const res = await recorded;
    expect(res.status(), await res.text()).toBe(201);

    const after = await summaryOf(cashierApi, customer.id);
    expect(after.owed).toBe(round(before.owed - paid));
    expect(await expectedCash(cashierApi, shiftId)).toBe(round(cashBefore + paid));
    await expect(page.getByTestId("customer-credit-owed")).toHaveText(`This customer already owes £${after.owed.toFixed(2)}`);

    // The message never blocks the sale: the order still goes through, in cash.
    await page.getByTestId("button-checkout").or(page.getByTestId("mobile-checkout-button")).first().click();
    await expect(page.getByTestId("pos-checkout-step")).toBeVisible();
    await expect(page.getByTestId("customer-credit-notice")).toBeVisible();
    const placed = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
    await page.getByTestId("button-confirm-payment").click();
    const sale = await placed;
    expect(sale.status(), await sale.text()).toBe(201);

    await cashierApi.dispose();
    await page.context().close();
  });

  test("a card payment takes it off the balance but not the drawer", async ({ api, orgId }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId, "TABC");
    const customer = await customerWithTabs(api, locationId, product.id);

    const cashierApi = await apiAs("CASHIER", orgId);
    const shiftId = await ensureOpenShift(cashierApi, locationId);
    const before = await summaryOf(cashierApi, customer.id);
    const cashBefore = await expectedCash(cashierApi, shiftId);

    const res = await cashierApi.post(`/api/customers/${customer.id}/credit-payments`, { data: { amount: 5, method: "card" } });
    expect(res.status(), await res.text()).toBe(201);
    expect((await summaryOf(cashierApi, customer.id)).owed).toBe(round(before.owed - 5));
    expect(await expectedCash(cashierApi, shiftId)).toBe(cashBefore);

    await cashierApi.dispose();
  });

  test("the Operations Centre's order form shows it too, on a phone order", async ({ browser, api, orgId }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await sellableProduct(api, locationId, "TABO");
    const customer = await customerWithTabs(api, locationId, product.id);
    const owed = (await summaryOf(api, customer.id)).owed;

    const page = await pageAs(browser, "MANAGER", orgId);
    await page.setViewportSize({ width: 1194, height: 834 });
    await page.goto("/operations");
    const pane = page.getByTestId("ops-form-pane");
    const search = pane.getByTestId("line-product-new");
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill(product.code);
    await page.getByRole("option", { name: new RegExp(product.name) }).click();
    await expect(pane.getByTestId(`order-line-${product.id}`)).toBeVisible();

    await pane.getByTestId("select-customer").click();
    await pane.getByTestId("search-customer").fill(customer.name);
    await page.getByRole("option", { name: new RegExp(customer.name) }).click();
    await expect(pane.getByTestId("customer-credit-owed")).toHaveText(`This customer already owes £${owed.toFixed(2)}`);

    await pane.getByTestId("mobile-checkout-button").click();
    await pane.getByTestId("chip-channel-phone").click();
    await expect(pane.getByTestId("customer-credit-notice")).toBeVisible();
    await expect(pane.getByTestId("button-take-credit-payment")).toBeVisible();

    await page.context().close();
  });
});
