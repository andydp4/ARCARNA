import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import type { Result } from "axe-core";
import { prepareTenantContext } from "../helpers/e2eTenant";

const CRITICAL_PATHS = [
  { name: "Customers", path: "/customers" },
  { name: "Products", path: "/products" },
  // The Operations Centre replaced Open Orders in N1; /open-orders now
  // redirects here, and the assertion below that a critical path does not
  // redirect would fail on the old entry (docs/briefs/PHASE_N_OPERATIONS_CENTRE.md).
  // N6 folded the order form into this same page (`/create-order` and `/pos`
  // now redirect here too, for the same reason) — this entry's own scan
  // already covers the embedded form, so a separate "POS" entry pointing at
  // `/create-order` would just be a same-page duplicate now, tripping the
  // same no-redirect assertion the comment above already explains.
  { name: "Operations", path: "/operations" },
  { name: "Settings", path: "/settings" },
] as const;

function seriousOrCritical(violations: Result[]): Result[] {
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

function formatViolations(violations: Result[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`)
    .join("\n");
}

for (const { name, path } of CRITICAL_PATHS) {
  test(`${name} — zero serious/critical axe violations`, async ({ page, request }) => {
    await prepareTenantContext(page, request);
    await page.goto(path);
    await page.waitForLoadState("domcontentloaded");
    expect(new URL(page.url()).pathname).toBe(path);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const bad = seriousOrCritical(results.violations);
    expect(bad, formatViolations(bad)).toEqual([]);
  });
}
