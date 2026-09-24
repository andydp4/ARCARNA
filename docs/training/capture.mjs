// Screenshot capture for the arcarna training manual (v1.2).
//
// Usage (the server must already be running as the role being captured,
// e.g. DEV_AUTH_BYPASS=1 DEV_AUTH_USER_ID=seed-cashier PORT=5110):
//   node docs/training/capture.mjs <cashier|manager|admin> [name,name,...]
//
// The shots themselves live in shots.mjs: one entry per <!-- SHOT: ... -->
// comment in sections/*.html, keyed by the image file name. Each entry names
// the role and viewport it must be taken at, the route, and an optional
// `setup(page, h)` that puts the page into the state the SHOT asks for.
// Demo data is fictional and prepared beforehand (see shots.mjs header).
//
// Environment:
//   CAPTURE_BASE  app URL including the base path (default http://localhost:5110/arcarna)
//   CHROME_PATH   Chromium executable (default: the Playwright bundle in /opt/pw-browsers)
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { shots } from "./shots.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT_DIR = path.join(DIR, "images");
const BASE = process.env.CAPTURE_BASE ?? "http://localhost:5110/arcarna";
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 },
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
};

// Routes may name demo records, e.g. "/open-orders/{S1}/refund"; CAPTURE_VARS
// points at a JSON file of those ids, written when the demo data was made.
const VARS = process.env.CAPTURE_VARS ? JSON.parse(fs.readFileSync(process.env.CAPTURE_VARS, "utf8")) : {};
const fillRoute = (r) => r.replace(/\{(\w+)\}/g, (_, k) => {
  if (!(k in VARS)) throw new Error(`route needs {${k}}: set CAPTURE_VARS`);
  return VARS[k];
});

const role = process.argv[2];
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
if (!["cashier", "manager", "admin"].includes(role)) {
  console.error("usage: node capture.mjs <cashier|manager|admin> [names]");
  process.exit(2);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROME,
  env: { ...process.env, LANG: "en_GB.UTF-8", LANGUAGE: "en_GB" },
  args: ["--no-sandbox", "--lang=en-GB", "--enable-experimental-web-platform-features", "--enable-features=WebBluetooth"],
});

/** Helpers handed to each shot's setup. */
function helpers(page) {
  return {
    base: BASE,
    wait: (ms) => page.waitForTimeout(ms),
    click: async (target, opts = {}) => {
      const loc = typeof target === "string" ? page.locator(target).first() : target;
      await loc.click({ timeout: 10000, ...opts });
      await page.waitForTimeout(opts.after ?? 600);
    },
    text: (t, exact = false) => page.getByText(t, { exact }).first(),
    role: (r, name, exact = false) => page.getByRole(r, { name, exact }).first(),
    api: async (method, p, body) =>
      page.evaluate(
        async ({ url, method, body }) => {
          const r = await fetch(url, {
            method,
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const t = await r.text();
          try { return JSON.parse(t); } catch { return t; }
        },
        { url: BASE + p, method, body },
      ),
  };
}

async function tidy(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-testid="dev-auth-badge"]').forEach((el) => el.remove());
    // The floating Voice and WhatsApp buttons sit over the bottom-right of
    // every page; they are not part of any figure.
    document.querySelectorAll("button.fixed.rounded-full").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom > innerHeight - 220 && r.right > innerWidth - 220) el.style.visibility = "hidden";
    });
  });
}

let ok = 0;
const failed = [];
for (const shot of shots) {
  if (shot.role !== role) continue;
  if (only && !only.has(shot.name)) continue;
  const base = VIEWPORTS[shot.viewport ?? "desktop"];
  // A few shots of tall dialogs or two stacked cards need a taller window.
  const vp = shot.height ? { ...base, viewport: { ...base.viewport, height: shot.height } } : base;
  const context = await browser.newContext({ ...vp, locale: "en-GB", timezoneId: "Europe/London", colorScheme: "light" });
  await context.addInitScript((ls) => {
    try {
      for (const [k, v] of Object.entries(ls)) {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      }
    } catch {}
  }, { "arcarna.sidebar.pinned": "0", ...(shot.localStorage ?? {}) });
  if (shot.routes) await shot.routes(context);
  const page = await context.newPage();
  const h = helpers(page);
  try {
    await page.goto(BASE + fillRoute(shot.route), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(shot.waitMs ?? 1500);
    if (shot.setup) await shot.setup(page, h);
    await page.waitForTimeout(500);
    await tidy(page);
    const file = path.join(OUT_DIR, shot.name);
    if (shot.clip) {
      const box = typeof shot.clip === "function" ? await shot.clip(page) : shot.clip;
      await page.screenshot({ path: file, clip: box });
    } else {
      await page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
    }
    console.log(`OK   ${shot.name}`);
    ok++;
  } catch (err) {
    console.log(`FAIL ${shot.name}: ${String(err.message).split("\n")[0]}`);
    failed.push(shot.name);
    try { await page.screenshot({ path: path.join(process.env.CAPTURE_FAIL_DIR ?? "/tmp", `capture-fail-${shot.name}`) }); } catch {}
  }
  await context.close();
}
await browser.close();
console.log(`${ok} captured, ${failed.length} failed${failed.length ? ": " + failed.join(", ") : ""}`);
process.exit(failed.length ? 1 : 0);
