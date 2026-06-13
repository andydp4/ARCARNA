import { test, expect } from "@playwright/test";

test.describe("API smoke", () => {
  test("GET /arcarna/api/health returns ok", async ({ request }) => {
    const res = await request.get("/arcarna/api/health");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  test("GET /arcarna/api/auth/runtime exposes dev bypass in e2e", async ({ request }) => {
    const res = await request.get("/arcarna/api/auth/runtime");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { devAuthBypass?: boolean };
    expect(body.devAuthBypass).toBe(true);
  });

  test("GET /midnight/ redirects 301 to /arcarna/", async ({ request }) => {
    const res = await request.get("/midnight/", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toMatch(/\/arcarna\/?$/);
  });
});

test.describe("SPA smoke", () => {
  test("ARCARNA EPOS shell loads at /arcarna/", async ({ page }) => {
    await page.goto("/arcarna/");
    await expect(page).toHaveTitle(/ARCARNA EPOS/i);
    await expect(page.locator("#root")).toBeAttached();
  });
});
