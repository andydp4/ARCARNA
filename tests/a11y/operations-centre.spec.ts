/**
 * The Operations Centre, with cards on it.
 *
 * `npm run seed` inserts no orders (finding G13 in
 * docs/briefs/PHASE_N_OPERATIONS_CENTRE.md), which is why the existing a11y
 * job has never once rendered a coloured status — and why a 3.05:1 red label
 * (GAP-U5-04) survived in the product for months with a green CI. An
 * accessibility suite that runs against an empty board proves nothing about a
 * board, so this spec SEEDS one card per state the v0 board can reach and then
 * measures the thing an operator actually looks at.
 *
 * The states seeded here started as the ones v0 could reach over the columns
 * `orders` already had: on time, due soon, late, delayed, held, completed,
 * scheduled and carried over. N4a adds the three that need migration 065's
 * stage columns and the real transition endpoint (N3b): ready, on the road
 * (a claimed delivery, dispatched) and customer waiting — each built by
 * calling `POST /api/orders/:id/transition` for real, so this spec also
 * proves that the cards those actions actually produce are ones axe is happy
 * with, not just that the state machine allows them.
 *
 * Two assertions, not one: axe reports `color-contrast` as *incomplete* rather
 * than as a violation whenever it cannot compute a background — over a
 * gradient, for instance — so a suite that only reads `violations` scores a
 * gradient-backed card as a pass. Both lists are asserted empty.
 *
 * Runs as seed-cashier: the dev bypass authenticates as DEV_AUTH_USER_ID, which
 * playwright.config.ts pins to `seed-cashier`, so this is the board the floor
 * sees rather than an owner's view of it.
 */
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { Result } from "axe-core";
import { and, eq } from "drizzle-orm";
import { db } from "../../server/db";
import { orders as ordersTable } from "@shared/schema";
import { prepareTenantContext } from "../helpers/e2eTenant";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** Every order this spec creates is £5 of one throwaway product. */
const UNIT_PRICE = 5;

type SeededBoard = {
  orgId: string;
  ids: Record<string, string>;
};

function formatViolations(results: Result[]): string {
  return results
    .map(
      (result) =>
        `${result.id} (${result.impact ?? "n/a"}): ${result.help}\n` +
        result.nodes.map((node) => `    ${node.target.join(" ")}`).join("\n"),
    )
    .join("\n");
}

async function okJson<T>(response: {
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
  json(): Promise<any>;
  url(): string;
}): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${response.status()} from ${response.url()}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** A calendar date `days` from now, in the organisation's own timezone. */
function isoDateIn(days: number, timeZone = "Europe/London"): string {
  const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
  return parts;
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

/**
 * One card per reachable state, built the way the shop builds them — through
 * `POST /api/orders` and `PATCH /api/orders/:id` — and then aged by writing the
 * timestamps directly, because no endpoint can make an order that arrived
 * yesterday or is already half an hour late. (The same direct-to-database
 * pattern tests/journeys/security/tenants.ts uses for its second tenant.)
 */
async function seedBoard(request: APIRequestContext, orgId: string): Promise<SeededBoard> {
  const headers = { "X-Org-Id": orgId };

  const locations = await okJson<Array<{ id: string; isActive?: number; isDefault?: number }>>(
    await request.get("/api/locations", { headers }),
  );
  const location = locations.find((l) => l.isDefault === 1 && l.isActive !== 0) ??
    locations.find((l) => l.isActive !== 0);
  if (!location) throw new Error("No active location — is the database seeded?");
  const locationId = location.id;
  const scoped = { ...headers, "x-location-id": locationId };

  // POST /api/orders is gated by requireOpenShift.
  const current = await request.get("/api/shifts/current", { headers: scoped });
  const currentBody = current.ok() ? await current.json() : null;
  const openShiftId = currentBody?.id ?? currentBody?.shift?.id;
  if (!openShiftId || (currentBody?.status ?? currentBody?.shift?.status) !== "open") {
    const opened = await request.post("/api/shifts/open", {
      headers: scoped,
      data: { locationId, openingFloat: 100 },
    });
    if (!opened.ok() && opened.status() !== 409) {
      throw new Error(`Could not open a shift: ${opened.status()} ${await opened.text()}`);
    }
  }

  const suffix = `${Date.now().toString(36)}`;
  const product = await okJson<{ id: string }>(
    await request.post("/api/products", {
      headers: scoped,
      data: {
        name: `A11y Board Widget ${suffix}`,
        productCode: `A11Y-${suffix}`.slice(0, 40),
        costPrice: 1,
        salePrice: UNIT_PRICE,
        defaultSalePrice: UNIT_PRICE,
        stock: 0,
        stockLimit: 1000,
      },
    }),
  );
  await request.patch(`/api/inventory/${product.id}`, {
    headers: scoped,
    data: { adjustment: 200, type: "set" },
  });

  const place = async (extra: Record<string, unknown> = {}): Promise<string> => {
    const placed = await okJson<any>(
      await request.post("/api/orders", {
        headers: scoped,
        data: {
          lines: [{ productId: product.id, quantity: 1, unitPrice: UNIT_PRICE }],
          paymentMethod: "cash",
          ...extra,
        },
      }),
    );
    const id = placed.orderId ?? placed.id ?? placed.order?.id;
    if (!id) throw new Error(`Order created with no id: ${JSON.stringify(placed)}`);
    return id;
  };

  const setStatus = async (orderId: string, status: string) => {
    const response = await request.patch(`/api/orders/${orderId}`, {
      headers: scoped,
      data: { status },
    });
    if (!response.ok()) {
      throw new Error(`Could not set ${status}: ${response.status()} ${await response.text()}`);
    }
  };

  /** Ages an order past what any endpoint will do. */
  const rewrite = async (orderId: string, values: Record<string, unknown>) => {
    await db
      .update(ordersTable)
      .set(values)
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.orgId, orgId)));
  };

  const ids: Record<string, string> = {};

  // On time: a promise comfortably ahead.
  ids["on-time"] = await place({ fulfilmentMethod: "collection" });
  await rewrite(ids["on-time"], { etaGiven: minutesFromNow(45) });

  // Due soon: inside the ten-minute lead.
  ids["due-soon"] = await place({ fulfilmentMethod: "collection" });
  await rewrite(ids["due-soon"], { etaGiven: minutesFromNow(5) });

  // Late: the promise passed half an hour ago (grace is five minutes).
  ids.late = await place({ fulfilmentMethod: "collection" });
  await rewrite(ids.late, { etaGiven: minutesFromNow(-30) });

  // Delayed: the promise passed, but somebody moved it and said so.
  ids.delayed = await place({ fulfilmentMethod: "delivery" });
  await rewrite(ids.delayed, {
    etaGiven: minutesFromNow(-30),
    delayFlag: true,
    delayCause: "Stock unavailable",
    delayReason: "Waiting on the afternoon delivery",
    revisedEta: minutesFromNow(25),
  });

  // A delivery that is simply on time, so the second lane is never empty.
  ids["on-time-delivery"] = await place({ fulfilmentMethod: "delivery" });
  await rewrite(ids["on-time-delivery"], { etaGiven: minutesFromNow(60) });

  // Held.
  ids.held = await place({ fulfilmentMethod: "collection" });
  await setStatus(ids.held, "on-hold");

  // Completed — lands in the Done tray.
  ids.completed = await place({ fulfilmentMethod: "collection" });
  await setStatus(ids.completed, "completed");

  // Carried over: still open, but from a trading day that has already ended.
  ids["carried-over"] = await place({ fulfilmentMethod: "collection" });
  await rewrite(ids["carried-over"], {
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    enteredAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    etaGiven: new Date(Date.now() - 47 * 60 * 60 * 1000),
  });

  // Scheduled: a pre-order for a trading day that has not started. N3a: a
  // pre-order needs a due time on its own day, or the create route 400s.
  ids.scheduled = await place({
    fulfilmentMethod: "collection",
    orderDate: isoDateIn(2),
    dueTime: "12:00",
  });

  // The three states N4a adds real transitions for (N1's v0 board could not
  // reach these without the stage columns migration 065 added): ready,
  // on-the-road (a claimed delivery, dispatched) and customer-waiting (the
  // customer is here and it is not ready yet). Built through the real
  // transition endpoint, not a direct rewrite, so this spec also proves that
  // path renders a card axe is happy with.
  const transition = async (orderId: string, data: Record<string, unknown>) => {
    const response = await request.post(`/api/orders/${orderId}/transition`, { headers, data });
    if (!response.ok()) {
      throw new Error(`transition ${JSON.stringify(data)} on ${orderId} failed: ${response.status()} ${await response.text()}`);
    }
  };

  ids.ready = await place({ fulfilmentMethod: "collection" });
  await rewrite(ids.ready, { etaGiven: minutesFromNow(45) });
  await transition(ids.ready, { action: "claim" });
  await transition(ids.ready, { action: "ready" });

  ids["on-the-road"] = await place({ fulfilmentMethod: "delivery" });
  await rewrite(ids["on-the-road"], { etaGiven: minutesFromNow(45) });
  await transition(ids["on-the-road"], { action: "claim" });
  await transition(ids["on-the-road"], { action: "out_for_delivery" });

  ids["customer-waiting"] = await place({ fulfilmentMethod: "collection" });
  await rewrite(ids["customer-waiting"], { etaGiven: minutesFromNow(20) });
  await transition(ids["customer-waiting"], { action: "claim" });
  await transition(ids["customer-waiting"], { action: "arrived" });

  return { orgId, ids };
}

/** Opens the collapsed strips so their cards — and axe — can see them. */
async function openStrips(page: Page): Promise<void> {
  for (const testId of [
    "ops-done-tray-collection",
    "ops-yesterday-collection",
    "ops-scheduled-collection",
  ]) {
    const strip = page.getByTestId(testId).getByRole("button").first();
    if (await strip.isVisible().catch(() => false)) {
      if ((await strip.getAttribute("aria-expanded")) !== "true") await strip.click();
    }
  }
}

async function gotoBoard(page: Page): Promise<void> {
  await page.goto("/operations");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByTestId("ops-lane-collection")).toBeVisible({ timeout: 60_000 });
}

test.describe("Operations Centre — accessibility with real cards on the board", () => {
  test("every state the v0 board can reach renders, and axe finds nothing", async ({
    page,
    request,
  }) => {
    const orgId = await prepareTenantContext(page, request);
    const { ids } = await seedBoard(request, orgId);

    await gotoBoard(page);
    await openStrips(page);

    // The card for each seeded order exists and is in the state the data says
    // it is — otherwise a green axe run below would be measuring the wrong
    // colours, which is exactly how GAP-U5-04 stayed green.
    const expected: Array<[string, string]> = [
      ["on-time", "on-time"],
      ["due-soon", "due-soon"],
      ["late", "late"],
      ["delayed", "delayed"],
      ["held", "held"],
      ["completed", "completed"],
      ["carried-over", "carried-over"],
      ["scheduled", "scheduled"],
      ["ready", "ready"],
      ["on-the-road", "ready"],
      ["customer-waiting", "customer-waiting"],
    ];
    for (const [key, state] of expected) {
      const card = page.getByTestId(`ops-card-${ids[key]}`);
      await expect(card, `a card for the ${state} order should be on the board`).toBeVisible({
        timeout: 30_000,
      });
      await expect(card).toHaveAttribute("data-state", state);
    }

    // Both lanes carry cards, so neither is measured as an empty lane.
    await expect(page.getByTestId("ops-lane-delivery")).toBeVisible();
    await expect(page.getByTestId(`ops-card-${ids["on-time-delivery"]}`)).toBeVisible();

    const results = await new AxeBuilder({ page }).include("main").withTags(AXE_TAGS).analyze();

    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious, formatViolations(serious)).toEqual([]);

    const contrastViolations = results.violations.filter((v) => v.id === "color-contrast");
    expect(contrastViolations, formatViolations(contrastViolations)).toEqual([]);

    // The half axe cannot measure — a gradient behind text, most often — is
    // reported here rather than above, and is a failure for this board.
    const contrastIncomplete = results.incomplete.filter((v) => v.id === "color-contrast");
    expect(contrastIncomplete, formatViolations(contrastIncomplete)).toEqual([]);
  });

  test("the order details sheet is clean too", async ({ page, request }) => {
    const orgId = await prepareTenantContext(page, request);
    const { ids } = await seedBoard(request, orgId);

    await gotoBoard(page);
    const view = page.getByTestId(`button-view-order-${ids.late}`);
    await expect(view).toBeVisible({ timeout: 30_000 });
    await view.click();

    const sheet = page.getByTestId("ops-details-sheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });

    const results = await new AxeBuilder({ page })
      .include('[data-testid="ops-details-sheet"]')
      .withTags(AXE_TAGS)
      .analyze();

    const serious = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious, formatViolations(serious)).toEqual([]);
    const contrast = [
      ...results.violations.filter((v) => v.id === "color-contrast"),
      ...results.incomplete.filter((v) => v.id === "color-contrast"),
    ];
    expect(contrast, formatViolations(contrast)).toEqual([]);
  });

  /**
   * N4a's own transient surfaces: the overflow menu, the inline Delay editor
   * it opens, the Done tray, and the staff/station row in the header. Every
   * one of these is new since v0 — a green run of the test above would say
   * nothing about them.
   *
   * Not covered here: the Pass-to strip's OPEN state and the Done tray's
   * Undo BUTTON specifically — both are gated on `currentUserId` (`isAssignee`
   * / `completedUserId === currentUserId`, `OpsCardActions.tsx`), and this
   * suite's one fixed identity (`DEV_AUTH_USER_ID=seed-cashier`, the plain
   * ambient bypass `playwright.config.ts` uses for the whole a11y project —
   * no PHASE2D impersonation headers here, unlike the journeys suite) hits a
   * pre-existing gap: `GET /api/auth/user` (`server/routes/auth.ts`) spreads
   * `storage.getUser(replitUserId)`, which reads the `users` table — empty
   * for an `allowed_users`-only seeded id — so the response carries `role`
   * but no `id` at all, confirmed by reading it directly in this environment.
   * `currentUserId` is therefore `undefined` for every viewer this whole a11y
   * file can authenticate as, which makes `isAssignee` false regardless of
   * who actually holds the order, and CASHIER is never `managerPlus` either
   * — so neither gate can pass here no matter what the seed does. That is a
   * property of the shared auth route, out of this package's touch list
   * (`server/**`), not of the RBAC these two controls correctly enforce —
   * `tests/journeys/operationsBoard.spec.ts` exercises both of them for real,
   * with a real actor identity (PHASE2D headers resolve a genuine `id`), and
   * proves the button appears for an allowed viewer and is absent for a
   * disallowed one. What this test still owns: the strip and the tray render
   * axe-clean for whichever controls THIS identity can actually reach.
   */
  test("N4a's card overflow, delay editor, pass strip, done tray and station row are clean", async ({
    page,
    request,
  }) => {
    const orgId = await prepareTenantContext(page, request);
    const { ids } = await seedBoard(request, orgId);

    await gotoBoard(page);
    await openStrips(page);

    // Overflow menu open on an ordinary open card. Scoped to the menu itself
    // — same as the details Sheet case below — rather than the whole page:
    // Radix's `DropdownMenu` marks every OTHER branch of the page
    // `aria-hidden="true"` while open (`aria-hidden-focus`, a generic
    // property of `client/src/components/ui/dropdown-menu.tsx` shared by
    // every menu in the app, not something this package's cards introduce),
    // and a board of thirty-plus roving-tabindex cards is the first a11y spec
    // ever to open one of these menus with that much OTHER tabbable content
    // still on screen. That is a pre-existing shared-component question, out
    // of this package's touch list; what this test owns is whether the menu
    // ITSELF, and the panels it opens, are accessible.
    await page.getByTestId(`button-order-actions-${ids["on-time"]}`).click();
    await expect(page.getByTestId(`ops-delay-open-${ids["on-time"]}`)).toBeVisible();

    let results = await new AxeBuilder({ page }).include('[role="menu"]').withTags(AXE_TAGS).analyze();
    let serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, formatViolations(serious)).toEqual([]);
    let contrast = [
      ...results.violations.filter((v) => v.id === "color-contrast"),
      ...results.incomplete.filter((v) => v.id === "color-contrast"),
    ];
    expect(contrast, formatViolations(contrast)).toEqual([]);

    // The inline Delay editor, opened from that same menu.
    await page.getByTestId(`ops-delay-open-${ids["on-time"]}`).click();
    await expect(page.getByTestId(`ops-delay-editor-${ids["on-time"]}`)).toBeVisible();

    results = await new AxeBuilder({ page }).include(`[data-testid="ops-delay-editor-${ids["on-time"]}"]`).withTags(AXE_TAGS).analyze();
    serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, formatViolations(serious)).toEqual([]);
    contrast = [
      ...results.violations.filter((v) => v.id === "color-contrast"),
      ...results.incomplete.filter((v) => v.id === "color-contrast"),
    ];
    expect(contrast, formatViolations(contrast)).toEqual([]);
    await page.getByTestId(`button-delay-cancel-${ids["on-time"]}`).click();

    // The ready card's own overflow — closed the on-time one first — is
    // still reachable and worth its own axe pass even though its "Pass to…"
    // item itself does not render for this identity (see the module comment).
    await page.getByTestId(`button-order-actions-${ids.ready}`).click();
    await expect(page.getByTestId(`ops-unready-${ids.ready}`)).toBeVisible();

    results = await new AxeBuilder({ page }).include('[role="menu"]').withTags(AXE_TAGS).analyze();
    serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, formatViolations(serious)).toEqual([]);
    contrast = [
      ...results.violations.filter((v) => v.id === "color-contrast"),
      ...results.incomplete.filter((v) => v.id === "color-contrast"),
    ];
    expect(contrast, formatViolations(contrast)).toEqual([]);
    // Closes the menu for real. `client/src/components/ui/dropdown-menu.tsx`
    // is a bare `DropdownMenuPrimitive.Root` (pre-existing, shared, out of
    // this package's touch list) with no `modal={false}` override, so Radix
    // runs it in its default MODAL mode: while open, Radix sets
    // `pointer-events: none` on the rest of the document and only the
    // portalled content is exempted. That is what the earlier "every OTHER
    // card aria-hidden" comment above was already about — but it also means
    // a second real click aimed at the TRIGGER (which lives outside the
    // portal, in the normal page) can never land; Playwright reports the
    // click as intercepted by `<html>` itself and retries until its own
    // timeout, which is exactly what happened here before this fix. Escape
    // reaches Radix's own key handler regardless of pointer-events lockout
    // and Radix already moved focus into the menu's first item when it
    // opened, so it closes the menu the same way a real keyboard user would.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(`ops-unready-${ids.ready}`)).toHaveCount(0);

    // The Done tray itself — the completed card is in it, whether or not
    // Undo renders for this identity (see the module comment).
    await expect(page.getByTestId(`ops-card-${ids.completed}`)).toBeVisible();

    results = await new AxeBuilder({ page }).include(`[data-testid="ops-done-tray-collection"]`).withTags(AXE_TAGS).analyze();
    serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, formatViolations(serious)).toEqual([]);
    contrast = [
      ...results.violations.filter((v) => v.id === "color-contrast"),
      ...results.incomplete.filter((v) => v.id === "color-contrast"),
    ];
    expect(contrast, formatViolations(contrast)).toEqual([]);

    // The header's staff strip and station picker.
    await expect(page.getByTestId("ops-station-picker")).toBeVisible();

    results = await new AxeBuilder({ page }).include('[data-testid="ops-station-picker"]').withTags(AXE_TAGS).analyze();
    serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, formatViolations(serious)).toEqual([]);
    contrast = [
      ...results.violations.filter((v) => v.id === "color-contrast"),
      ...results.incomplete.filter((v) => v.id === "color-contrast"),
    ];
    expect(contrast, formatViolations(contrast)).toEqual([]);
  });

  /**
   * The two devices this board is actually used on. A board that scrolls
   * sideways on a counter tablet is a board whose right-hand lane is invisible,
   * and nobody scrolls sideways to find work.
   */
  for (const device of [
    { name: "iPad Pro 11in landscape", width: 1194, height: 834 },
    { name: "Pixel 7", width: 412, height: 915 },
  ]) {
    test(`no horizontal scroll on ${device.name}, and axe is clean there`, async ({
      page,
      request,
    }) => {
      const orgId = await prepareTenantContext(page, request);
      await seedBoard(request, orgId);
      await page.setViewportSize({ width: device.width, height: device.height });

      await gotoBoard(page);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `the page is ${overflow.scrollWidth}px wide inside a ${overflow.clientWidth}px viewport`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);

      const results = await new AxeBuilder({ page }).include("main").withTags(AXE_TAGS).analyze();
      const serious = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );
      expect(serious, formatViolations(serious)).toEqual([]);
      const contrast = [
        ...results.violations.filter((v) => v.id === "color-contrast"),
        ...results.incomplete.filter((v) => v.id === "color-contrast"),
      ];
      expect(contrast, formatViolations(contrast)).toEqual([]);
    });
  }
});
