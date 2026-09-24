/**
 * ui-crawl, dialogs (v1.2.1): every "Add / New / Create / Edit…" dialog and
 * sheet a menu page opens must fit a phone.
 *
 * For each menu page, as an admin and as a cashier at 412×915, this presses
 * each non-destructive opener it finds (up to a handful per page), then checks
 * the dialog or sheet that appears:
 *  - it is no wider than the screen and starts on it;
 *  - if taller than the screen, it scrolls (its own box or a child's);
 *  - its last action (Save, Create, Submit…) can be scrolled into view and
 *    is not covered by anything else once there;
 *  - its close control is at least 44×44 (reported, not failed: advisory).
 * Findings go to <UI_CRAWL_OUT>/dialogs-<role>.json with a screenshot each.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, pageAs, resolveOrgId, type Role } from "../journeys/fixtures";
import { visibleCentres } from "../../client/src/components/nav-items";

const PHONE = { width: 412, height: 915 };
const OUT_DIR = process.env.UI_CRAWL_OUT ?? join(process.cwd(), "test-results", "ui-crawl");
const OPENER = /^\s*(\+\s*)?(add|new|create|record|invite|import|edit|adjust|transfer|receive|open shift|start shift|log|set up|connect|upload|compose|z-report|view|payment|details|new order)\b/i;
const NEVER = /create order|place order|add to (cart|order)|delete|remove|void|refund|sign out|log out|export|download|print|send|close shift|end shift|pay now|charge|complete/i;
const PER_PAGE = 4;

type Finding = { path: string; opener: string; kind: string; detail: string; hard: boolean; screenshot?: string };

async function measure(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).filter((d) => {
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !d.closest('[data-testid$="-callout"]');
    });
    const dlg = dialogs[dialogs.length - 1] as HTMLElement | undefined;
    if (!dlg) return null;
    const r = dlg.getBoundingClientRect();
    const scrolls = (el: Element) => {
      const cs = getComputedStyle(el);
      return (cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
    };
    const anyScroller = scrolls(dlg) || Array.from(dlg.querySelectorAll("*")).some(scrolls);
    const buttons = Array.from(dlg.querySelectorAll("button")).filter((b) => b.getBoundingClientRect().width > 0);
    const close = buttons.find((b) => /close/i.test(b.getAttribute("aria-label") ?? "") || /^close$/i.test((b.textContent ?? "").trim()) || b.querySelector(".sr-only")?.textContent?.trim() === "Close");
    const closeBox = close?.getBoundingClientRect();
    const actions = buttons.filter((b) => b !== close && (b.getAttribute("type") === "submit" || /save|create|add|submit|confirm|record|next|continue|done|invite|import|upload/i.test(b.textContent ?? "")));
    const last = actions[actions.length - 1];
    let lastInfo: { text: string; reachable: boolean; covered: string | null } | null = null;
    if (last) {
      last.scrollIntoView({ block: "center" });
      const lr = last.getBoundingClientRect();
      const inView = lr.top >= 0 && lr.bottom <= vh && lr.left >= 0 && lr.right <= vw;
      const cx = lr.left + lr.width / 2;
      const cy = lr.top + lr.height / 2;
      const top = inView ? document.elementFromPoint(cx, cy) : null;
      // Only something outside the dialog counts: a disabled button has no
      // pointer events, so the point then lands on its own footer.
      const covered = top && !last.contains(top) && top !== last && !dlg.contains(top) ? `${top.tagName.toLowerCase()}${top.getAttribute("data-testid") ? `[data-testid=${top.getAttribute("data-testid")}]` : ""}` : null;
      lastInfo = { text: (last.textContent ?? "").trim().slice(0, 40), reachable: inView, covered };
    }
    return {
      title: (dlg.querySelector("h2, [id$='-title']")?.textContent ?? dlg.getAttribute("aria-label") ?? "").trim().slice(0, 60),
      box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      vw,
      vh,
      anyScroller,
      close: closeBox ? { w: Math.round(closeBox.width), h: Math.round(closeBox.height) } : null,
      last: lastInfo,
    };
  });
}

for (const role of ["ADMIN", "CASHIER"] as Role[]) {
  test(`${role} @ phone: dialogs and sheets fit`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const orgId = await resolveOrgId();
    const page = await pageAs(browser, role, orgId);
    await page.setViewportSize(PHONE);
    const shotDir = join(OUT_DIR, `dialogs-${role}`);
    mkdirSync(shotDir, { recursive: true });
    const findings: Finding[] = [];
    const seen: unknown[] = [];
    const paths = [...new Set(visibleCentres(role).flatMap((c) => c.items.map((i) => i.href)))];
    // A native confirm (leave with unsaved changes?) must never stall the walk.
    page.on("dialog", (d) => void d.accept().catch(() => undefined));
    const open = async (path: string) => {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      // Not networkidle: the Operations board keeps a live stream open.
      await page.waitForTimeout(2_500);
    };
    const save = () => writeFileSync(join(OUT_DIR, `dialogs-${role}.json`), JSON.stringify({ role, seen, findings }, null, 2));

    for (const path of paths) {
      await open(path);
      const openers = await page
        .locator("main button:visible, main [role=button]:visible")
        .evaluateAll((els) => els.map((el, i) => ({ i, text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40), aria: el.getAttribute("aria-label") ?? "" })));
      const picked = openers.filter((o) => OPENER.test(o.text || o.aria) && !NEVER.test(o.text || o.aria));
      if (process.env.UI_CRAWL_VERBOSE) console.log(`[dialogs] ${role} ${path}: ${openers.length} buttons, openers: ${picked.map((o) => o.text || o.aria).join(" | ")}`);
      const done = new Set<string>();
      for (const o of picked) {
        const label = o.text || o.aria;
        if (done.has(label) || done.size >= PER_PAGE) continue;
        done.add(label);
        // A fresh page for every opener: whatever the last one left open is gone.
        await open(path);
        const btn = page.locator("main button:visible, main [role=button]:visible").filter({ hasText: o.text || undefined }).first();
        const target = o.text ? btn : page.locator(`main [aria-label="${o.aria.replace(/"/g, '\\"')}"]:visible`).first();
        if (!(await target.isEnabled({ timeout: 5_000 }).catch(() => false))) continue;
        await target.click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(600);
        const m = await Promise.race([
          measure(page).catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), 10_000)),
        ]);
        if (process.env.UI_CRAWL_VERBOSE) console.log(`[dialogs]   ${label}: ${m ? `"${m.title}" ${JSON.stringify(m.box)}` : "no dialog"}`);
        if (!m) {
          await page.keyboard.press("Escape").catch(() => undefined);
          continue;
        }
        seen.push({ path, opener: label, ...m });
        const before = findings.length;
        const add = (kind: string, detail: string, hard: boolean) => findings.push({ path, opener: label, kind, detail, hard });
        if (m.box.w > m.vw + 1 || m.box.x < -1 || m.box.x + m.box.w > m.vw + 1) add("dialog-too-wide", `"${m.title}" at x=${m.box.x} w=${m.box.w} on a ${m.vw}px screen`, true);
        if (m.box.h > m.vh + 1 && !m.anyScroller) add("dialog-too-tall", `"${m.title}" ${m.box.h}px tall on a ${m.vh}px screen and nothing in it scrolls`, true);
        if (m.last && !m.last.reachable) add("action-unreachable", `"${m.title}": "${m.last.text}" cannot be brought on screen`, true);
        if (m.last?.covered) add("action-covered", `"${m.title}": "${m.last.text}" is covered by ${m.last.covered}`, true);
        if (m.close && (m.close.w < 44 || m.close.h < 44)) add("small-close", `"${m.title}": close control ${m.close.w}x${m.close.h}`, false);
        if (findings.length > before) {
          const file = join(shotDir, `${path.replace(/[^a-z0-9]+/gi, "_")}-${label.replace(/[^a-z0-9]+/gi, "_")}.png`);
          await page.screenshot({ path: file }).catch(() => undefined);
          for (let i = before; i < findings.length; i++) findings[i].screenshot = file;
        }
        await page.keyboard.press("Escape").catch(() => undefined);
      }
      save();
    }
    await page.context().close();
    save();
    for (const f of findings.filter((x) => !x.hard)) test.info().annotations.push({ type: f.kind, description: `${f.path} [${f.opener}] ${f.detail}` });
    expect(findings.filter((f) => f.hard).map((f) => `${f.kind} ${f.path} [${f.opener}]: ${f.detail}`)).toEqual([]);
  });
}
