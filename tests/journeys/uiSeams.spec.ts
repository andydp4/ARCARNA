import { expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { test, pageAs, firstLocationId, okJson } from "./fixtures";

/** A product with a known stock level at `locationId`, created fresh per test. */
async function productWithStock(
  api: APIRequestContext,
  locationId: string,
  stock: number,
): Promise<{ id: string; name: string }> {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const created = await okJson<any>(
    await api.post("/api/products", {
      data: {
        name: `Seam Widget ${suffix}`,
        productCode: `SW-${suffix}`.slice(0, 40),
        costPrice: 1,
        salePrice: 5,
        defaultSalePrice: 5,
        stock: 0,
        stockLimit: 1000,
      },
    }),
  );
  await api.patch(`/api/inventory/${created.id}`, {
    headers: { "x-location-id": locationId },
    data: { adjustment: stock, type: "set" },
  });
  return { id: created.id, name: created.name };
}

/**
 * UI seams: does operating a control actually change the system?
 *
 * Every other suite here is API-level. They proved the backend correct while
 * four separate controls did nothing at all — the product Stock input was
 * rendered, stripped from the payload, and still toasted "Product updated
 * successfully"; "Create invoice" had no handler and no endpoint behind it;
 * "View All" went nowhere; a disabled prev/next pretended a truncated list was
 * one page long. Each layer was individually correct, so no unit test failed.
 *
 * The Playwright smoke suite could not catch them either: it is three tests
 * against an empty database, so no product row exists, no dialog ever opens, and
 * no row-level control is ever rendered to be clicked.
 *
 * These tests drive the real screens against seeded data and assert the system
 * changed — not that a toast appeared.
 */
test.describe("UI seams", () => {
  test("U1 editing a product's stock actually writes it", async ({ browser, api, orgId }) => {
    const locationId = await firstLocationId(api);
    const product = await productWithStock(api, locationId, 12);
    const target = 19;

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/products");
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    // Narrow the list to the product under test — otherwise the row may be
    // below the fold or on a later page as the catalogue grows.
    await page.locator('[data-testid="input-search-products"]').fill(product.name);

    // By accessible name, which is how a real operator finds it. Both the mobile
    // card list and the desktop table render an Edit control for each product and
    // only one is visible at a given width, so take the visible one rather than
    // the first in DOM order.
    await page
      .locator(`[aria-label="Edit ${product.name}"]`)
      .locator("visible=true")
      .first()
      .click();

    const stockInput = page.locator("#edit-stock").locator("visible=true");
    await expect(
      stockInput,
      "the Edit dialog must offer a stock control — if this fails the field was removed rather than wired",
    ).toBeVisible({ timeout: 15_000 });

    await stockInput.fill(String(target));
    await page.locator('[data-testid="button-update-product"]').locator("visible=true").click();

    // The assertion that matters: the server agrees. A toast proves nothing —
    // the bug this test exists for showed a success toast every single time.
    await expect
      .poll(
        async () => {
          const rows = await okJson<any[]>(await api.get("/api/products"));
          return Number(rows.find((p) => p.id === product.id)?.stock ?? NaN);
        },
        {
          message:
            "stock typed into the Edit dialog must reach the database. If this is " +
            "the original value, a field list between the form and the server " +
            "dropped it and the save still reported success.",
          timeout: 20_000,
        },
      )
      .toBe(target);

    await page.context().close();
  });

  test("U2 every control on the Control Centre does something", async ({ browser, orgId }) => {
    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    // Open every disclosure so collapsed controls are in scope too.
    for (const summary of await page.locator("details > summary").all()) {
      await summary.click().catch(() => {});
    }

    const buttons = await page.locator("button:visible").all();
    const inert: string[] = [];

    for (const button of buttons) {
      const isWired = await button.evaluate((el) => {
        // A control is legitimate if React attached a handler, it submits a
        // form, or it is a trigger/link in disguise.
        const hasReactHandler = Object.keys(el).some(
          (k) => k.startsWith("__reactProps") && (el as any)[k]?.onClick,
        );
        const submits = el.getAttribute("type") === "submit";
        const isTrigger = el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-expanded");
        const wrapsLink = !!el.closest("a") || !!el.querySelector("a");
        return hasReactHandler || submits || isTrigger || wrapsLink;
      });
      if (!isWired) {
        inert.push(
          ((await button.getAttribute("data-testid")) ??
            (await button.getAttribute("aria-label")) ??
            (await button.innerText()).slice(0, 40)) || "<unnamed>",
        );
      }
    }

    expect(
      inert,
      "these buttons render on the dashboard and do nothing when clicked — " +
        "decoration that reads as function is what makes the page untrustworthy",
    ).toEqual([]);

    await page.context().close();
  });

  test("U3 the operations tiles show counts that match the API", async ({
    browser,
    api,
    orgId,
  }) => {
    const orders = await okJson<any[]>(await api.get("/api/orders"));
    const expectedOpen = orders.filter((o) => o.status !== "completed").length;

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    const tile = page.locator('[data-testid="snapshot-open-orders"]');
    await expect(tile).toBeVisible({ timeout: 30_000 });

    // Reads the number the operator reads, and compares it to the same figure
    // derived from the API. A hardcoded tile passes no version of this.
    await expect
      .poll(
        async () => {
          const text = await tile.innerText();
          const match = text.match(/\d+/);
          return match ? Number(match[0]) : NaN;
        },
        {
          message:
            "the Open orders tile must show the real count of open orders, " +
            "not a placeholder",
          timeout: 20_000,
        },
      )
      .toBe(expectedOpen);

    await page.context().close();
  });
});
