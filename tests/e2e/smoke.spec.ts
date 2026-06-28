import { test, expect } from "@playwright/test";

// App is served at site root (arcarna.viger.cloud/, VITE_BASE_PATH=/).
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
  test("ARCARNA EPOS shell loads at root", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/ARCARNA EPOS/i);
    await expect(page.locator("#root")).toBeAttached();
  });
});
