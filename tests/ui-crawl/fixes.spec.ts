/**
 * ui-crawl, fixes (v1.2.1): one focused check per finding in the v1.2.1 ui
 * report, so each fix is held by a test that failed before it landed. The
 * wide crawl (crawl.spec.ts) and the tour walk (tours.spec.ts) hold the same
 * ground across every page; these are quick, and name the finding.
 *
 * Run (own server, own port):
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:$PORT PORT=$PORT \
 *     npx playwright test --project=ui-crawl tests/ui-crawl/fixes.spec.ts
 */
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect, pageAs, resolveOrgId, type Role } from "../journeys/fixtures";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 412, height: 915 };

async function open(browser: import("@playwright/test").Browser, role: Role, viewport: { width: number; height: number }) {
  const orgId = await resolveOrgId();
  const page = await pageAs(browser, role, orgId);
  await page.setViewportSize(viewport);
  return page;
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

/**
 * Is anything fixed (a floating launcher) over the control's centre? A
 * disabled button lets the hit fall through to its parent, which is fine;
 * only a fixed element that is not the control's own ancestor covers it.
 */
async function uncovered(locator: Locator): Promise<{ ok: boolean; by: string }> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top) return { ok: false, by: "nothing" };
    if (top === el || el.contains(top) || top.contains(el)) return { ok: true, by: "itself" };
    for (let p: Element | null = top; p; p = p.parentElement) {
      if (getComputedStyle(p).position === "fixed") {
        return { ok: false, by: `${p.tagName.toLowerCase()}[data-testid=${p.getAttribute("data-testid")}]` };
      }
    }
    return { ok: true, by: top.tagName.toLowerCase() };
  });
}

async function noSideScroll(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

test.describe("v1.2.1 ui fixes", () => {
  test.setTimeout(180_000);

  test("UI-01: the last row's actions scroll clear of the floating launchers (desktop /customers)", async ({ browser }) => {
    const page = await open(browser, "ADMIN", DESKTOP);
    await page.goto("/customers");
    await settle(page);
    await expect(page.getByTestId("fab-clearance")).toBeAttached();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const deletes = page.locator('main [data-testid^="button-delete-"]:visible');
    const last = deletes.last();
    await expect(last).toBeVisible();
    const hit = await uncovered(last);
    expect(hit.ok, `last Delete under ${hit.by}`).toBe(true);
    await page.context().close();
  });

  test("UI-01: at the till on a phone, the customer select and pay button can be pressed", async ({ browser }) => {
    const page = await open(browser, "CASHIER", PHONE);
    await page.goto("/create-order");
    await settle(page);
    const select = page.getByTestId("select-customer").first();
    await expect(select).toBeVisible();
    // The order form scrolls on its own; scroll it right down.
    await select.evaluate((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) {
          p.scrollTop = p.scrollHeight;
          break;
        }
      }
    });
    await page.waitForTimeout(300);
    expect((await uncovered(select)).ok, "Customer select under a launcher").toBe(true);
    const pay = await uncovered(page.getByTestId("mobile-checkout-button"));
    expect(pay.ok, `pay button under ${pay.by}`).toBe(true);
    await page.context().close();
  });

  test("UI-02: the Credit List fits a phone and Remove is on screen", async ({ browser }) => {
    const page = await open(browser, "ADMIN", PHONE);
    await page.goto("/tick-list");
    await settle(page);
    const { scrollWidth, clientWidth } = await noSideScroll(page);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    const removes = page.locator('main button:visible:has-text("Remove")');
    const n = await removes.count();
    for (let i = 0; i < n; i++) {
      const box = await removes.nth(i).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(clientWidth);
    }
    await page.context().close();
  });

  test("UI-03: Staff Performance's six tabs fit a phone", async ({ browser }) => {
    const page = await open(browser, "ADMIN", PHONE);
    await page.goto("/reports/staff-performance");
    await settle(page);
    const fairness = page.getByTestId("tab-performance-fairness");
    await expect(fairness).toBeVisible();
    const { scrollWidth, clientWidth } = await noSideScroll(page);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    const box = await fairness.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(clientWidth);
    await page.context().close();
  });

  test("UI-04: no validateDOMNesting error on /my-performance or Staff Performance", async ({ browser }) => {
    const page = await open(browser, "ADMIN", DESKTOP);
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /validateDOMNesting/.test(m.text())) errors.push(m.text());
    });
    for (const path of ["/my-performance", "/reports/staff-performance"]) {
      await page.goto(path);
      await settle(page);
    }
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test("UI-05, UI-06: a phone's Centre tour has its steps, and a cashier is told of five Centres", async ({ browser }) => {
    const page = await open(browser, "CASHIER", PHONE);
    await page.goto("/");
    await settle(page);
    await page.evaluate(() => window.dispatchEvent(new Event("arcarna:centre-tour:start")));
    const callout = page.getByTestId("centre-tour-callout");
    await expect(callout).toBeVisible({ timeout: 12_000 });
    await expect(callout).toContainText("Step 1 of 3");
    await expect(callout).toContainText("Five Centres");
    await page.context().close();
  });

  test("UI-07: every Truths tour callout stays inside a 900px desktop", async ({ browser }) => {
    const page = await open(browser, "ADMIN", DESKTOP);
    await page.goto("/truths");
    await settle(page);
    await page.evaluate(() => window.dispatchEvent(new Event("arcarna:centre-tour:start")));
    const callout = page.getByTestId("centre-tour-callout");
    await expect(callout).toBeVisible({ timeout: 12_000 });
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(450);
      const box = await callout.boundingBox();
      expect(box!.y + box!.height, `step ${i + 1}`).toBeLessThanOrEqual(DESKTOP.height);
      const next = page.getByTestId("centre-tour-next");
      const label = (await next.textContent())?.trim();
      await next.click();
      if (label === "Got it") break;
    }
    await page.context().close();
  });

  test("UI-08: an unknown in-app URL says Page not found for signed-in staff", async ({ browser }) => {
    const page = await open(browser, "MANAGER", DESKTOP);
    await page.goto("/a-page-that-does-not-exist");
    await settle(page);
    await expect(page.locator("main")).toContainText("Page not found");
    // A real page is not caught by the catch-all.
    await page.goto("/customers");
    await settle(page);
    await expect(page.locator("main")).not.toContainText("Page not found");
    await page.context().close();
  });

  test("UI-09: Customers' Edit and Delete sit inside the table's card on a desktop", async ({ browser }) => {
    const page = await open(browser, "ADMIN", DESKTOP);
    await page.goto("/customers");
    await settle(page);
    const del = page.locator('main [data-testid^="button-delete-"]:visible').first();
    await expect(del).toBeVisible();
    const inside = await del.evaluate((el) => {
      const r = el.getBoundingClientRect();
      let scroller: Element | null = el.parentElement;
      while (scroller && getComputedStyle(scroller).overflowX === "visible") scroller = scroller.parentElement;
      const s = scroller!.getBoundingClientRect();
      return { right: r.right, scrollerRight: s.right };
    });
    expect(inside.right).toBeLessThanOrEqual(inside.scrollerRight + 1);
    await page.context().close();
  });

  test("UI-10: checkboxes and switches keep their own size", async ({ browser }) => {
    const page = await open(browser, "ADMIN", DESKTOP);
    await page.goto("/customers");
    await settle(page);
    const box = await page.locator('main button[role="checkbox"]:visible').first().boundingBox();
    expect(box!.height).toBeLessThanOrEqual(20);
    await page.goto("/settings?tab=operations");
    await settle(page);
    const sw = page.locator('main button[role="switch"]:visible').first();
    const geo = await sw.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const t = el.querySelector("span")!.getBoundingClientRect();
      return { h: r.height, thumbOffset: t.top - r.top, thumbGap: r.bottom - t.bottom };
    });
    expect(geo.h).toBeLessThanOrEqual(28);
    expect(Math.abs(geo.thumbOffset - geo.thumbGap)).toBeLessThanOrEqual(1);
    await page.context().close();
  });

  test("UI-11: phone touch targets: the Signals bell, select triggers and a dialog's close are 44px", async ({ browser }) => {
    const page = await open(browser, "ADMIN", PHONE);
    await page.goto("/reports/staff-performance");
    await settle(page);
    const bell = await page.getByTestId("notification-bell").boundingBox();
    expect(bell!.height).toBeGreaterThanOrEqual(44);
    expect(bell!.width).toBeGreaterThanOrEqual(44);
    const home = await page.getByTestId("header-home-link").boundingBox();
    expect(home!.height).toBeGreaterThanOrEqual(44);
    const trigger = await page.getByTestId("select-performance-preset").boundingBox();
    expect(trigger!.height).toBeGreaterThanOrEqual(44);
    await page.goto("/customers");
    await settle(page);
    await page.getByTestId("button-add-customer").click();
    const close = page.getByRole("dialog").getByRole("button", { name: "Close" });
    await expect(close).toBeVisible();
    // Measured once the dialog's open animation (a 95% zoom) has finished.
    await expect.poll(async () => (await close.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await expect.poll(async () => (await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.context().close();
  });

  test("UI-12: the header's home link has a name on a phone", async ({ browser }) => {
    const page = await open(browser, "CASHIER", PHONE);
    await page.goto("/");
    await settle(page);
    await expect(page.getByRole("link", { name: "arcarna home" })).toBeVisible();
    const r = await new AxeBuilder({ page }).withRules(["link-name"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.context().close();
  });

  const AXE_PAGES = [
    "/analytics/channels",
    "/cashier-payroll",
    "/expense-reports",
    "/customer-access-log",
    "/reports/daily-sales",
    "/reports/delay-log",
    "/reports/weekly-sales",
    "/reports/staff-performance",
    "/inventory?tab=replenishment",
    "/inventory",
    "/analytics/hour-of-day",
    "/truths",
    "/create-order",
    "/locations",
    "/settings?tab=operations",
    "/settings?tab=invoice",
    "/tick-list",
    "/expenses",
    "/reports/current-stock",
    "/reports/weekly-margin",
    "/reports/staff-targets",
    "/settings?tab=imports",
    "/settings/developer",
    "/audit-logs",
    "/suppliers",
  ];
  const AXE_RULES = [
    "button-name",
    "label",
    "aria-progressbar-name",
    "aria-prohibited-attr",
    "svg-img-alt",
    "scrollable-region-focusable",
    "color-contrast",
  ];
  test("UI-13: the named axe violations are gone from the pages they were found on", async ({ browser }) => {
    test.setTimeout(420_000);
    const page = await open(browser, "ADMIN", DESKTOP);
    const found: string[] = [];
    for (const path of AXE_PAGES) {
      await page.goto(path);
      await settle(page);
      await page.waitForTimeout(1000);
      const r = await new AxeBuilder({ page }).withRules(AXE_RULES).analyze();
      for (const v of r.violations) {
        if (!["serious", "critical"].includes(v.impact ?? "")) continue;
        found.push(`${path} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      }
    }
    expect(found).toEqual([]);
    await page.context().close();
  });

  test("UI-16: dates are day-first in an en-US browser", async ({ browser }) => {
    const page = await open(browser, "ADMIN", DESKTOP);
    expect(await page.evaluate(() => navigator.language)).toBe("en-US");
    await page.goto("/customers");
    await settle(page);
    const lasts = await page.locator("main").getByText(/^Last: /).allTextContents();
    for (const t of lasts) {
      const m = /Last: (\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
      if (!m) continue;
      // en-GB zero-pads: dd/mm/yyyy. en-US would be m/d/yyyy with no padding.
      expect(t).toMatch(/Last: \d{2}\/\d{2}\/\d{4}/);
      expect(Number(m[2])).toBeLessThanOrEqual(12);
    }
    await page.context().close();
  });

  test("UI-17: the Staff Performance tour keeps 'One row per person' on a phone", async ({ browser }) => {
    const page = await open(browser, "MANAGER", PHONE);
    await page.goto("/reports/staff-performance");
    await settle(page);
    await page.locator('[data-testid^="cards-performance-"]').first().waitFor({ state: "visible", timeout: 15_000 });
    await page.evaluate(() => window.dispatchEvent(new Event("arcarna:feature-tour:staffPerformance:start")));
    const callout = page.getByTestId("feature-tour-staffPerformance-callout");
    await expect(callout).toBeVisible({ timeout: 12_000 });
    const titles: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(450);
      titles.push(((await callout.locator("h2").textContent()) ?? "").trim());
      const next = page.getByTestId("feature-tour-staffPerformance-next");
      const label = (await next.textContent())?.trim();
      await next.click();
      if (label === "Got it") break;
    }
    expect(titles).toContain("One row per person");
    await page.context().close();
  });
});
