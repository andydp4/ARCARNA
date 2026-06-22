import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import type { Result } from "axe-core";
import { prepareTenantContext } from "../helpers/e2eTenant";

const CRITICAL_PATHS = [
  { name: "POS", path: "/arcarna/create-order" },
  { name: "Customers", path: "/arcarna/customers" },
  { name: "Products", path: "/arcarna/products" },
  { name: "Orders", path: "/arcarna/open-orders" },
  { name: "Settings", path: "/arcarna/settings" },
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
