/**
 * Suppliers' price check links each product to `/products?product=<id>`.
 * Phase 3 built the link and Phase 2 owned the Products page, so the page
 * never read it back and the link landed on an unfiltered list. It must open
 * that product's card.
 */
import { test, expect, okJson, uniqueSuffix } from "./fixtures";

test("a product link opens that product's card", async ({ api, adminPage }) => {
  const suffix = uniqueSuffix();
  const product = await okJson<{ id: string; name: string }>(
    await api.post("/api/products", {
      data: {
        name: `Linked Widget ${suffix}`,
        productCode: `LW-${suffix}`.slice(0, 40),
        costPrice: 1,
        salePrice: 3,
        defaultSalePrice: 3,
        stock: 0,
        stockLimit: 10,
      },
    }),
  );

  await adminPage.goto(`/products?product=${product.id}`);
  const dialog = adminPage.getByRole("dialog", { name: "Edit product" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog.locator('input[value="' + product.name + '"]')).toBeVisible();
});
