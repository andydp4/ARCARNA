import { expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import {
  test,
  pageAs,
  firstLocationId,
  okJson,
  ensureOpenShift,
  placeOrder,
  uniqueSuffix,
} from "./fixtures";

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
    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    const tile = page.locator('[data-testid="snapshot-open-orders"]');
    await expect(tile).toBeVisible({ timeout: 30_000 });

    // Reads the number the operator reads, and compares it to the same figure
    // derived from the API. A hardcoded tile passes no version of this.
    //
    // Both reads happen inside the poll. Taking the API count once up front
    // made this test a hostage to the rest of the suite: any sibling that
    // opens or completes an order — U4 does both — moves the real figure while
    // this one waits, and the captured number can then never be reached.
    await expect
      .poll(
        async () => {
          const orders = await okJson<any[]>(await api.get("/api/orders"));
          const open = orders.filter((o) => o.status !== "completed").length;
          const shown = Number((await tile.innerText()).match(/\d+/)?.[0] ?? NaN);
          return shown - open;
        },
        {
          message:
            "the Open orders tile must show the real count of open orders, " +
            "not a placeholder. A non-zero difference here is the tile and the " +
            "API disagreeing after both settled.",
          timeout: 20_000,
        },
      )
      .toBe(0);

    await page.context().close();
  });

  test("U4 the row status selector actually writes the order's status", async ({
    browser,
    api,
    orgId,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const product = await productWithStock(api, locationId, 5);
    const placed = await okJson<any>(
      await placeOrder(api, locationId, [
        { productId: product.id, quantity: 1, unitPrice: 5 },
      ]),
    );
    const orderId = placed.orderId ?? placed.id ?? placed.order?.id;
    expect(orderId, "the order fixture must produce an id to drive the row").toBeTruthy();

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/orders");
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    // Narrow to the order under test — the list groups by status and grows with
    // the seeded data, so the row is otherwise not reliably on screen.
    await page.locator('[data-testid="input-order-search"]').fill(orderId);

    const selector = page
      .locator(`[data-testid="select-order-status-${orderId}"]`)
      .locator("visible=true");
    await expect(
      selector,
      "each order row must carry its own status control — status used to be " +
        "reachable only through a kebab menu and a modal, which is the bug this covers",
    ).toBeVisible({ timeout: 30_000 });

    await selector.click();
    await page.locator('[data-testid="status-option-completed"]').locator("visible=true").click();

    // Completion is the moment Arcarna counts an order as taken, so this is the
    // one status change that must not silently fail. The server is the witness:
    // the row leaves the default "active" filter the instant the optimistic
    // update lands, whether or not the write ever reached the database.
    await expect
      .poll(
        async () => {
          const rows = await okJson<any[]>(await api.get("/api/orders"));
          return rows.find((o) => o.id === orderId)?.status;
        },
        {
          message:
            "picking a status in the row must reach the database. If this is " +
            "still 'pending', the row re-rendered the order out of the list " +
            "before the write was issued and nothing told the operator.",
          timeout: 20_000,
        },
      )
      .toBe("completed");

    await page.context().close();
  });

  test("U5 a new customer can be added from the order being built", async ({
    browser,
    api,
    orgId,
  }) => {
    const name = `Seam Customer ${uniqueSuffix()}`;

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/create-order");
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    const picker = page.locator('[data-testid="select-customer"]').locator("visible=true");
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await picker.click();

    await page.locator('[data-testid="select-customer-new"]').locator("visible=true").click();
    await page.locator('[data-testid="input-new-customer-name"]').locator("visible=true").fill(name);
    await page.locator('[data-testid="button-save-new-customer"]').locator("visible=true").click();

    // Two things have to be true, and only one of them is visible. The customer
    // must exist on the system — the whole point of the bug was that a new face
    // at the counter got rung through as a walk-in and never recorded.
    await expect
      .poll(
        async () => {
          const customers = await okJson<any[]>(await api.get("/api/customers"));
          return customers.some((c) => c.name === name);
        },
        {
          message:
            "adding a customer from the order must write them to the database, " +
            "not just fill in the picker for this one sale",
          timeout: 20_000,
        },
      )
      .toBe(true);

    // And they must be attached to the order in progress, or the operator has
    // to find them again in a list they just left.
    await expect(
      picker,
      "the customer just added must be the one selected for this order",
    ).toContainText(name, { timeout: 15_000 });

    await page.context().close();
  });

  test("U6 Order lines shows one search box, and it searches the whole catalogue", async ({
    browser,
    api,
    orgId,
  }) => {
    const locationId = await firstLocationId(api);
    const target = await productWithStock(api, locationId, 3);
    const decoy = await productWithStock(api, locationId, 3);

    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/create-order");
    await expect(page.locator("#root")).toBeVisible({ timeout: 60_000 });

    // Tiles is the default mode and owns the top search box.
    const topSearch = page.locator('[data-testid="search-products"]').locator("visible=true");
    await expect(topSearch).toBeVisible({ timeout: 30_000 });

    // Narrow the grid to the decoy, then switch to Order lines. The top box used
    // to stay on screen — a second search stacked above the per-line one — and
    // its query kept filtering what the line picker could offer, so the product
    // under test was invisible with nothing on screen to explain why.
    await topSearch.fill(decoy.name);
    await page.locator('[data-testid="pos-entry-mode-lines"]').locator("visible=true").click();

    await expect(
      page.locator('[data-testid="search-products"]'),
      "Order lines searches per line, so the tile grid's search box must not " +
        "also be on screen",
    ).toHaveCount(0);

    const linePicker = page.locator('[data-testid="line-product-new"]').locator("visible=true");
    await expect(linePicker).toBeVisible({ timeout: 15_000 });
    await linePicker.click();
    await page
      .locator('[data-testid="line-product-new-search"]')
      .locator("visible=true")
      .fill(target.name);

    await expect(
      page.getByRole("option", { name: new RegExp(target.name) }),
      "the line picker must search the whole catalogue — a query left in the " +
        "tile grid's box must not decide what can be ordered here",
    ).toBeVisible({ timeout: 15_000 });

    await page.context().close();
  });
});
