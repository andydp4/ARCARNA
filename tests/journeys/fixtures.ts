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

// ------------------------------------------------------- money-path helpers

/** Fails with the response body included — a bare status code is not debuggable. */
export async function okJson<T = any>(res: {
  ok(): boolean;
  status(): number;
  json(): Promise<any>;
  text(): Promise<string>;
  url(): string;
}): Promise<T> {
  if (!res.ok()) {
    throw new Error(`${res.status()} from ${res.url()}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function firstLocationId(api: APIRequestContext): Promise<string> {
  const locations = await okJson<{ id: string }[]>(await api.get("/api/locations"));
  if (!locations.length) throw new Error("No locations — database not seeded?");
  return locations[0].id;
}

/**
 * POST /api/orders is gated by requireOpenShift, so any order journey must open
 * a shift first. Reuses the caller's existing open shift when there is one,
 * because a second open for the same user+location is rejected.
 */
export async function ensureOpenShift(
  api: APIRequestContext,
  locationId: string,
  openingFloat = 100,
): Promise<string> {
  const current = await api.get("/api/shifts/current", {
    headers: { "x-location-id": locationId },
  });
  if (current.ok()) {
    const body = await current.json();
    const existing = body?.id ?? body?.shift?.id;
    if (existing && (body?.status ?? body?.shift?.status) === "open") return existing;
  }
  const opened = await okJson<{ id: string }>(
    await api.post("/api/shifts/open", {
      headers: { "x-location-id": locationId },
      data: { locationId, openingFloat },
    }),
  );
  return opened.id;
}

export type OrderLine = { productId: string; quantity: number; unitPrice: number };

export async function placeOrder(
  api: APIRequestContext,
  locationId: string,
  lines: OrderLine[],
  paymentMethod: "cash" | "card" | "transfer" | "tick" | "gift_card" = "cash",
  extra: Record<string, unknown> = {},
) {
  return api.post("/api/orders", {
    headers: { "x-location-id": locationId },
    data: { lines, paymentMethod, ...extra },
  });
}

/**
 * Stock for a product at a location, as the API reports it.
 *
 * There is no dedicated location-stock endpoint; `GET /api/products` resolves
 * stock against the active location (see locationStockScope.test.ts), so the
 * location is passed as a header rather than a query param.
 */
export async function locationStock(
  api: APIRequestContext,
  productId: string,
  locationId: string,
): Promise<number> {
  const products = await okJson<{ id: string; stock: number }[]>(
    await api.get("/api/products", { headers: { "x-location-id": locationId } }),
  );
  const row = products.find((p) => p.id === productId);
  if (!row) throw new Error(`Product ${productId} not visible at location ${locationId}`);
  return row.stock;
}

/**
 * Waits for stock to reach `expected`.
 *
 * Sale stock movements are NOT applied inside the order transaction: the order
 * publishes an event to `domain_outbox` and `server/workers/inventoryWorker.ts`
 * applies the delta when the worker runner next dispatches. Measured latency is
 * a few seconds, so any assertion on post-sale stock must poll rather than read
 * once — reading immediately returns the pre-sale value and looks like a
 * missing decrement.
 */
export async function waitForStock(
  api: APIRequestContext,
  productId: string,
  locationId: string,
  expected: number,
  timeoutMs = 30_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = await locationStock(api, productId, locationId);
  while (Date.now() < deadline) {
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, 500));
    last = await locationStock(api, productId, locationId);
  }
  return last;
}
