/**
 * The owner's purchasing bug, walked through the browser.
 *
 * A draft raised at a recommended 3,864 was changed to 10,000 and approved —
 * and receiving only ever allowed 3,864. The quantity box only saved via its
 * own Save button, so typing and then pressing a status button threw the typed
 * value away. The service tests cannot see that: this presses the real
 * buttons in the real order.
 */
import { test, expect, firstLocationId, okJson, uniqueSuffix } from "./fixtures";

type Draft = {
  id: string;
  status: string;
  items: { id: string; quantity: number; estimatedCost: string | null }[];
};

async function newDraft(api: any, quantity: number): Promise<{ draftId: string; lineId: string }> {
  const locationId = await firstLocationId(api);
  const suffix = uniqueSuffix();
  const product = await okJson<{ id: string }>(
    await api.post("/api/products", {
      data: {
        name: `Draft Edit ${suffix}`,
        productCode: `DE-${suffix}`.slice(0, 40),
        costPrice: 0.11,
        salePrice: 0.3,
        defaultSalePrice: 0.3,
        stock: 0,
        stockLimit: 100,
      },
    }),
  );
  const supplier = await okJson<{ id: string }>(
    await api.post("/api/suppliers", { data: { name: `Draft Edit Supplier ${suffix}`, leadTimeDays: 2 } }),
  );
  const draft = await okJson<{ id: string }>(
    await api.post("/api/replenishment/create-purchase-draft", {
      data: { supplierId: supplier.id, locationId, items: [{ productId: product.id, quantity }] },
    }),
  );
  const loaded = await okJson<Draft>(await api.get(`/api/purchase-drafts/${draft.id}`));
  return { draftId: draft.id, lineId: loaded.items[0].id };
}

test.describe("purchase draft line editing", () => {
  test("a quantity typed and then straight into a status change is saved, not lost", async ({ api, adminPage }) => {
    const { draftId, lineId } = await newDraft(api, 3864);

    await adminPage.goto(`/purchase-drafts?draft=${draftId}`);
    const qty = adminPage.getByTestId(`input-draft-qty-${lineId}`);
    await expect(qty).toBeVisible({ timeout: 60_000 });

    // No Save button, no tab-away: type, then press the status button.
    await qty.fill("10000");
    await adminPage.getByRole("button", { name: "Mark reviewed" }).click();

    await expect
      .poll(async () => (await okJson<Draft>(await api.get(`/api/purchase-drafts/${draftId}`))).status, {
        timeout: 20_000,
      })
      .toBe("reviewed");
    const saved = await okJson<Draft>(await api.get(`/api/purchase-drafts/${draftId}`));
    expect(saved.items[0].quantity).toBe(10000);
  });

  test("closing the draft with Escape keeps what was typed", async ({ api, adminPage }) => {
    const { draftId, lineId } = await newDraft(api, 40);

    await adminPage.goto(`/purchase-drafts?draft=${draftId}`);
    const qty = adminPage.getByTestId(`input-draft-qty-${lineId}`);
    await expect(qty).toBeVisible({ timeout: 60_000 });

    await qty.fill("250");
    await adminPage.getByTestId(`input-draft-cost-${lineId}`).fill("0.12");
    await adminPage.keyboard.press("Escape");

    await expect(adminPage.getByTestId(`input-draft-qty-${lineId}`)).toBeHidden({ timeout: 20_000 });
    const saved = await okJson<Draft>(await api.get(`/api/purchase-drafts/${draftId}`));
    expect(saved.items[0].quantity).toBe(250);
    expect(saved.items[0].estimatedCost).toBe("0.12");
  });
});
