/**
 * ui-crawl (v1.2.1): every Centre, menu entry and in-app link, as every role,
 * on a desktop (1440×900) and a phone (412×915).
 *
 * Discovery reads the rendered menu (the phone's sheet, or the desktop menu
 * pinned open) on each Centre, and checks it against the menu's own source,
 * nav-items.ts, so a page added to a Centre is crawled without touching this
 * file and a page the menu fails to show is a defect. Each menu page then
 * adds the in-app links it renders (one level deep), which is how a dead
 * link inside a page is found; a handful of unlisted routes (legacy
 * redirects, refunds, a person's performance, an unknown path) are added too.
 *
 * Hard failures (the contract this spec keeps fixed):
 *  - a horizontal scroll on the page;
 *  - a console error or an uncaught page error;
 *  - a failed request or a 4xx/5xx response from our own origin;
 *  - a link that lands on "Page not found", the error boundary, an empty
 *    page, or /no-access from the role's own menu;
 *  - an unknown path that does not say "Page not found";
 *  - a menu entry the role should have but is not shown.
 *
 * With UI_CRAWL_DEEP=1 it also audits layout (controls past the right edge,
 * overlapping controls, controls stuck under something fixed at the bottom
 * of the page, touch targets under 44px on a phone, dialogs that do not fit)
 * and runs axe; those are written to the report and annotated, but only fail
 * the run with UI_CRAWL_STRICT=1, because the heuristics are advisory.
 *
 * Every defect gets a full-page screenshot and a line in
 * <UI_CRAWL_OUT or test-results/ui-crawl>/<role>-<viewport>.json. Findings
 * still open when this was committed are listed in KNOWN_FAILURES with their
 * report id; they still fail the run, tagged, until fixed.
 *
 * Run (own server, own port):
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:$PORT PORT=$PORT \
 *     npx playwright test --project=ui-crawl
 * tours.spec.ts (tours point at real things) and dialogs.spec.ts (dialogs
 * fit a phone) sit alongside.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { ConsoleMessage, Page, Request, Response } from "@playwright/test";
import { test, expect, apiAs, pageAs, resolveOrgId, type Role } from "../journeys/fixtures";
import { STORAGE_SIDEBAR_PINNED } from "../../shared/storageKeys";
import { visibleCentres, visibleTabs } from "../../client/src/components/nav-items";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 412, height: 915 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;

const ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"];

const DEEP = process.env.UI_CRAWL_DEEP === "1";
const STRICT = process.env.UI_CRAWL_STRICT === "1";
// Outside Playwright's own output folder by choice (UI_CRAWL_OUT): that one is
// emptied at the start of every run, so one spec would wipe another's report.
const OUT_DIR = process.env.UI_CRAWL_OUT ?? join(process.cwd(), "test-results", "ui-crawl");

/** Links the crawl must never follow: they leave the app, sign out, or download. */
const SKIP_HREF = [
  /^\/sign-out/,
  /^\/api\//,
  /^\/order(\/|$)/, // the public WM Supplies order page, not the app
  /^\/privacy/,
  /^mailto:|^tel:|^https?:/,
];

/**
 * Known failures at the time this spec was committed, so the run reads as a
 * list of what is still to fix rather than a wall of red. Each entry names the
 * finding id in the v1.2.1 ui report. Remove an entry when its fix lands; the
 * crawl then holds it fixed.
 */
const KNOWN_FAILURES: { id: string; match: RegExp }[] = [
  // UI-02, UI-03, UI-04, UI-08 and UI-14 are fixed (v1.2.1 ui); none open.
];

/**
 * Pages no menu lists but links, redirects and bookmarks reach: the legacy
 * order lists, refunds, a person's performance, the receipt and loyalty
 * settings pages. Crawled for every role; a role that may not open one is
 * sent to /no-access, which is right, so only errors count here.
 */
const EXTRA_STATIC = [
  "/orders",
  "/open-orders",
  "/pos",
  "/analytics",
  "/insights",
  "/audit-logs",
  "/friction-truths",
  "/customer-access-log",
  "/worker-logs",
  "/reports/staff-kpi",
  "/settings/loyalty",
  "/settings/receipts",
  "/settings/wm-supplies-website",
  "/admin/wm-supplies/website",
  "/a-page-that-does-not-exist",
];

async function extraRoutes(orgId: string): Promise<string[]> {
  const out = [...EXTRA_STATIC];
  const api = await apiAs("ADMIN", orgId);
  try {
    const orders = (await (await api.get("/api/orders?limit=5")).json().catch(() => [])) as { id: string; status: string }[];
    const done = Array.isArray(orders) ? orders.find((o) => o.status === "completed") : undefined;
    if (done) out.push(`/orders/${done.id}/refund`, `/open-orders/${done.id}/refund`);
    const promos = (await (await api.get("/api/promotions")).json().catch(() => [])) as { id: string }[];
    if (Array.isArray(promos) && promos[0]) out.push(`/promotions/${promos[0].id}/lift`);
    out.push("/reports/staff-performance/seed-cashier");
  } finally {
    await api.dispose();
  }
  return out;
}

/** Symptoms of the Vite dev server re-optimising dependencies mid-crawl. */
const VITE_DEV_NOISE = /Outdated Optimize Dep|\/node_modules\/\.vite\/deps\/|Failed to fetch dynamically imported module/;

type Defect = {
  kind:
    | "horizontal-scroll"
    | "console-error"
    | "page-error"
    | "request-failed"
    | "bad-status"
    | "not-found"
    | "error-boundary"
    | "no-access"
    | "menu-missing"
    | "blank-page"
    | "offscreen"
    | "overlap"
    | "covered"
    | "small-target"
    | "dialog-overflow"
    | "axe";
  hard: boolean;
  path: string;
  detail: string;
  screenshot?: string;
};

function known(d: Defect): string | undefined {
  const line = `${d.kind} ${d.path} ${d.detail}`;
  return KNOWN_FAILURES.find((k) => k.match.test(line))?.id;
}

function normalisePath(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return null;
    const path = url.pathname + (url.search ?? "");
    if (SKIP_HREF.some((re) => re.test(path))) return null;
    return path;
  } catch {
    return null;
  }
}

/** Waits for the SPA to settle: lazy route chunk loaded, queries mostly done. */
async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

/**
 * Every page the menu should offer this role, from the menu's own source
 * (client/src/components/nav-items.ts): each visible Centre's pages and their
 * tabs. The rendered menu is checked against it, so a page the menu fails to
 * show is a defect, and a page added to a Centre is crawled with no edit here.
 */
function expectedMenu(role: Role, viewport: ViewportName): string[] {
  const out = new Set<string>();
  for (const centre of visibleCentres(role)) {
    for (const item of centre.items) {
      out.add(item.href);
      // Tabs are listed under their page only where the menu shows labels,
      // which is everywhere but the collapsed desktop rail (pinned here).
      for (const tab of visibleTabs(item, role)) out.add(`${item.href}?tab=${encodeURIComponent(tab.tab)}`);
    }
  }
  void viewport;
  return [...out];
}

/**
 * Collects the menu links this role is actually shown, by opening each
 * Centre's landing page and reading its menu (the phone's sheet, or the
 * desktop menu pinned open so labels and tabs render). Waits for the menu to
 * render rather than for a fixed time, so a busy dev server cannot make a
 * Centre look empty.
 */
async function discoverMenu(page: Page, role: Role, viewport: ViewportName, origin: string): Promise<{ rendered: string[]; missing: string[] }> {
  const found = new Set<string>(["/"]);

  async function openMenu() {
    if (viewport !== "phone") return;
    const sheet = page.locator('[role="dialog"]').filter({ has: page.locator("nav") });
    if (await sheet.first().isVisible().catch(() => false)) return;
    await page.getByTestId("button-nav-toggle").first().click({ timeout: 15_000 });
    await sheet.first().waitFor({ state: "visible", timeout: 10_000 });
  }

  async function collect(selector: string) {
    const links = page.locator(`${selector} a[href]`);
    await links.first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
    for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      const p = normalisePath(href, origin);
      if (p) found.add(p);
    }
  }

  await page.goto("/");
  if (viewport === "desktop") {
    await page.evaluate((key) => localStorage.setItem(key, "1"), STORAGE_SIDEBAR_PINNED);
    await page.reload();
  }
  await settle(page);
  await openMenu();
  await collect('[data-testid="nav-main-list"]');

  for (const centre of visibleCentres(role)) {
    // The Control Centre's menu is the main menu itself.
    if (centre.key === "control") continue;
    await page.goto(centre.items[0].href);
    await settle(page);
    await openMenu();
    await collect('[data-testid="nav-centre-menu"]');
  }
  if (viewport === "desktop") {
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_SIDEBAR_PINNED);
  }
  const missing = expectedMenu(role, viewport).filter((href) => !found.has(href));
  return { rendered: [...found], missing };
}

/** Layout audit, in the page. Returns human-readable problems. */
async function layoutAudit(page: Page, viewport: ViewportName) {
  return page.evaluate((isPhone) => {
    const out: { kind: string; detail: string }[] = [];
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
    };
    const label = (el: Element) => {
      const tid = el.getAttribute("data-testid");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const aria = el.getAttribute("aria-label");
      return `${el.tagName.toLowerCase()}${tid ? `[data-testid=${tid}]` : ""}${aria ? `[aria-label="${aria}"]` : ""}${text ? ` "${text}"` : ""}`;
    };
    // Is the element inside something that scrolls sideways on purpose (a table wrapper, a carousel)?
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === "auto" || ox === "scroll" || ox === "hidden") && p.scrollWidth > p.clientWidth + 1) return true;
        if (ox === "hidden" || ox === "clip") return true;
      }
      return false;
    };
    const controls = Array.from(
      document.querySelectorAll('button, a[href], [role="button"], input:not([type=hidden]), select, textarea, [role="tab"], [role="switch"], [role="checkbox"]'),
    ).filter(visible);

    // Offscreen to the right (outside any intentional scroller).
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && !inScroller(el)) out.push({ kind: "offscreen", detail: `${label(el)} right=${Math.round(r.right)} > ${vw}` });
    }

    // Overlapping controls: two interactive elements whose boxes intersect by
    // more than a sliver, neither containing the other, and the one on top at
    // the centre of the overlap is not the other one (so it really covers it).
    // The part of an element actually on screen: its box cut by every
    // ancestor that clips (a scrolling menu, a table wrapper).
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      let l = r.left, t = r.top, rt = r.right, b = r.bottom;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
          const pr = p.getBoundingClientRect();
          l = Math.max(l, pr.left); t = Math.max(t, pr.top); rt = Math.min(rt, pr.right); b = Math.min(b, pr.bottom);
        }
      }
      return { left: l, top: t, right: rt, bottom: b };
    };
    const boxes = controls.map((el) => ({ el, r: shown(el) }));
    const seen = new Set<string>();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x1 = Math.max(a.r.left, b.r.left), x2 = Math.min(a.r.right, b.r.right);
        const y1 = Math.max(a.r.top, b.r.top), y2 = Math.min(a.r.bottom, b.r.bottom);
        if (x2 - x1 < 4 || y2 - y1 < 4) continue;
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        if (cy < 0 || cy > vh || cx < 0 || cx > vw) continue;
        const top = document.elementFromPoint(cx, cy);
        if (!top) continue;
        const coversA = !a.el.contains(top) && top !== a.el;
        const coversB = !b.el.contains(top) && top !== b.el;
        if (!(coversA || coversB)) continue;
        const key = `${label(a.el)}|${label(b.el)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind: "overlap", detail: `${label(a.el)} overlaps ${label(b.el)} (${Math.round(x2 - x1)}x${Math.round(y2 - y1)})` });
      }
    }

    // Touch targets on a phone.
    if (isPhone) {
      for (const el of controls) {
        const tag = el.tagName.toLowerCase();
        if (tag === "input" && ["checkbox", "radio"].includes((el as HTMLInputElement).type)) continue;
        // Inline links in running text are exempt (WCAG 2.5.8 inline exception).
        if (tag === "a" && getComputedStyle(el).display === "inline") continue;
        const r = el.getBoundingClientRect();
        if (r.height < 44 || r.width < 24) {
          out.push({ kind: "small-target", detail: `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}` });
        }
      }
    }

    // Dialogs and sheets that do not fit.
    for (const dlg of Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).filter(visible)) {
      const r = dlg.getBoundingClientRect();
      if (r.width > vw + 1 || r.left < -1) out.push({ kind: "dialog-overflow", detail: `${label(dlg)} width ${Math.round(r.width)} in ${vw}` });
      if (r.height > vh + 1 && getComputedStyle(dlg).overflowY !== "auto" && getComputedStyle(dlg).overflowY !== "scroll")
        out.push({ kind: "dialog-overflow", detail: `${label(dlg)} height ${Math.round(r.height)} in ${vh}, not scrollable` });
    }
    return out;
  }, viewport === "phone");
}

/**
 * At the very bottom of the page, is any control stuck under something fixed
 * (the Voice and WhatsApp launchers, a sticky bar)? There it cannot be
 * scrolled out from under it, so it cannot be pressed.
 */
async function coveredAtBottom(page: Page) {
  const out = await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 150));
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const found: string[] = [];
    const fixedAncestor = (el: Element | null): Element | null => {
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        const pos = getComputedStyle(p).position;
        if (pos === "fixed" || pos === "sticky") return p;
      }
      return null;
    };
    const label = (el: Element) => {
      const tid = el.getAttribute("data-testid");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const aria = el.getAttribute("aria-label");
      return `${el.tagName.toLowerCase()}${tid ? `[data-testid=${tid}]` : ""}${aria ? `[aria-label="${aria}"]` : ""}${text ? ` "${text}"` : ""}`;
    };
    for (const el of Array.from(document.querySelectorAll("main button, main a[href], main input:not([type=hidden]), main select, main textarea, main [role=combobox]"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      if (fixedAncestor(el)) continue;
      // Sample the centre and the four inner corners: covered if most are someone else's.
      const pts = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + 3, r.top + 3],
        [r.right - 3, r.top + 3],
        [r.left + 3, r.bottom - 3],
        [r.right - 3, r.bottom - 3],
      ].filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < vh);
      let coveredBy: Element | null = null;
      let hidden = 0;
      for (const [x, y] of pts) {
        const top = document.elementFromPoint(x, y);
        if (!top || el.contains(top) || top.contains(el)) continue;
        // Only something fixed counts: a sticky header covers a control
        // only until it is scrolled back down, which is fine.
        const fx = fixedAncestor(top);
        if (fx && getComputedStyle(fx).position === "fixed") {
          hidden += 1;
          coveredBy = fx;
        }
      }
      if (coveredBy && hidden >= Math.ceil(pts.length / 2)) found.push(`${label(el)} under ${label(coveredBy).slice(0, 80)}`);
    }
    window.scrollTo(0, 0);
    return found;
  });
  return out.map((detail) => ({ kind: "covered", detail }));
}

for (const role of ROLES) {
  for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
    test(`${role} @ ${viewport}: every menu page and link is clean`, async ({ browser }) => {
      test.setTimeout(15 * 60_000);
      const orgId = await resolveOrgId();
      const page = await pageAs(browser, role, orgId);
      await page.setViewportSize(VIEWPORTS[viewport]);
      const origin = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:5000").origin;

      const defects: Defect[] = [];
      let current = "/";
      const onConsole = (msg: ConsoleMessage) => {
        if (msg.type() !== "error") return;
        // Third-party resources (Google Fonts) are not ours, and a sandbox
        // without internet fails them; our own failures are caught by URL.
        const src = msg.location()?.url ?? "";
        if (/^https?:/.test(src) && !src.startsWith(origin)) return;
        // axe injects itself into every frame, including the receipt
        // preview's script-less sandbox, which refuses it: the scanner, not the app.
        if (src === "about:srcdoc" && /Blocked script execution/.test(msg.text())) return;
        defects.push({ kind: "console-error", hard: true, path: current, detail: `${msg.text().slice(0, 300)}${src ? ` @ ${src.replace(origin, "")}` : ""}` });
      };
      const onPageError = (err: Error) => {
        // The harness's own init scripts (org id, seen tours) also run inside
        // the receipt preview's sandboxed iframe, where storage is refused.
        // That is the harness, not the app: the frame has no scripts of its own.
        if (/sandboxed and lacks the 'allow-same-origin' flag/.test(err.message)) return;
        defects.push({ kind: "page-error", hard: true, path: current, detail: String(err.message).slice(0, 300) });
      };
      const onResponse = (res: Response) => {
        const url = new URL(res.url());
        if (url.origin !== origin) return;
        if (res.status() >= 400) {
          defects.push({ kind: "bad-status", hard: true, path: current, detail: `${res.request().method()} ${url.pathname}${url.search} -> ${res.status()}` });
        }
      };
      const onRequestFailed = (req: Request) => {
        const url = new URL(req.url());
        if (url.origin !== origin) return;
        const failure = req.failure()?.errorText ?? "failed";
        // A navigation away cancels the page's in-flight requests; that is not a defect.
        if (failure.includes("ERR_ABORTED")) return;
        defects.push({ kind: "request-failed", hard: true, path: current, detail: `${req.method()} ${url.pathname} ${failure}` });
      };
      page.on("console", onConsole);
      page.on("pageerror", onPageError);
      page.on("response", onResponse);
      page.on("requestfailed", onRequestFailed);

      current = "(menu)";
      const discovered = await discoverMenu(page, role, viewport, origin);
      for (let i = defects.length - 1; i >= 0; i--) if (VITE_DEV_NOISE.test(defects[i].detail)) defects.splice(i, 1);
      for (const href of discovered.missing) {
        defects.push({ kind: "menu-missing", hard: true, path: href, detail: `in nav-items.ts for ${role} but not shown in the ${viewport} menu` });
      }
      // Crawl what the source says the role has, even where the menu failed to show it.
      const menu = [...new Set([...discovered.rendered, ...discovered.missing])];
      const extras = (await extraRoutes(orgId)).filter((p) => !menu.includes(p));
      const queue = [...menu, ...extras];
      const visited = new Set<string>();
      const linkedFrom = new Map<string, string>();
      const MAX_PAGES = 120;

      mkdirSync(OUT_DIR, { recursive: true });
      const shotDir = join(OUT_DIR, `${role}-${viewport}`);
      mkdirSync(shotDir, { recursive: true });

      while (queue.length && visited.size < MAX_PAGES) {
        const path = queue.shift()!;
        if (visited.has(path)) continue;
        visited.add(path);
        current = path;
        let before = defects.length;

        await page.goto(path);
        await settle(page);
        // The dev server re-optimises a dependency the first time a page asks
        // for it and answers the old URL 504 ("Outdated Optimize Dep"); the
        // page then fails to import its chunk. That is Vite in dev, not the
        // app: drop what it caused and look at the page again.
        if (defects.slice(before).some((d) => VITE_DEV_NOISE.test(d.detail))) {
          defects.splice(before);
          await page.goto(path);
          await settle(page);
          before = defects.length;
        }

        const state = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
          bodyScrollW: document.body.scrollWidth,
          notFound: document.title.includes("not found") || !!document.body.innerText.match(/Page not found/),
          // A signed-in unknown path renders the Layout with nothing in it
          // (no "Page not found"), so a dead link shows as an empty page.
          blank: !!document.querySelector("main") && (document.querySelector("main") as HTMLElement).innerText.trim().length === 0,
          boundary: !!document.querySelector('[data-testid^="error-boundary"]'),
          noAccess: location.pathname.startsWith("/no-access"),
          finalPath: location.pathname + location.search,
        }));
        const from = linkedFrom.get(path);
        const where = from ? ` (linked from ${from})` : "";
        if (state.scrollW > state.clientW + 1) {
          defects.push({ kind: "horizontal-scroll", hard: true, path, detail: `scrollWidth ${state.scrollW} > ${state.clientW}` });
        }
        if (state.notFound && path !== "/a-page-that-does-not-exist") defects.push({ kind: "not-found", hard: true, path, detail: `lands on Page not found${where}` });
        if (state.boundary) defects.push({ kind: "error-boundary", hard: true, path, detail: `error boundary shown${where}` });
        const isExtra = extras.includes(path);
        if (state.blank && !state.notFound && path !== "/a-page-that-does-not-exist") defects.push({ kind: "blank-page", hard: true, path, detail: `the page renders nothing in <main>${where}` });
        // An unknown path must say so; any other page must not.
        const expectNotFound = path === "/a-page-that-does-not-exist";
        if (expectNotFound && !state.notFound) defects.push({ kind: "not-found", hard: true, path, detail: `an unknown path does not show "Page not found" (lands on ${state.finalPath})` });
        if (state.noAccess && !isExtra) defects.push({ kind: "no-access", hard: true, path, detail: `redirected to /no-access${where}` });

        if (DEEP) {
          for (const p of [...(await layoutAudit(page, viewport)), ...(await coveredAtBottom(page))]) {
            defects.push({ kind: p.kind as Defect["kind"], hard: STRICT, path, detail: p.detail });
          }
          const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze().catch(() => null);
          for (const v of axe?.violations ?? []) {
            if (v.impact !== "serious" && v.impact !== "critical") continue;
            defects.push({ kind: "axe", hard: STRICT, path, detail: `${v.id} (${v.impact}) ${v.nodes.length} node(s): ${v.nodes[0]?.target.join(" ")}` });
          }
        }

        if (defects.length > before) {
          const file = join(shotDir, `${path.replace(/[^a-z0-9]+/gi, "_") || "root"}.png`);
          await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
          for (let i = before; i < defects.length; i++) defects[i].screenshot = file;
        }

        // One level of in-page links from the menu pages.
        if (menu.includes(path)) {
          const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""));
          for (const h of hrefs) {
            const p = normalisePath(h, origin);
            if (p && !visited.has(p) && !queue.includes(p)) {
              queue.push(p);
              linkedFrom.set(p, path);
            }
          }
        }
      }

      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      await page.context().close();

      writeFileSync(
        join(OUT_DIR, `${role}-${viewport}.json`),
        JSON.stringify({ role, viewport, menu, visited: [...visited], defects }, null, 2),
      );

      const hard = defects.filter((d) => d.hard);
      const unknown = hard.filter((d) => !known(d));
      for (const d of hard.filter((x) => known(x))) {
        test.info().annotations.push({ type: `known:${known(d)}`, description: `${d.kind} ${d.path} ${d.detail}` });
      }
      for (const d of defects.filter((x) => !x.hard)) {
        test.info().annotations.push({ type: d.kind, description: `${d.path} ${d.detail}` });
      }
      expect(
        unknown.map((d) => `${d.kind} ${d.path}: ${d.detail}`),
        `ui-crawl defects for ${role} @ ${viewport} (screenshots in ${shotDir})`,
      ).toEqual([]);
      if (hard.length) {
        // Known failures are still failures: the spec stays red until they are fixed.
        expect(hard.map((d) => `[known ${known(d)}] ${d.kind} ${d.path}: ${d.detail}`)).toEqual([]);
      }
    });
  }
}
