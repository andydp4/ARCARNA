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
import { customers, orderExpenses, orders as ordersTable, shifts as shiftsTable } from "@shared/schema";
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

  /**
   * N6's own DoD ("[role=dialog] count 0 throughout a full phone sale") had
   * two holes an adversarial review found: the pre-existing "Redeem loyalty
   * points" `Dialog` in `pos.tsx`, newly reachable from this embedded phone
   * context, and `OpsShiftControls`'s "Z-report so far"/"Close shift", which
   * this package's own module comment says must stay reachable from this
   * exact tab. Both are now inline panels (this file's own `PosCartPanel`
   * and `ShiftCloseWizard`/`ShiftSoFar` change, not a new component) — this
   * proves it with the same continuous poll the rest of this file uses, and
   * proves the loyalty redemption is not just cosmetic by comparing a
   * redeemed sale's real database total against an identical, undiscounted
   * one.
   */
  test("redeeming loyalty points on the Order tab is an inline panel, and the discount really lands on the order and the customer's balance", async ({
    browser,
    api,
    orgId,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const suffix = uniqueSuffix();

    const product = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `Ops Phone Loyalty Widget ${suffix}`,
          productCode: `OPLW-${suffix}`.slice(0, 40),
          costPrice: 5,
          salePrice: 50,
          defaultSalePrice: 50,
          stock: 0,
          stockLimit: 100,
        },
      }),
    );
    await api.patch(`/api/inventory/${product.id}`, {
      headers: { "x-location-id": locationId },
      data: { adjustment: 20, type: "set" },
    });

    // A tier the customer's balance clears, so the redeem card actually
    // shows (`selectedCustomer && customerTier` in pos-cart-panel.tsx).
    const tier = await okJson<{ id: string }>(
      await api.post("/api/loyalty-tiers", {
        data: { name: `Ops Phone Tier ${suffix}`, pointsRequired: 50, discountPercentage: "5" },
      }),
    );
    const customer = await okJson<{ id: string; name: string }>(
      await api.post("/api/customers", {
        data: {
          name: `Ops Phone Loyalty Customer ${suffix}`,
          phone: `+4470${Math.floor(Math.random() * 100_000_000)}`,
        },
      }),
    );
    // loyaltyPoints is write-omitted from insertCustomerSchema (shared/schema.ts)
    // — deliberately not settable through the create route — so it is written
    // directly, the same way `security/tenants.ts` reaches columns no route exposes.
    const startingPoints = 1000;
    await db
      .update(customers)
      .set({ loyaltyPoints: startingPoints, tierId: tier.id })
      .where(eq(customers.id, customer.id));

    const settings = await okJson<{ redemptionRate: number; minRedeemPoints: number }>(
      await api.get("/api/loyalty/settings"),
    );
    const redeemPts = settings.minRedeemPoints;

    const page = await pageAs(browser, "ADMIN", orgId);
    const dialogs = page.locator('[role="dialog"]');

    await page.goto("/operations?pane=order");
    await expect(page).toHaveURL(/\/operations(\?|$)/);
    await expect(page.getByTestId("ops-tab-order")).toHaveAttribute("data-state", "active");
    await expect(dialogs, "no dialog on first paint").toHaveCount(0);

    const search = page.locator('[data-testid="line-product-new"]');
    const option = page.getByRole("option", { name: new RegExp(product.name) });
    const addProductLine = async () => {
      await expect(search).toBeVisible({ timeout: 60_000 });
      await search.fill(`OPLW-${suffix}`);
      await expect(option).toBeVisible({ timeout: 15_000 });
      await option.tap();
      await expect(page.locator(`[data-testid="order-line-${product.id}"]`)).toBeVisible();
    };

    // Baseline sale: same product, no customer, no redemption — the figure
    // the discounted sale below is measured against.
    await addProductLine();
    await expect(dialogs, "no dialog after adding the baseline line").toHaveCount(0);
    await page.locator('[data-testid="mobile-checkout-button"]').tap();
    await expect(page.locator('[data-testid="pos-checkout-step"]')).toBeVisible();
    await expect(dialogs, "no dialog on the baseline payment step").toHaveCount(0);
    const baselinePlaced = page.waitForResponse(
      (r) => r.url().endsWith("/api/orders") && r.request().method() === "POST",
    );
    await page.locator('[data-testid="button-confirm-payment"]').tap();
    const baselineRes = await baselinePlaced;
    expect(baselineRes.status(), await baselineRes.text()).toBe(201);
    const baselineCreated = (await baselineRes.json()) as { orderId?: string; order?: { id?: string } };
    const baselineOrderId = baselineCreated.orderId ?? baselineCreated.order?.id;
    expect(baselineOrderId, "the baseline response must name the order").toBeTruthy();
    await expect(search, "back on an empty form").toBeVisible({ timeout: 15_000 });
    await expect(dialogs, "no dialog once the baseline sale resets").toHaveCount(0);

    // Second sale: the redeeming customer, redeemed through the inline panel.
    await addProductLine();

    await page.locator('[data-testid="select-customer"]').tap();
    await expect(dialogs, "the customer listbox is not a dialog").toHaveCount(0);
    await page.locator('[data-testid="search-customer"]').fill(customer.name);
    const customerOption = page.getByRole("option", { name: new RegExp(customer.name) });
    await expect(customerOption).toBeVisible({ timeout: 15_000 });
    await customerOption.click();
    await expect(page.locator('[data-testid="select-customer"]')).toContainText(customer.name);
    await expect(dialogs, "no dialog after selecting a loyalty customer").toHaveCount(0);

    const redeemButton = page.locator('[data-testid="button-redeem-points"]');
    await expect(redeemButton, "enough points and a matching tier must enable it").toBeEnabled();
    await redeemButton.tap();
    const redeemPanel = page.locator('[data-testid="redeem-points-panel"]');
    await expect(redeemPanel, "the redeem UI is an inline panel, not a Dialog").toBeVisible();
    await expect(dialogs, "still no dialog with the redeem panel open").toHaveCount(0);

    await page.locator('[data-testid="input-redeem-points"]').fill(String(redeemPts));
    const preview = page.waitForResponse(
      (r) => r.url().endsWith("/api/loyalty/redeem-preview") && r.request().method() === "POST",
    );
    await page.locator('[data-testid="button-apply-redeem"]').tap();
    const previewRes = await preview;
    expect(previewRes.status(), await previewRes.text()).toBe(200);
    const previewBody = (await previewRes.json()) as { discountAmount: number };
    await expect(redeemPanel, "applying closes the panel").toHaveCount(0);
    await expect(page.locator('[data-testid="points-redemption"]')).toContainText(
      `£${previewBody.discountAmount.toFixed(2)}`,
    );
    await expect(dialogs, "no dialog once the discount is applied").toHaveCount(0);

    await page.locator('[data-testid="mobile-checkout-button"]').tap();
    await expect(page.locator('[data-testid="pos-checkout-step"]')).toBeVisible();
    await expect(dialogs, "no dialog on the discounted payment step").toHaveCount(0);
    const discountedPlaced = page.waitForResponse(
      (r) => r.url().endsWith("/api/orders") && r.request().method() === "POST",
    );
    await page.locator('[data-testid="button-confirm-payment"]').tap();
    const discountedRes = await discountedPlaced;
    expect(discountedRes.status(), await discountedRes.text()).toBe(201);
    const discountedCreated = (await discountedRes.json()) as { orderId?: string; order?: { id?: string } };
    const discountedOrderId = discountedCreated.orderId ?? discountedCreated.order?.id;
    expect(discountedOrderId, "the discounted response must name the order").toBeTruthy();
    await expect(search, "back on an empty form again").toBeVisible({ timeout: 15_000 });
    await expect(dialogs, "no dialog once the discounted sale resets").toHaveCount(0);

    await page.context().close();

    // Real numbers, from the database — not the UI's own idea of what happened.
    const baselineRow = await orderRow(baselineOrderId!);
    const discountedRow = await orderRow(discountedOrderId!);
    const baselineTotal = parseFloat(String(baselineRow.total));
    const discountedTotal = parseFloat(String(discountedRow.total));
    expect(
      discountedTotal,
      "the redeemed sale must be cheaper than the identical baseline sale by exactly the previewed discount",
    ).toBeCloseTo(baselineTotal - previewBody.discountAmount, 2);

    // The discounted sale is a real, completed order against this customer,
    // so — independently of this redemption — `LoyaltyWorker` also earns it
    // fresh points on its own tick (1 per £1 of the order's own, already
    // discounted, total; server/workers/loyaltyWorker.ts). Both land on the
    // same balance, so the number this test can assert is the net of the
    // two, polled because the earn is asynchronous rather than inline with
    // the request that created the order.
    const expectedBalance = startingPoints - redeemPts + Math.floor(discountedTotal);
    await expect
      .poll(
        async () => {
          const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
          return row.loyaltyPoints;
        },
        {
          timeout: 15_000,
          message:
            "the redeemed points must leave, and the sale's own earned points must land on, the customer's balance",
        },
      )
      .toBe(expectedBalance);
  });

  test("Z-report so far and Close shift are inline panels on the Order tab, not dialogs", async ({
    browser,
    api,
    orgId,
  }) => {
    const locationId = await firstLocationId(api);
    const shiftId = await ensureOpenShift(api, locationId);

    const page = await pageAs(browser, "ADMIN", orgId);
    const dialogs = page.locator('[role="dialog"]');

    await page.goto("/operations?pane=order");
    await expect(page).toHaveURL(/\/operations(\?|$)/);
    await expect(page.getByTestId("ops-tab-order")).toHaveAttribute("data-state", "active");
    // headerExtras (`OpsShiftControls`) sits above the tabs themselves, so it
    // is on screen regardless of which tab is active — the exact reason it
    // must never mount a dialog while a phone cashier is on this one.
    await expect(page.getByTestId("ops-header-extras")).toBeVisible();
    await expect(dialogs, "no dialog on first paint").toHaveCount(0);

    const zReportButton = page.getByTestId("button-z-report-so-far");
    await expect(zReportButton, "an open shift must show the housekeeping buttons").toBeVisible({
      timeout: 15_000,
    });

    await zReportButton.tap();
    const zReportPanel = page.getByTestId("ops-z-report-panel");
    await expect(zReportPanel, "Z-report so far is an inline panel, not a Dialog").toBeVisible();
    await expect(dialogs, "no dialog with the Z-report panel open").toHaveCount(0);
    // Proves it actually loaded a real report, not just an empty shell.
    await expect(zReportPanel.getByText("Z-Report so far")).toBeVisible({ timeout: 15_000 });
    await expect(dialogs, "still no dialog once the figures load").toHaveCount(0);
    await page.getByTestId("button-z-report-close").tap();
    await expect(zReportPanel).toHaveCount(0);

    // Close shift: also inline. Cancelled, not confirmed — this shift stays
    // open for whatever else in this worker still needs it, and a real close
    // is verified separately (see this PR's own notes), not in a suite that
    // runs against a shared database.
    await page.getByTestId("button-close-shift").tap();
    const closePanel = page.getByTestId("shift-close-panel");
    await expect(closePanel, "Close shift is an inline panel, not a Dialog").toBeVisible();
    await expect(dialogs, "no dialog with the close-shift panel open").toHaveCount(0);
    await expect(closePanel.getByText("Close shift")).toBeVisible();
    await page.getByTestId("button-shift-close-cancel").tap();
    await expect(closePanel).toHaveCount(0);
    await expect(dialogs, "no dialog once the close-shift panel is dismissed").toHaveCount(0);

    await page.context().close();

    const [shiftRow] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, shiftId));
    expect(shiftRow.status, "cancelling must not have closed the shift").toBe("open");
  });

  /**
   * The third `role="dialog"` a follow-up adversarial review found reachable
   * from this tab, after the two `8dda00e` already fixed: the customer
   * picker's "Add a new customer" opened `NewCustomerDialog`, a genuine Radix
   * dialog, and that component had exactly one caller anywhere in the
   * codebase — this panel. It is now `NewCustomerPanel`, an inline panel in
   * `pos-cart-panel.tsx` (same file, same shape as the redeem-points panel
   * above), and `NewCustomerDialog.tsx` is gone. This polls
   * `[role="dialog"]` at every step of actually creating a customer through
   * it, then reads the customer back from the database to prove the panel
   * does real work, not just a cosmetic swap.
   */
  test("adding a new customer from the Order tab's customer picker is an inline panel, not a Dialog, and the customer is really created", async ({
    browser,
    api,
    orgId,
  }) => {
    const locationId = await firstLocationId(api);
    await ensureOpenShift(api, locationId);
    const suffix = uniqueSuffix();

    const product = await okJson<{ id: string; name: string }>(
      await api.post("/api/products", {
        data: {
          name: `Ops Phone New Customer Widget ${suffix}`,
          productCode: `OPNC-${suffix}`.slice(0, 40),
          costPrice: 1,
          salePrice: 10,
          defaultSalePrice: 10,
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

    // A continuous poll running the whole time, alongside the step-by-step
    // assertions below: `addInitScript` so it starts fresh on the very first
    // paint (it re-runs on every new document, though this test only
    // navigates once) rather than racing `page.goto`. Fails at the end if
    // anything mounted a dialog at any point this test did not happen to
    // check explicitly.
    await page.addInitScript(() => {
      (window as any).__dialogPollSaw = false;
      const tick = () => {
        if (document.querySelectorAll('[role="dialog"]').length > 0) {
          (window as any).__dialogPollSaw = true;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.goto("/operations?pane=order");
    await expect(page).toHaveURL(/\/operations(\?|$)/);
    await expect(page.getByTestId("ops-tab-order")).toHaveAttribute("data-state", "active");
    await expect(dialogs, "no dialog on first paint").toHaveCount(0);

    const search = page.locator('[data-testid="line-product-new"]');
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill(`OPNC-${suffix}`);
    const option = page.getByRole("option", { name: new RegExp(product.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.tap();
    await expect(page.locator(`[data-testid="order-line-${product.id}"]`)).toBeVisible();
    await expect(dialogs, "no dialog after adding a line").toHaveCount(0);

    const newCustomerName = `Ops Phone New Customer ${suffix}`;

    await page.locator('[data-testid="select-customer"]').tap();
    await expect(dialogs, "the customer listbox is not a dialog").toHaveCount(0);
    await page.locator('[data-testid="search-customer"]').fill(newCustomerName);
    const addNewOption = page.locator('[data-testid="select-customer-new"]');
    await expect(addNewOption).toBeVisible();
    await addNewOption.tap();

    const panel = page.locator('[data-testid="new-customer-panel"]');
    await expect(panel, "adding a customer is an inline panel, not a Dialog").toBeVisible();
    await expect(dialogs, "no dialog once the new-customer panel opens").toHaveCount(0);

    const nameInput = page.locator('[data-testid="input-new-customer-name"]');
    // Pre-filled from the search that came up empty, and focused on open —
    // same behavior the Dialog this replaced had via `onOpenAutoFocus`.
    await expect(nameInput).toHaveValue(newCustomerName);
    await expect(nameInput, "the name field takes focus on open").toBeFocused();
    await expect(dialogs, "no dialog while the form is focused").toHaveCount(0);

    await page.locator('[data-testid="input-new-customer-phone"]').fill("+447700900123");
    await page.locator('[data-testid="input-new-customer-email"]').fill(`${suffix}@example.test`);
    await expect(dialogs, "no dialog while filling the form").toHaveCount(0);

    const createdResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/customers") && r.request().method() === "POST",
    );
    await page.locator('[data-testid="button-save-new-customer"]').tap();
    const createdRes = await createdResponse;
    expect(createdRes.status(), await createdRes.text()).toBe(200);
    await expect(panel, "saving closes the panel").toHaveCount(0);
    await expect(dialogs, "no dialog once the customer is created").toHaveCount(0);
    await expect(page.locator('[data-testid="select-customer"]'), "the new customer is selected for this order").toContainText(
      newCustomerName,
    );

    const finalDialogCount = await dialogs.count();
    expect(finalDialogCount, "no dialog anywhere at the end of the flow").toBe(0);

    const pollSawDialog = await page.evaluate(() => Boolean((window as any).__dialogPollSaw));
    expect(pollSawDialog, "the continuous rAF poll must never have observed a dialog").toBe(false);

    await page.context().close();

    // Read the customer back from the database — proof the panel does real
    // work, not just that the UI looks satisfied.
    const [customerRow] = await db.select().from(customers).where(eq(customers.name, newCustomerName));
    expect(customerRow, "the customer must really be created, not merely selected in the UI").toBeTruthy();
    expect(customerRow.orgId).toBe(orgId);
    expect(customerRow.phone).toBe("+447700900123");
    expect(customerRow.email).toBe(`${suffix}@example.test`);
  });
});
