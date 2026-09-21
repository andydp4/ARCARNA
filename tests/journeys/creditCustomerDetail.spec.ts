/**
 * Credit customers — click-through detail.
 *
 * The credit list page had a "click a customer" affordance that did nothing:
 * `GET /api/tick-customers` hardcoded `orders: []`, so there was never
 * anything to show. This walks the fixed page end to end — two tick sales
 * against one customer roll up into one row and one total (not listed
 * sparsely), clicking the customer opens a summary naming both orders, and
 * clicking an order reveals the line(s) it's made up of, fetched lazily.
 */
import { test, expect, ensureOpenShift, firstLocationId, okJson, placeOrder, uniqueSuffix } from "./fixtures";

type Product = { id: string; name: string; defaultSalePrice: number };

async function creditTestProduct(api: any, locationId: string): Promise<Product> {
  const suffix = uniqueSuffix();
  const name = `ZZ Credit Detail Widget ${suffix}`;
  const unitPrice = 15;
  const created = await okJson<{ id: string }>(
    await api.post("/api/products", {
      data: {
        name,
        productCode: `CRD-${suffix}`.slice(0, 40),
        costPrice: 4,
        // The engine reads `salePrice`; sending only defaultSalePrice creates
        // the product at zero (money.spec.ts documents this).
        salePrice: unitPrice,
        defaultSalePrice: unitPrice,
        stock: 0,
        stockLimit: 1000,
      },
    }),
  );
  const seeded = await api.patch(`/api/inventory/${created.id}`, {
    headers: { "x-location-id": locationId },
    data: { adjustment: 500, type: "set" },
  });
  if (!seeded.ok()) {
    throw new Error(
      `Could not seed stock for the credit-detail fixture product: ${seeded.status()} ${await seeded.text()}`,
    );
  }
  return { id: created.id, name, defaultSalePrice: unitPrice };
}

test.describe("Credit customer click-through detail", () => {
  test("two tick sales roll up into one customer, and each order's lines show on demand", async ({
    api,
    adminPage,
  }) => {
    const suffix = uniqueSuffix();
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await creditTestProduct(api, locationId);

    const customerName = `ZZ Credit Detail Customer ${suffix}`;
    const customer = await okJson<{ id: string }>(
      await api.post("/api/customers", {
        data: { name: customerName, email: `credit-detail-${suffix}@seed.local`, phone: "07700900123" },
      }),
    );

    // Order A: sold on tick, never paid down — stays "outstanding" ("Pending").
    const orderA = await okJson<{ orderId?: string; id?: string }>(
      await placeOrder(
        api,
        locationId,
        [{ productId: product.id, quantity: 2, unitPrice: product.defaultSalePrice }],
        "tick",
        { customerId: customer.id },
      ),
    );
    const orderAId = (orderA.orderId ?? orderA.id)!;
    await okJson(await api.patch(`/api/orders/${orderAId}`, { data: { status: "completed" } }));
    // The credit amount is the order's real total, tax included where the org
    // charges it — read back rather than assumed, so this test holds
    // regardless of tax configuration.
    const orderATotal = Number((await okJson<{ total: string }>(await api.get(`/api/orders/${orderAId}`))).total);

    // Order B: sold on tick, then paid down partially — becomes "partial".
    const orderB = await okJson<{ orderId?: string; id?: string }>(
      await placeOrder(
        api,
        locationId,
        [{ productId: product.id, quantity: 4, unitPrice: product.defaultSalePrice }],
        "tick",
        { customerId: customer.id },
      ),
    );
    const orderBId = (orderB.orderId ?? orderB.id)!;
    await okJson(await api.patch(`/api/orders/${orderBId}`, { data: { status: "completed" } }));
    const orderBTotal = Number((await okJson<{ total: string }>(await api.get(`/api/orders/${orderBId}`))).total);
    const paymentAmount = 20;
    await okJson(await api.post(`/api/credit/${orderBId}/payments`, { data: { amount: paymentAmount, method: "cash" } }));
    const orderBOutstanding = Math.round((orderBTotal - paymentAmount) * 100) / 100;
    const totalOutstanding = Math.round((orderATotal + orderBOutstanding) * 100) / 100;

    await adminPage.goto("/tick-list");
    await adminPage.getByTestId("input-search-tick").fill(customerName);

    const viewButton = adminPage.getByTestId(`button-view-customer-${customer.id}`);
    await expect(viewButton).toBeVisible();
    await viewButton.click();

    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(customerName, { exact: true })).toBeVisible();
    await expect(adminPage.getByTestId("text-detail-total-debt")).toHaveText(`£${totalOutstanding.toFixed(2)}`);
    await expect(dialog.getByText("2 orders")).toBeVisible();

    const rowA = adminPage.getByTestId(`button-credit-order-${orderAId}`);
    await expect(rowA).toContainText("Pending");
    const rowB = adminPage.getByTestId(`button-credit-order-${orderBId}`);
    await expect(rowB).toContainText("Partial");
    await expect(rowB).toContainText(`of £${orderBTotal.toFixed(2)}`);

    await rowA.click();
    const linesA = adminPage.getByTestId(`credit-order-lines-${orderAId}`);
    await expect(linesA).toContainText(product.name);
    await expect(linesA).toContainText("2 × £15.00");
    await expect(linesA).toContainText("£30.00");

    await rowB.click();
    const linesB = adminPage.getByTestId(`credit-order-lines-${orderBId}`);
    await expect(linesB).toContainText("4 × £15.00");
    await expect(linesB).toContainText("£60.00");
  });
});
