/**
 * Harness self-test (programme checkpoint 1.4).
 *
 * Everything downstream trusts this file. It proves the fixtures actually
 * authenticate, actually scope to an org, and actually distinguish roles —
 * because a harness that silently authenticates as nobody, or as the same role
 * every time, would make every later "passing" journey meaningless.
 */
import { test, expect, apiAs, resolveOrgId, pageAs, type Role } from "./fixtures";

test.describe("harness", () => {
  test("resolves the seeded organisation", async ({ orgId }) => {
    expect(orgId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("impersonation is actually applied — each role reports itself", async ({ orgId }) => {
    const expected: Record<Role, string> = {
      SUPER_ADMIN: "SUPER_ADMIN",
      ADMIN: "ADMIN",
      MANAGER: "MANAGER",
      CASHIER: "CASHIER",
    };

    for (const role of Object.keys(expected) as Role[]) {
      const api = await apiAs(role, orgId);
      const res = await api.get("/api/auth/user");
      expect(res.ok(), `${role}: /api/auth/user should succeed`).toBeTruthy();
      const user = await res.json();
      expect(user.role, `${role} should be reported as ${expected[role]}`).toBe(expected[role]);
      await api.dispose();
    }
  });

  test("without the test secret, impersonation is refused", async ({ orgId }) => {
    // Falls back to DEV_AUTH_BYPASS rather than honouring a forged user id —
    // proving the header alone cannot select a user.
    const forged = await (
      await import("@playwright/test")
    ).request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000",
      extraHTTPHeaders: {
        "x-test-replit-user-id": "seed-super-admin",
        "x-org-id": orgId,
        // no x-test-secret
      },
    });
    const res = await forged.get("/api/auth/user");
    const user = res.ok() ? await res.json() : null;
    // The dev-bypass user is seed-cashier (DEV_AUTH_USER_ID), not the forged id.
    expect(user?.id, "forged user id must not be honoured without the secret").not.toBe(
      "seed-super-admin",
    );
    await forged.dispose();
  });

  test("an authenticated page loads the app shell, not a sign-in wall", async ({
    browser,
    orgId,
  }) => {
    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/");
    await expect(page.locator("#root")).toBeVisible({ timeout: 30_000 });
    // Landing on sign-in would mean the impersonation headers never reached the app.
    await expect(page).not.toHaveURL(/\/sign-in/);
    await page.context().close();
  });

  test("org scope reaches the API from the browser", async ({ browser, orgId }) => {
    const page = await pageAs(browser, "ADMIN", orgId);
    await page.goto("/");
    const res = await page.request.get("/api/products");
    expect(res.ok(), "products should be readable within org scope").toBeTruthy();
    expect(Array.isArray(await res.json())).toBeTruthy();
    await page.context().close();
  });
});
