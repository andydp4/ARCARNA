// Reusable screenshot capture for the training manual.
// Usage: node .capture.mjs <spec.json>
// Spec: [{ name, path, waitMs?, clicks?: [selectorOrText...], fill?: [[selector,value]...], fullPage? }]
import { chromium } from "playwright";
import fs from "fs";

const ORG_ID = "39d20e3b-4f8f-4ee5-84d7-3608955eaf32";
const OUT_DIR = "/home/user/ARCARNA/docs/training/images";
const specs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1.5,
});
const page = await context.newPage();

await page.goto("http://localhost:5000/", { waitUntil: "domcontentloaded" });
await page.evaluate((orgId) => localStorage.setItem("arcarna.selectedOrgId", orgId), ORG_ID);

async function hideDevChrome() {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      if (el.children.length === 0 && el.textContent?.trim() === "Dev bypass") {
        (el.closest("span,div,button") ?? el).remove();
      }
    }
    // Floating helper buttons (mic/chat) bottom-right clutter manual shots.
    document
      .querySelectorAll('button[class*="fixed"], div[class*="fixed"][class*="bottom-"][class*="right-"]')
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 90 && r.height < 90 && r.bottom > innerHeight - 200 && r.right > innerWidth - 120) {
          el.style.display = "none";
        }
      });
  });
}

for (const spec of specs) {
  try {
    await page.goto(`http://localhost:5000${spec.path}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(spec.waitMs ?? 1800);
    for (const [sel, val] of spec.fill ?? []) {
      await page.locator(sel).first().fill(val, { timeout: 5000 });
      await page.waitForTimeout(200);
    }
    for (const c of spec.clicks ?? []) {
      const loc = c.startsWith("@") ? page.getByText(c.slice(1), { exact: false }).first() : page.locator(c).first();
      await loc.click({ timeout: 8000 });
      await page.waitForTimeout(900);
    }
    await hideDevChrome();
    await page.screenshot({
      path: `${OUT_DIR}/${spec.name}.png`,
      fullPage: spec.fullPage ?? false,
    });
    console.log(`OK ${spec.name}`);
  } catch (err) {
    console.log(`FAIL ${spec.name}: ${err.message.split("\n")[0]}`);
  }
}

await browser.close();
