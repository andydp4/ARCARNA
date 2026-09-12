/**
 * The Operations Centre board — every card action wired for real (Phase N,
 * N4a; docs/briefs/PHASE_N_OPERATIONS_CENTRE.md "Test matrix" → "Browser
 * journeys" → `operationsBoard.spec.ts`).
 *
 * Every test here clicks a real button in a real browser and then reads the
 * database directly to prove the tap actually reached
 * `POST /api/orders/:id/transition` (or, for a rating, `POST
 * /api/satisfaction`) and committed — the class of bug this suite exists to
 * catch is a UI that shows success with nothing behind it. Server-side time
 * is real throughout (docs/testing/FAKE_TIME.md); nothing here fakes a clock.
 */
import { and, eq } from "drizzle-orm";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "../../server/db";
import { orders as ordersTable, satisfactionScores } from "@shared/schema";
import { authHeaders, ensureOpenShift, firstLocationId, okJson, placeOrder, uniqueSuffix } from "./fixtures";
import { apiForUser, headersFor, opsTest as test, orderInState } from "./opsFixtures";

/** ADMIN, at a specific viewport — `adminPage` (fixtures.ts) does not take one. */
async function pageAtViewport(
  browser: Browser,
  orgId: string,
  viewport: { width: number; height: number },
): Promise<Page> {
  const context = await browser.newContext({ viewport, extraHTTPHeaders: authHeaders("ADMIN", orgId) });
  await context.addInitScript((id) => {
    window.localStorage.setItem("arcarna.selectedOrgId", id);
  }, orgId);
  return context.newPage();
}

/** A page authenticated as an arbitrary (non-seeded) user id, org pre-set — the `pageAs` (fixtures.ts) equivalent for a colleague `secondCashier` creates. */
async function pageForUser(browser: Browser, userId: string, orgId: string): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: headersFor(userId, orgId) });
  await context.addInitScript((id) => {
    window.localStorage.setItem("arcarna.selectedOrgId", id);
  }, orgId);
  return context.newPage();
}

async function orderRow(orderId: string) {
  const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  return row;
}

async function gotoBoard(page: Page): Promise<void> {
  await page.goto("/operations");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("ops-lane-collection")).toBeVisible({ timeout: 60_000 });
}

test.describe("Operations Centre board — every action is a real write", () => {
  test("Take it writes assigned_user_id; Ready writes ready_at; Handed over settles the order", async ({
    adminPage,
    api,
    orgId,
  }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });
    await gotoBoard(adminPage);

    const card = adminPage.getByTestId(`ops-card-${order.id}`);
    await card.scrollIntoViewIfNeeded();
    await adminPage.getByTestId(`ops-claim-${order.id}`).click();
    await expect(adminPage.getByTestId(`ops-assignee-${order.id}`)).toBeVisible({ timeout: 15_000 });
    let row = await orderRow(order.id);
    expect(row.assignedUserId, "claiming from the card should write assigned_user_id").toBeTruthy();
    expect(row.orgId).toBe(orgId);

    await adminPage.getByTestId(`ops-ready-${order.id}`).click();
    await expect(card).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    row = await orderRow(order.id);
    expect(row.readyAt, "Ready from the card should write ready_at").toBeTruthy();

    // Completing removes the card from the live lane altogether — it moves
    // into the (closed by default) Done tray — so the database, not a
    // `data-state` on a card that no longer renders, is what "settled" means
    // here.
    await adminPage.getByTestId(`button-complete-order-${order.id}`).click();
    await expect.poll(async () => (await orderRow(order.id)).status, { timeout: 15_000 }).toBe("completed");
    row = await orderRow(order.id);
    expect(row.settledAt).toBeTruthy();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
  });

  test("a delivery goes claim → ready → out for delivery → Delivered, each one a stamp in the database", async ({
    adminPage,
    api,
  }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "delivery" });
    await gotoBoard(adminPage);
    const card = adminPage.getByTestId(`ops-card-${order.id}`);
    await card.scrollIntoViewIfNeeded();

    await adminPage.getByTestId(`ops-claim-${order.id}`).click();
    await expect(adminPage.getByTestId(`ops-assignee-${order.id}`)).toBeVisible({ timeout: 15_000 });
    await adminPage.getByTestId(`ops-ready-${order.id}`).click();
    await expect(adminPage.getByTestId(`ops-out-${order.id}`)).toBeVisible({ timeout: 15_000 });

    await adminPage.getByTestId(`ops-out-${order.id}`).click();
    await expect(card).toHaveAttribute("data-alert", "false");
    let row = await orderRow(order.id);
    expect(row.outForDeliveryAt, "Out for delivery should write out_for_delivery_at").toBeTruthy();

    await adminPage.getByTestId(`button-complete-order-${order.id}`).click();
    await expect.poll(async () => (await orderRow(order.id)).status, { timeout: 15_000 }).toBe("completed");
    await expect(card).toHaveCount(0, { timeout: 15_000 });
  });

  test("Customer here writes customer_arrived_at on a collection order", async ({ adminPage, api }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });
    await gotoBoard(adminPage);
    await adminPage.getByTestId(`ops-card-${order.id}`).scrollIntoViewIfNeeded();

    await adminPage.getByTestId(`ops-arrived-${order.id}`).click();
    await expect(adminPage.getByTestId(`ops-card-${order.id}`)).toHaveAttribute("data-state", "customer-waiting", {
      timeout: 15_000,
    });
    const row = await orderRow(order.id);
    expect(row.customerArrivedAt).toBeTruthy();
  });

  test("Hold, then Resume, round-trips status and held_at through the overflow menu", async ({ adminPage, api }) => {
    const order = await orderInState(api, db, "on-time");
    await gotoBoard(adminPage);
    const card = adminPage.getByTestId(`ops-card-${order.id}`);
    await card.scrollIntoViewIfNeeded();

    await adminPage.getByTestId(`button-order-actions-${order.id}`).click();
    await adminPage.getByTestId(`ops-hold-${order.id}`).click();
    await adminPage.getByTestId(`input-hold-reason-${order.id}`).fill("Waiting on stock");
    await adminPage.getByTestId(`button-confirm-hold-${order.id}`).click();
    await expect(card).toHaveAttribute("data-state", "held", { timeout: 15_000 });

    let row = await orderRow(order.id);
    expect(row.status).toBe("on-hold");
    expect(row.heldAt).toBeTruthy();

    await adminPage.getByTestId(`ops-resume-${order.id}`).click();
    await expect(card).not.toHaveAttribute("data-state", "held", { timeout: 15_000 });
    row = await orderRow(order.id);
    expect(row.status).not.toBe("on-hold");
    expect(row.heldAt).toBeNull();
  });

  test("Pass to… assigns the order to the chosen colleague", async ({ adminPage, api, cashierB }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });
    await api.post(`/api/orders/${order.id}/transition`, { data: { action: "claim" } });
    await gotoBoard(adminPage);
    const card = adminPage.getByTestId(`ops-card-${order.id}`);
    await card.scrollIntoViewIfNeeded();

    // ADMIN outranks MANAGER, so the "assign to someone else" branch of the
    // RBAC table applies here rather than "passing on one's own order" —
    // both are legal for ADMIN either way.
    await adminPage.getByTestId(`button-order-actions-${order.id}`).click();
    await adminPage.getByTestId(`ops-pass-open-${order.id}`).click();
    await adminPage.getByTestId(`ops-pass-to-${order.id}-${cashierB.userId}`).click();

    await expect
      .poll(async () => (await orderRow(order.id)).assignedUserId, { timeout: 15_000 })
      .toBe(cashierB.userId);
  });

  test("Set due writes eta_given on an order that started with no promise", async ({ adminPage, api, orgId }) => {
    const locationId = await firstLocationId(api);
    const suffix = uniqueSuffix();
    const product = await okJson<{ id: string }>(
      await api.post("/api/products", {
        data: {
          name: `Ops Board Widget ${suffix}`,
          productCode: `OBW-${suffix}`.slice(0, 40),
          costPrice: 2,
          salePrice: 10,
          defaultSalePrice: 10,
          stock: 0,
          stockLimit: 1000,
        },
      }),
    );
    await api.patch(`/api/inventory/${product.id}`, {
      headers: { "x-location-id": locationId },
      data: { adjustment: 100, type: "set" },
    });
    const placed = await okJson<any>(
      await placeOrder(api, locationId, [{ productId: product.id, quantity: 1, unitPrice: 10 }], "cash", {
        fulfilmentMethod: "collection",
      }),
    );
    const orderId: string = placed.orderId ?? placed.id ?? placed.order?.id;
    expect((await orderRow(orderId)).etaGiven, "the seeded order must start with no promise").toBeNull();

    await gotoBoard(adminPage);
    await adminPage.getByTestId(`ops-card-${orderId}`).scrollIntoViewIfNeeded();
    await adminPage.getByTestId(`button-order-actions-${orderId}`).click();
    await adminPage.getByTestId(`ops-set-due-open-${orderId}`).click();
    await adminPage.getByTestId(`chip-set-due-${orderId}-30`).click();

    await expect.poll(async () => (await orderRow(orderId)).etaGiven, { timeout: 15_000 }).not.toBeNull();
    expect((await orderRow(orderId)).orgId).toBe(orgId);
  });

  test("Delay… records delay_flag and a revised time through PATCH …/operations", async ({ adminPage, api }) => {
    const order = await orderInState(api, db, "on-time");
    await gotoBoard(adminPage);
    await adminPage.getByTestId(`ops-card-${order.id}`).scrollIntoViewIfNeeded();

    await adminPage.getByTestId(`button-order-actions-${order.id}`).click();
    await adminPage.getByTestId(`ops-delay-open-${order.id}`).click();
    await adminPage.getByTestId(`chip-delay-${order.id}-20`).click();

    await expect.poll(async () => (await orderRow(order.id)).delayFlag, { timeout: 15_000 }).toBe(true);
    expect((await orderRow(order.id)).revisedEta).toBeTruthy();
  });

  test("Rate posts a real satisfaction score for a completed order", async ({ adminPage, api }) => {
    const order = await orderInState(api, db, "completed");
    await gotoBoard(adminPage);
    await adminPage.getByTestId(`ops-done-tray-${order.input.fulfilmentMethod}`).getByRole("button").first().click();
    const card = adminPage.getByTestId(`ops-card-${order.id}`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    await adminPage.getByTestId(`button-order-actions-${order.id}`).click();
    await adminPage.getByTestId(`ops-rate-open-${order.id}`).click();
    await adminPage.getByTestId(`ops-rate-${order.id}-5`).click();

    await expect
      .poll(
        async () =>
          db
            .select()
            .from(satisfactionScores)
            .where(and(eq(satisfactionScores.orderId, order.id), eq(satisfactionScores.score, 5)))
            .then((rows) => rows.length),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });

  test("Undo: shown only to the completer or MANAGER+, and every tap is a real request", async ({
    browser,
    adminPage,
    api,
    orgId,
    cashierB,
  }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });
    // Complete it as ADMIN through the real transition, so `completedUserId`
    // is ADMIN's id and cashierB is provably a stranger to this order.
    await api.post(`/api/orders/${order.id}/transition`, { data: { action: "claim" } });
    await api.post(`/api/orders/${order.id}/transition`, { data: { action: "ready" } });
    const complete = await api
      .post(`/api/orders/${order.id}/transition`, { data: { action: "complete" } })
      .then((r) => r.json());
    expect(complete.order.status).toBe("completed");

    // Allowed: the completer (ADMIN) sees Undo, and tapping it is a genuine
    // request to the server, not a client-side guess. What the server DOES
    // with it is a second, orthogonal rule this test does not control:
    // `reopen` also refuses once the settlement's trading day has closed
    // (`ORDER_REOPEN_CLOSED_DAY`, brief "Decisions locked" → Reopen) — a
    // shared dev database that has already run a close for today makes that
    // outcome as legitimate as a 200, and either way the row must end up
    // exactly where the response said it would, never somewhere else.
    await gotoBoard(adminPage);
    await adminPage.getByTestId(`ops-done-tray-collection`).getByRole("button").first().click();
    const undoButton = adminPage.getByTestId(`ops-undo-${order.id}`);
    await expect(undoButton).toBeVisible({ timeout: 15_000 });

    const transitionResponse = adminPage.waitForResponse(
      (res) => res.url().includes(`/orders/${order.id}/transition`) && res.request().method() === "POST",
    );
    await undoButton.click();
    const response = await transitionResponse;

    if (response.ok()) {
      await expect.poll(async () => (await orderRow(order.id)).status, { timeout: 15_000 }).not.toBe("completed");
      // Re-complete (assigned + ready survive a reopen) so the forbidden
      // case below has a completed row to test against, same as the server
      // allowed a moment ago.
      const recomplete = await api
        .post(`/api/orders/${order.id}/transition`, { data: { action: "complete" } })
        .then((r) => r.json());
      expect(recomplete.order.status).toBe("completed");
    } else {
      expect(response.status()).toBe(409);
      const body = await response.json();
      expect(["ORDER_REOPEN_REFUSED", "ORDER_REOPEN_CLOSED_DAY"]).toContain(body.code);
      expect(
        (await orderRow(order.id)).status,
        "a refused reopen must leave the row exactly as it was",
      ).toBe("completed");
    }

    // Forbidden: a cashier who neither completed it nor is MANAGER+ sees no
    // Undo button on their own board, AND the server refuses it for real if
    // asked directly — both halves of "restricted to completer or MANAGER+",
    // independent of whatever the closed-day rule decided above.
    const cashierPage = await pageForUser(browser, cashierB.userId, orgId);
    await gotoBoard(cashierPage);
    await cashierPage.getByTestId(`ops-done-tray-collection`).getByRole("button").first().click();
    await expect(cashierPage.getByTestId(`ops-card-${order.id}`)).toBeVisible({ timeout: 15_000 });
    await expect(cashierPage.getByTestId(`ops-undo-${order.id}`)).toHaveCount(0);
    await cashierPage.context().close();

    const apiB = await apiForUser(cashierB.userId, orgId);
    const forbidden = await apiB.post(`/api/orders/${order.id}/transition`, { data: { action: "reopen" } });
    expect(forbidden.status()).toBe(403);
    const forbiddenBody = await forbidden.json();
    expect(forbiddenBody.code).toBe("ORDER_TRANSITION_FORBIDDEN");
    await apiB.dispose();
    expect((await orderRow(order.id)).status, "the forbidden reopen must not have changed anything").toBe(
      "completed",
    );
  });

  /**
   * The claim race, for real: two browser tabs, two people, one order, both
   * taps fired together. This is deliberately not a mocked 409 — the point is
   * that the UI surfaces whatever the server's real `SELECT … FOR UPDATE` /
   * `UPDATE … WHERE assigned_user_id IS NULL` race actually decides
   * (`server/services/orderTransitions.ts`, N3b), not a canned response.
   */
  test("claim race: two tabs tap Take it together, one wins, the other sees a real 409 toast", async ({
    browser,
    adminPage,
    api,
    orgId,
    cashierB,
  }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });

    const cashierPage = await pageForUser(browser, cashierB.userId, orgId);
    await Promise.all([gotoBoard(adminPage), gotoBoard(cashierPage)]);
    await Promise.all([
      adminPage.getByTestId(`ops-card-${order.id}`).scrollIntoViewIfNeeded(),
      cashierPage.getByTestId(`ops-card-${order.id}`).scrollIntoViewIfNeeded(),
    ]);

    const [adminResult, cashierResult] = await Promise.allSettled([
      adminPage.getByTestId(`ops-claim-${order.id}`).click(),
      cashierPage.getByTestId(`ops-claim-${order.id}`).click(),
    ]);
    expect(adminResult.status).toBe("fulfilled");
    expect(cashierResult.status).toBe("fulfilled");

    // Exactly one tab ends up assigned; the loser's tab shows the conflict
    // toast, its own real wording naming who got there first. `.click()`
    // resolving only means the click was dispatched, not that the async
    // mutation it kicked off has reached the server yet — so this polls
    // rather than reading the row the instant both clicks return.
    await expect.poll(async () => (await orderRow(order.id)).assignedUserId, { timeout: 15_000 }).not.toBeNull();
    const row = await orderRow(order.id);

    const loserPage = row.assignedUserId === cashierB.userId ? adminPage : cashierPage;
    await expect(loserPage.getByText(/already assigned|got there first/i).first()).toBeVisible({ timeout: 15_000 });

    await cashierPage.context().close();
  });

  test("offline disables the primary action with a reason, and re-enables once back online", async ({
    adminPage,
    api,
  }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });
    await gotoBoard(adminPage);
    const claimButton = adminPage.getByTestId(`ops-claim-${order.id}`);
    await claimButton.scrollIntoViewIfNeeded();
    await expect(claimButton).toBeEnabled();

    await adminPage.context().setOffline(true);
    await expect(adminPage.getByTestId("ops-stale-banner")).toBeVisible({ timeout: 15_000 });
    await expect(claimButton).toBeDisabled();
    await claimButton.click({ force: true });
    // Refused client-side before any request is made — the row is untouched.
    expect((await orderRow(order.id)).assignedUserId).toBeNull();

    await adminPage.context().setOffline(false);
    await expect(adminPage.getByTestId("ops-stale-banner")).toBeHidden({ timeout: 30_000 });
    await expect(claimButton).toBeEnabled({ timeout: 15_000 });
  });

  test("focus moves to the next card, then the lane heading, as cards leave the live lane", async ({
    adminPage,
    api,
  }) => {
    const first = await orderInState(api, db, "on-time", { fulfilment: "collection" });
    // A second live collection order, so the lane this runs against is never
    // empty — this dev database accumulates many more from other journeys and
    // earlier runs, which is exactly why the assertion below checks the SHAPE
    // of what has focus (a card, or the lane heading) rather than which of the
    // lane's many cards it is: `OpsBoard.tsx`'s own effect moves focus to
    // whatever is now at the completed card's former INDEX, and on a shared,
    // populated board that is not reliably this one order.
    await orderInState(api, db, "on-time", { fulfilment: "collection" });
    await gotoBoard(adminPage);

    await adminPage.getByTestId(`ops-card-${first.id}`).focus();
    await adminPage.getByTestId(`ops-claim-${first.id}`).click();
    await adminPage.getByTestId(`ops-ready-${first.id}`).click();
    await expect(adminPage.getByTestId(`button-complete-order-${first.id}`)).toBeVisible({ timeout: 15_000 });

    await adminPage.getByTestId(`ops-card-${first.id}`).focus();
    await adminPage.getByTestId(`button-complete-order-${first.id}`).click();

    // The completed card leaves the live lane, which is how focus is lost to
    // `<body>` for a moment while React commits — the board's own effect
    // (`OpsBoard.tsx`) then moves it on to whatever is now at that position,
    // or the lane heading. Polling for the FINAL resting place, rather than
    // reading `document.activeElement` once right after the click, is what
    // keeps this from catching that transient body frame and failing on it.
    const readActive = () =>
      adminPage.evaluate(() => ({
        tag: document.activeElement?.tagName ?? null,
        testId: document.activeElement?.getAttribute("data-testid") ?? null,
      }));
    await expect
      .poll(async () => (await readActive()).testId, { timeout: 15_000 })
      .toMatch(/^(ops-card-[0-9a-f-]+|ops-lane-heading-collection)$/);

    const active = await readActive();
    expect(active.tag).not.toBe("BODY");
    expect(active.testId).not.toBe(`ops-card-${first.id}`);
  });

  test("every control on a card is at least 44×44 (WCAG 2.5.5/2.5.8)", async ({ adminPage, api }) => {
    const order = await orderInState(api, db, "on-time", { fulfilment: "collection" });
    await gotoBoard(adminPage);
    const card = adminPage.getByTestId(`ops-card-${order.id}`);
    await card.scrollIntoViewIfNeeded();

    const buttons = card.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await buttons.nth(i).boundingBox();
      expect(box, `button ${i} on the card should have a measurable box`).not.toBeNull();
      if (!box) continue;
      expect(box.width, `button ${i} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `button ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the staff strip and station picker are wired: setting a station round-trips through /api/operations/station", async ({
    adminPage,
    api,
  }) => {
    await gotoBoard(adminPage);
    await expect(adminPage.getByTestId("ops-station-picker")).toBeVisible();

    try {
      const responsePromise = adminPage.waitForResponse(
        (res) => res.url().includes("/api/operations/station") && res.request().method() === "PATCH",
      );
      await adminPage.getByTestId("select-ops-station").click();
      await adminPage.getByTestId("ops-station-option-delivery").click();
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
    } finally {
      // `ops_staff` is sticky, org-wide, real state (brief: "Stations &
      // presence") — every other test in this file creates orders as this
      // SAME actor (ADMIN), and a station this test left set to "delivery"
      // with a fresh `last_seen_at` would make the default-owner rule
      // auto-claim every later collection/delivery order at creation
      // (`ops_auto_claim_on_create`, on by default), breaking every test
      // that expects a fresh order to start unassigned. Clearing it here —
      // not just on success — is what keeps this test's own state from
      // leaking into the rest of the suite or the shared dev database.
      await api.patch("/api/operations/station", { data: { station: null } });
    }
  });

  /**
   * The form pane (N6): a sale placed through the embedded order form beside
   * the board — not through the API, the way every other test in this file
   * does it — lands on the board, and the form's `onPlaced` callback finds,
   * scrolls to and flashes its card (`data-new`, cleared after 4 s).
   * 1194×834 is the brief's own pane reference viewport; `posTablet.spec.ts`
   * covers the form's own layout there and at 1024×768, so this covers what
   * happens on the BOARD side of that same pane.
   */
  test("a sale placed through the pane's embedded form flashes its new card on the board", async ({
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
          name: `Ops Pane Widget ${suffix}`,
          productCode: `OPW3-${suffix}`.slice(0, 40),
          costPrice: 1,
          salePrice: 7,
          defaultSalePrice: 7,
          stock: 0,
          stockLimit: 100,
        },
      }),
    );
    await api.patch(`/api/inventory/${product.id}`, {
      headers: { "x-location-id": locationId },
      data: { adjustment: 10, type: "set" },
    });

    const page = await pageAtViewport(browser, orgId, { width: 1194, height: 834 });
    await page.goto("/operations");
    const pane = page.getByTestId("ops-form-pane");
    await expect(page.getByTestId("ops-lane-collection")).toBeVisible({ timeout: 60_000 });
    const search = pane.getByTestId("line-product-new");
    await expect(search).toBeVisible({ timeout: 30_000 });

    await search.fill(`OPW3-${suffix}`);
    const option = page.getByRole("option", { name: new RegExp(product.name) });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();
    await expect(pane.getByTestId(`order-line-${product.id}`)).toBeVisible();

    await pane.getByTestId("mobile-checkout-button").click();
    const confirm = pane.getByTestId("button-confirm-payment");
    const placed = page.waitForResponse((r) => r.url().endsWith("/api/orders") && r.request().method() === "POST");
    await confirm.click();
    const res = await placed;
    expect(res.status(), await res.text()).toBe(201);
    const created = (await res.json()) as { orderId?: string; order?: { id?: string } };
    const orderId = created.orderId ?? created.order?.id;
    expect(orderId).toBeTruthy();

    const card = page.getByTestId(`ops-card-${orderId}`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute("data-new", "true", { timeout: 15_000 });
    await expect(card).not.toHaveAttribute("data-new", "true", { timeout: 6_000 });

    await page.context().close();
  });
});
