/**
 * Journey-suite fixtures.
 *
 * A "journey" walks a real user path end to end — through the browser where the
 * UI is the thing under test, or through the API where the contract is. The
 * suite exists because unit tests and the old 3-test smoke suite were both
 * green while a fully-built flow was unusable: nothing ever clicked a link.
 *
 * Roles come from the seeded users and are selected per request via the
 * localhost-only PHASE2D impersonation headers, so one server serves every
 * role without restarting.
 */
import {
  test as base,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

export const ROLE_USERS = {
  SUPER_ADMIN: "seed-super-admin",
  ADMIN: "seed-admin",
  MANAGER: "seed-manager",
  CASHIER: "seed-cashier",
} as const;

export type Role = keyof typeof ROLE_USERS;

const TEST_SECRET = process.env.PHASE2D_TEST_SECRET ?? "journey-suite-local-secret";

/** Impersonation headers for a seeded role, optionally scoped to an org. */
export function authHeaders(role: Role, orgId?: string): Record<string, string> {
  return {
    "x-test-replit-user-id": ROLE_USERS[role],
    "x-test-secret": TEST_SECRET,
    ...(orgId ? { "x-org-id": orgId } : {}),
  };
}

export async function apiAs(role: Role, orgId?: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000",
    extraHTTPHeaders: authHeaders(role, orgId),
  });
}

/** Resolves the seeded organisation id. Fails loudly — every journey needs it. */
export async function resolveOrgId(api: APIRequestContext): Promise<string> {
  const res = await api.get("/api/orgs");
  if (!res.ok()) {
    throw new Error(`Could not list organisations (${res.status()}). Is the database seeded?`);
  }
  const orgs = (await res.json()) as { id: string; name: string }[];
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new Error("No organisations found — run the SessionStart hook to seed the database.");
  }
  return orgs[0].id;
}

/**
 * Browser page authenticated as `role`. The org id is written to localStorage
 * before any app code runs, because the SPA reads it there to build its
 * `x-org-id` header.
 */
export async function pageAs(browser: Browser, role: Role, orgId: string): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: authHeaders(role, orgId),
  });
  // Key must match STORAGE_ORG_ID in shared/storageKeys.ts.
  await context.addInitScript((id) => {
    window.localStorage.setItem("arcarna.selectedOrgId", id);
  }, orgId);
  return context.newPage();
}

type JourneyFixtures = {
  /** API context as ADMIN, scoped to the seeded org — the common case. */
  api: APIRequestContext;
  orgId: string;
  /** Page as ADMIN, org scope pre-set. */
  adminPage: Page;
};

export const test = base.extend<JourneyFixtures>({
  orgId: async ({}, use) => {
    const bootstrap = await apiAs("SUPER_ADMIN");
    const id = await resolveOrgId(bootstrap);
    await bootstrap.dispose();
    await use(id);
  },

  api: async ({ orgId }, use) => {
    const ctx = await apiAs("ADMIN", orgId);
    await use(ctx);
    await ctx.dispose();
  },

  adminPage: async ({ browser, orgId }, use) => {
    const page = await pageAs(browser, "ADMIN", orgId);
    await use(page);
    await page.context().close();
  },
});

export { expect };

// ------------------------------------------------------------------ helpers

/** Asserts a toast containing `text` appears. Toast copy is the user-visible
 *  contract for a mutation succeeding or failing. */
export async function expectToast(page: Page, text: string | RegExp, timeout = 10_000) {
  const toast = page.getByText(text, { exact: false }).first();
  await expect(toast).toBeVisible({ timeout });
}

/** Bytes look like a PDF. Guards against an endpoint returning an HTML error
 *  page with a 200, which a status-only assertion would miss. */
export function looksLikePdf(buf: Buffer): boolean {
  return buf.length > 500 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Unique suffix so parallel runs and reruns never collide on names/SKUs. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
