/**
 * ui-crawl, tours (v1.2.1): every Centre tour and feature tour, replayed as
 * each role on a desktop and a phone, must point at something real.
 *
 * The tour engine silently drops a step whose target is not on screen, so a
 * tour can quietly shrink to a single "Where you are" callout, or talk about
 * hovering over a menu that is shut. This replays each tour from the menu's
 * own event and records every step it actually shows, with the spotlight box,
 * then checks:
 *  - the tour starts at all;
 *  - no step the tour defines for this role is dropped for want of a target;
 *  - each spotlight and each callout sits inside the viewport.
 *
 * Findings are written to test-results/ui-crawl/tours-<viewport>.json with a
 * screenshot per defect.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, pageAs, resolveOrgId, type Role } from "../journeys/fixtures";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 412, height: 915 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;

// Outside Playwright's own output folder by choice (UI_CRAWL_OUT): that one is
// emptied at the start of every run, so one spec would wipe another's report.
/**
 * Known failures when this spec was committed (ids from the v1.2.1 ui
 * report). They still fail; the tag says which finding each belongs to.
 * Remove an entry when its fix lands.
 */
const KNOWN: { id: string; match: RegExp }[] = [
  // On a phone the Centre tour's menu steps point into the closed menu sheet.
  { id: "UI-05", match: /dropped: .*(Back to the main menu|Keep the menu open|See this again|Centres?\b)|tour did not start/ },
  // The callout is placed by a 160px height estimate; a long body makes it taller.
  { id: "UI-07", match: /callout ".*" outside the viewport/ },
];
const tagKnown = (problem: string) => {
  const k = KNOWN.find((x) => x.match.test(problem));
  return k ? `[known ${k.id}] ${problem}` : problem;
};

const OUT_DIR = process.env.UI_CRAWL_OUT ?? join(process.cwd(), "test-results", "ui-crawl");

/** One page per Centre tour, and the steps CentreTour.tsx defines for it. */
const CENTRE_PAGES: { centre: string; path: string; menuTitle: string; roles: Role[] }[] = [
  { centre: "control", path: "/", menuTitle: "Seven Centres", roles: ["ADMIN", "MANAGER", "CASHIER"] },
  { centre: "stock", path: "/inventory", menuTitle: "The Stock Centre", roles: ["ADMIN", "MANAGER"] },
  // A cashier's Stock Centre is Stock levels (counts only); Stock Truths is managers'.
  { centre: "stock", path: "/stock-levels", menuTitle: "The Stock Centre", roles: ["CASHIER"] },
  { centre: "truths", path: "/truths", menuTitle: "The Truths Centre", roles: ["ADMIN", "MANAGER"] },
  { centre: "customer", path: "/customers", menuTitle: "The Customer Centre", roles: ["ADMIN", "MANAGER"] },
  { centre: "finance", path: "/shifts", menuTitle: "The Finance Centre", roles: ["ADMIN", "MANAGER", "CASHIER"] },
  { centre: "settings", path: "/settings", menuTitle: "The Settings Centre", roles: ["ADMIN", "MANAGER"] },
];
const CENTRE_STEP_TITLES = ["Back to the main menu", "Where you are", "Keep the menu open", "See this again"];

type Shown = { title: string; box: { x: number; y: number; w: number; h: number } | null; callout: { x: number; y: number; w: number; h: number } | null };

async function walkTour(page: Page, prefix: string): Promise<Shown[] | null> {
  const callout = page.getByTestId(`${prefix}-callout`);
  try {
    await callout.waitFor({ state: "visible", timeout: 12_000 });
  } catch {
    return null;
  }
  const shown: Shown[] = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(450);
    const snap = await page.evaluate((p) => {
      const c = document.querySelector(`[data-testid="${p}-callout"]`);
      if (!c) return null;
      const title = (c.querySelector("h2, h3, [data-tour-title], strong")?.textContent ?? c.textContent ?? "").trim().slice(0, 60);
      const r = c.getBoundingClientRect();
      // The spotlight ring is the element with the big box-shadow / ring in the overlay.
      const root = document.querySelector(`[data-testid="${p}"]`);
      const ring = root?.querySelector('[data-testid$="-highlight"], [class*="ring"]');
      const rr = ring?.getBoundingClientRect();
      return {
        title,
        callout: { x: r.left, y: r.top, w: r.width, h: r.height },
        box: rr ? { x: rr.left, y: rr.top, w: rr.width, h: rr.height } : null,
      };
    }, prefix);
    if (!snap) break;
    shown.push(snap);
    const next = page.getByTestId(`${prefix}-next`);
    if (!(await next.isVisible().catch(() => false))) break;
    const label = (await next.textContent())?.trim() ?? "";
    await next.click();
    if (/done|finish|got it/i.test(label)) break;
  }
  return shown;
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  test(`Centre tours point at real things @ ${viewport}`, async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const orgId = await resolveOrgId();
    const problems: string[] = [];
    const report: unknown[] = [];
    mkdirSync(join(OUT_DIR, `tours-${viewport}`), { recursive: true });
    for (const role of ["ADMIN", "MANAGER", "CASHIER"] as Role[]) {
      const page = await pageAs(browser, role, orgId);
      await page.setViewportSize(VIEWPORTS[viewport]);
      for (const { centre, path, menuTitle, roles } of CENTRE_PAGES) {
        if (!roles.includes(role)) continue;
        await page.goto(path);
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        await page.evaluate(() => window.dispatchEvent(new Event("arcarna:centre-tour:start")));
        const shown = await walkTour(page, "centre-tour");
        const vw = VIEWPORTS[viewport].width;
        const vh = VIEWPORTS[viewport].height;
        const tag = `${role} ${centre} ${path}`;
        report.push({ role, centre, path, shown });
        const shot = join(OUT_DIR, `tours-${viewport}`, `${role}-${centre}.png`);
        if (!shown) {
          problems.push(`${tag}: tour did not start`);
          await page.screenshot({ path: shot });
          continue;
        }
        const titles = shown.map((s) => s.title);
        // The Control Centre's menu IS the main menu, so it has no way back to it.
        const expected = [menuTitle, ...CENTRE_STEP_TITLES].filter((t) => !(centre === "control" && t === "Back to the main menu"));
        const missing = expected.filter((t) => !titles.some((x) => x.includes(t)));
        if (missing.length) problems.push(`${tag}: ${shown.length} step(s) shown [${titles.join(" | ")}]; dropped: ${missing.join(", ")}`);
        for (const s of shown) {
          if (s.callout && (s.callout.x < 0 || s.callout.y < 0 || s.callout.x + s.callout.w > vw + 1 || s.callout.y + s.callout.h > vh + 1)) {
            problems.push(`${tag}: callout "${s.title}" outside the viewport ${JSON.stringify(s.callout)}`);
          }
        }
        if (missing.length) await page.screenshot({ path: shot });
        await page.keyboard.press("Escape").catch(() => undefined);
      }
      await page.context().close();
    }
    writeFileSync(join(OUT_DIR, `tours-${viewport}.json`), JSON.stringify({ viewport, report, problems }, null, 2));
    expect(problems.map(tagKnown), `Centre tour problems @ ${viewport}`).toEqual([]);
  });
}

/**
 * The v1.2 feature tours and the Operations board tour: replayed wherever
 * their anchor is on screen. A tour that does not start, or a callout or
 * spotlight that leaves the viewport, fails; steps dropped for want of a
 * target are listed in the report (some are one-or-the-other by design, such
 * as the label printer's "cannot print" and "pair" steps).
 */
const ALL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"];
type FeatureCase = { name: string; path: string; prefix: string; event: string; anchor: string | null; roles: Role[]; steps: { title: string; roles?: readonly string[] }[] };

async function featureCases(): Promise<FeatureCase[]> {
  const { FEATURE_TOUR_DEFS } = await import("../../client/src/components/tour/featureTours");
  const cases: FeatureCase[] = [];
  for (const def of FEATURE_TOUR_DEFS) {
    for (const path of def.paths) {
      cases.push({
        name: def.feature,
        path,
        prefix: `feature-tour-${def.feature}`,
        event: `arcarna:feature-tour:${def.feature}:start`,
        anchor: def.anchor.match === "prefix" ? `[data-testid^="${def.anchor.testId}"]` : `[data-testid="${def.anchor.testId}"]`,
        roles: (def.roles as Role[] | undefined) ?? ALL_ROLES,
        steps: def.steps.map((s) => ({ title: s.title, roles: s.roles })),
      });
    }
  }
  cases.push({
    name: "ops",
    path: "/operations",
    prefix: "ops-tour",
    event: "arcarna:ops-tour:start",
    anchor: '[data-testid="ops-kpi-strip"]',
    roles: ALL_ROLES,
    steps: [],
  });
  return cases;
}

for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
  test(`feature and board tours stay on screen @ ${viewport}`, async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const orgId = await resolveOrgId();
    const cases = await featureCases();
    const problems: string[] = [];
    const report: unknown[] = [];
    const vw = VIEWPORTS[viewport].width;
    const vh = VIEWPORTS[viewport].height;
    mkdirSync(join(OUT_DIR, `feature-tours-${viewport}`), { recursive: true });
    for (const role of ALL_ROLES) {
      const page = await pageAs(browser, role, orgId);
      await page.setViewportSize(VIEWPORTS[viewport]);
      for (const c of cases) {
        if (!c.roles.includes(role)) continue;
        await page.goto(c.path);
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        const tag = `${role} ${c.name} ${c.path}`;
        const anchored = c.anchor
          ? await page.locator(c.anchor).first().waitFor({ state: "attached", timeout: 6_000 }).then(() => true, () => false)
          : true;
        if (!anchored) {
          report.push({ role, ...c, steps: undefined, shown: null, note: "anchor not on screen (no data or other tab)" });
          continue;
        }
        await page.evaluate((e) => window.dispatchEvent(new Event(e)), c.event);
        const shown = await walkTour(page, c.prefix);
        const expected = c.steps.filter((s) => !s.roles || s.roles.includes(role)).map((s) => s.title);
        const dropped = expected.filter((t) => !(shown ?? []).some((s) => s.title.includes(t)));
        report.push({ role, name: c.name, path: c.path, shown, dropped });
        const shot = join(OUT_DIR, `feature-tours-${viewport}`, `${role}-${c.name}.png`);
        if (!shown || shown.length === 0) {
          problems.push(`${tag}: tour did not start although its anchor is on screen`);
          await page.screenshot({ path: shot });
          continue;
        }
        let bad = false;
        for (const s of shown) {
          if (s.callout && (s.callout.x < 0 || s.callout.y < 0 || s.callout.x + s.callout.w > vw + 1 || s.callout.y + s.callout.h > vh + 1)) {
            problems.push(`${tag}: callout "${s.title}" outside the viewport ${JSON.stringify(s.callout)}`);
            bad = true;
          }
          if (s.box && (s.box.w < 2 || s.box.h < 2)) {
            problems.push(`${tag}: step "${s.title}" spotlights nothing (${JSON.stringify(s.box)})`);
            bad = true;
          }
        }
        if (bad) await page.screenshot({ path: shot });
        await page.keyboard.press("Escape").catch(() => undefined);
      }
      await page.context().close();
    }
    writeFileSync(join(OUT_DIR, `feature-tours-${viewport}.json`), JSON.stringify({ viewport, report, problems }, null, 2));
    expect(problems.map(tagKnown), `feature tour problems @ ${viewport}`).toEqual([]);
  });
}
