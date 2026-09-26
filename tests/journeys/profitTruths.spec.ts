/**
 * Profit Truths (/expense-reports) reads its own API responses.
 *
 * A real bug, unrelated to v1.2/v1.2.1: the page's queryFn returned the raw
 * fetch Response instead of its parsed JSON body (client/src/pages/
 * expense-reports.tsx used to call apiRequest(...) — which resolves to a
 * Response — where every other data-fetching page uses getJson(...)). Every
 * field on the page read as undefined and fell back to its "no data" default,
 * so a shop with real sales and real expenses saw every figure, including the
 * period's day count, as zero. Reported by the owner against the live site
 * ("everything just says zero, even number of days in month says 0").
 */
import {
  test,
  expect,
  ensureOpenShift,
  firstLocationId,
  okJson,
  pageAs,
  placeOrder,
  uniqueSuffix,
} from "./fixtures";

test.describe("Profit Truths reads real figures, not a blank Response", () => {
  test("a settled sale and an expense both show up, and the period is not zero days", async ({
    browser,
    api,
    orgId,
  }) => {
    const suffix = uniqueSuffix();
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);

    const product = await okJson<{ id: string }>(
      await api.post("/api/products", {
        data: {
          name: `Profit Truths Widget ${suffix}`,
          productCode: `PTW-${suffix}`.slice(0, 40),
          costPrice: 4,
          salePrice: 20,
          stock: 100,
        },
      }),
    );

    const created = await okJson<{ orderId: string }>(
      await placeOrder(api, locationId, [{ productId: product.id, quantity: 1, unitPrice: 20 }], "cash"),
    );
    await okJson(await api.patch(`/api/orders/${created.orderId}`, { data: { status: "completed" } }));

    await okJson(
      await api.post("/api/overhead-expenses", {
        data: {
          name: `Profit Truths test expense ${suffix}`,
          category: "rent",
          description: `Profit Truths test expense ${suffix}`,
          amount: "70.00",
          frequency: "monthly",
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          isActive: 1,
        },
      }),
    );

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/expense-reports");

    // The page's own default period is "This month": today is inside it, so
    // the sale and the expense just recorded must both show.
    const daysText = page.getByText(/\(\d+ days\)/);
    await expect(daysText, "the period must never read as 0 days").toBeVisible({ timeout: 30_000 });
    await expect(daysText).not.toHaveText("(0 days)");

    // Real revenue for the month (this org's "This month" figure includes
    // other sales too, so this checks it moved off the broken £0.00 default
    // rather than an exact total), including the £20 sale just settled.
    await expect(page.getByTestId("text-revenue")).not.toHaveText("£0.00");
    await expect(page.getByTestId("text-net-profit")).not.toHaveText("£0.00");

    await page.context().close();
  });
});
