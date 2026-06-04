import { test, expect } from "@playwright/test";

test.describe("API smoke", () => {
  test("GET /api/health returns ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  test("GET /api/auth/runtime exposes dev bypass in e2e", async ({ request }) => {
    const res = await request.get("/api/auth/runtime");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { devAuthBypass?: boolean };
    expect(body.devAuthBypass).toBe(true);
  });
});

test.describe("SPA smoke", () => {
  test("Midnight EPOS shell loads at /midnight/", async ({ page }) => {
    await page.goto("/midnight/");
    await expect(page).toHaveTitle(/Midnight EPOS/i);
    await expect(page.locator("#root")).toBeAttached();
  });
});
