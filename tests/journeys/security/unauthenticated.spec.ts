/**
 * Checkpoint 5.4 — unauthenticated access.
 *
 * The programme's wording is "every route → 401, no body leakage". What
 * actually happens depends on how the server under test is configured, and
 * there are three genuinely different modes. Asserting 401 blindly would pass
 * or fail for reasons unrelated to the security property, so this file first
 * reads `/api/auth/runtime` and then asserts the mode it is actually in. The
 * one property asserted in *all* modes is the one that matters: an anonymous
 * caller must never be served tenant data.
 *
 *   1. `DEV_AUTH_BYPASS=1` (what `playwright.config.ts` starts): every request
 *      is silently promoted to a synthetic user. No 401 is reachable, by
 *      design. Recorded, not asserted away.
 *   2. Bypass off, Clerk provider with a publishable key: clean
 *      `401 {"message":"Unauthorized"}`. Verified against a server started with
 *      `CLERK_PUBLISHABLE_KEY` set.
 *   3. Bypass off, Clerk provider with NO publishable key: `getAuth()` throws
 *      because `clerkMiddleware` was never mounted
 *      (server/auth/clerkAuth.ts:24-29 returns a pass-through when the key is
 *      absent; :109 then calls `getAuth`), and the request ends as a **500**
 *      whose body is the Clerk library's own error text. Access is still
 *      denied, but the status is wrong and the body leaks framework internals.
 *      Recorded as a finding below.
 *
 * Run the security directory with `--workers=1` — see orgScopeForgery.spec.ts.
 */
import { test, expect } from "@playwright/test";
import {
  apiAnonymous,
  authMode,
  createOrgB,
  destroyProvisioned,
  internalLeak,
  leakedValues,
  provisionOrgRecords,
  type AuthMode,
  type OrgRecords,
} from "./tenants";

test.describe.configure({ mode: "default" });

/** A representative slice of the API: reads, writes, money, admin, documents. */
const ROUTES: { method: "get" | "post" | "patch" | "put" | "delete"; path: string }[] = [
  { method: "get", path: "/api/products" },
  { method: "get", path: "/api/customers" },
  { method: "get", path: "/api/orders" },
  { method: "get", path: "/api/suppliers" },
  { method: "get", path: "/api/purchase-drafts" },
  { method: "get", path: "/api/goods-receipts" },
  { method: "get", path: "/api/inventory/transfers" },
  { method: "get", path: "/api/replenishment/recommendations" },
  { method: "get", path: "/api/gift-cards" },
  { method: "get", path: "/api/locations" },
  { method: "get", path: "/api/orgs" },
  { method: "get", path: "/api/auth/user" },
  { method: "get", path: "/api/admin/allowed-users" },
  { method: "post", path: "/api/suppliers" },
  { method: "post", path: "/api/products" },
  { method: "post", path: "/api/goods-receipts" },
  { method: "post", path: "/api/replenishment/create-purchase-draft" },
  { method: "post", path: "/api/gift-cards" },
];

/** Deliberately public — the SPA needs them before anyone has signed in. */
const PUBLIC_ROUTES = ["/api/health", "/api/auth/runtime"];

let mode: AuthMode;
let orgBId: string;
let b: OrgRecords;

test.beforeAll(async () => {
  mode = await authMode();
  const created = await createOrgB();
  orgBId = created.orgId;
  b = await provisionOrgRecords(created.api, created.orgId);
  await created.api.dispose();
});

test.afterAll(async () => {
  await destroyProvisioned();
});

function tenantValues(): string[] {
  return [b.supplierId, b.productId, b.customerId, b.purchaseDraftId, b.giftCardId, orgBId];
}

test.describe("5.4 unauthenticated access", () => {
  test("the auth mode of the server under test is recorded, not assumed", async () => {
    console.log(
      `[5.4 CONFIG] devAuthBypass=${mode.devAuthBypass} clerkConfigured=${mode.clerkConfigured} ` +
        `nodeEnv=${mode.nodeEnv} phase2dTest=${mode.phase2dTest}`,
    );
    expect(typeof mode.devAuthBypass).toBe("boolean");
  });

  test("no anonymous request is ever served tenant data — true in every mode", async () => {
    // This is the property that holds regardless of configuration, so it is the
    // one asserted unconditionally.
    const api = await apiAnonymous();
    const leaks: string[] = [];
    for (const r of ROUTES) {
      const res = await api[r.method](r.path);
      const body = await res.text();
      const found = leakedValues(body, tenantValues());
      if (found.length) leaks.push(`${r.method.toUpperCase()} ${r.path} leaked ${found.join(", ")}`);
    }
    await api.dispose();
    expect(leaks, "an anonymous caller was served tenant data").toEqual([]);
  });

  test("401 with a bare message, when the server can produce one", async () => {
    test.skip(
      mode.devAuthBypass || !mode.clerkConfigured,
      "a 401 is only reachable with DEV_AUTH_BYPASS off and CLERK_PUBLISHABLE_KEY set; " +
        "this server is in a different mode and the behaviour it does have is asserted separately",
    );
    const api = await apiAnonymous();
    const wrong: string[] = [];
    const leaks: string[] = [];
    for (const r of ROUTES) {
      const res = await api[r.method](r.path);
      const body = await res.text();
      if (res.status() !== 401) wrong.push(`${r.method.toUpperCase()} ${r.path} → ${res.status()}`);
      const leak = internalLeak(body);
      if (leak) leaks.push(`${r.method.toUpperCase()} ${r.path} disclosed ${leak}`);
    }
    await api.dispose();
    expect(wrong, "every API route must answer 401 to an anonymous caller").toEqual([]);
    expect(leaks, "a 401 body must carry no internals").toEqual([]);
  });

  /**
   * OPEN FINDING — wrong status and an internal disclosure when Clerk is the
   * provider but no publishable key is configured.
   *
   * `test.fail()` because there is no configuration in which a 500 carrying the
   * Clerk library's setup instructions is the right answer to "who are you?".
   * Verified: the same build with `CLERK_PUBLISHABLE_KEY` set answers
   * `401 {"message":"Unauthorized"}`, so the fix is a guard, not a redesign.
   */
  test.fail("an anonymous request must not produce a 500 or echo library internals", async () => {
    test.skip(
      mode.devAuthBypass || mode.clerkConfigured,
      "only applies with the bypass off and no Clerk publishable key",
    );
    const api = await apiAnonymous();
    const fiveHundreds: string[] = [];
    const leaks: string[] = [];
    for (const r of ROUTES) {
      const res = await api[r.method](r.path);
      const body = await res.text();
      if (res.status() >= 500) fiveHundreds.push(`${r.method.toUpperCase()} ${r.path} → ${res.status()}`);
      if (/clerkMiddleware|clerk\.com/i.test(body)) {
        leaks.push(`${r.method.toUpperCase()} ${r.path} echoed Clerk setup instructions`);
      }
    }
    await api.dispose();
    console.log(
      `[5.4 FINDING] ${fiveHundreds.length}/${ROUTES.length} anonymous requests returned 5xx, ` +
        `${leaks.length} echoed the Clerk library error ` +
        `(server/auth/clerkAuth.ts:24-29 mounts a no-op when CLERK_PUBLISHABLE_KEY is unset, ` +
        `then :109 calls getAuth and throws)`,
    );
    expect(fiveHundreds, "an unauthenticated request must not 500").toEqual([]);
    expect(leaks, "an error body must not echo library setup instructions").toEqual([]);
  });

  test("CHARACTERISATION — what this server actually does with no credentials", async () => {
    // The fail-closed assertion below is the correct contract for a real
    // deployment, but the journey server runs with DEV_AUTH_BYPASS=1
    // (playwright.config.ts), which promotes anonymous callers by design. Held
    // against a deliberately fail-open server this asserted a guarantee the
    // mode does not offer; the bypass behaviour is asserted by the test below.
    test.skip(mode.devAuthBypass, "the bypass promotes anonymous callers by design");
    // Whatever the mode, record the real status distribution so the report can
    // quote it rather than paraphrase it, and so a change is visible.
    const api = await apiAnonymous();
    const statuses: Record<string, number> = {};
    for (const r of ROUTES) {
      const res = await api[r.method](r.path);
      const key = `${res.status()}`;
      statuses[key] = (statuses[key] ?? 0) + 1;
    }
    await api.dispose();
    console.log(`[5.4 OBSERVED] anonymous status distribution: ${JSON.stringify(statuses)}`);
    expect(
      Object.keys(statuses).some((s) => Number(s) >= 400),
      "no anonymous request may succeed",
    ).toBeTruthy();
    expect(statuses["200"], "no API route may return 200 to an anonymous caller").toBeUndefined();
  });

  test("with DEV_AUTH_BYPASS=1, anonymous callers are promoted — recorded", async () => {
    test.skip(!mode.devAuthBypass, "only meaningful on a bypass-enabled server");
    // tryDevAuthBypass (server/auth/commonAuth.ts:49-82) builds a session user
    // for DEV_AUTH_USER_ID with no credential of any kind. If that id is absent
    // from allowed_users it defaults to SUPER_ADMIN, and requireOrgContext will
    // auto-select the org when exactly one exists — i.e. on a single-tenant dev
    // database an unauthenticated caller gets full super-admin scope.
    //
    // OPEN FINDING, dev-only. That default is fail-open in the wrong direction:
    // an *unrecognised* id should get less access than a known one, not
    // unscoped super-admin over every tenant. CI proved it — with no .env to
    // supply DEV_AUTH_USER_ID the bypass became an unscoped SUPER_ADMIN, and
    // the two cross-tenant assertions in this suite failed exactly as they
    // should. playwright.config.ts now pins the id so the mode is the same
    // everywhere, which makes those assertions meaningful again but does not
    // change the default. It never runs in production (isDevAuthBypassEnabled
    // requires DEV_AUTH_BYPASS=1 and NODE_ENV !== production), so it is
    // recorded here rather than changed inside a purchasing branch.
    const api = await apiAnonymous();
    const who = await api.get("/api/auth/user");
    const body = await who.text();
    console.log(`[5.4 CONFIG] DEV_AUTH_BYPASS=1: GET /api/auth/user anonymously → ${who.status()} ${body.slice(0, 240)}`);
    await api.dispose();
    expect(who.status(), "bypass mode answers, it does not challenge").not.toBe(401);
  });

  test("the public routes stay public and leak nothing", async () => {
    const api = await apiAnonymous();
    for (const path of PUBLIC_ROUTES) {
      const res = await api.get(path);
      expect(res.status(), `${path} must remain reachable`).toBe(200);
      const body = await res.text();
      expect(leakedValues(body, tenantValues()), `${path} leaked tenant data`).toEqual([]);
      expect(internalLeak(body), `${path} leaked internals`).toBeNull();
      expect(body, "no secret material in a public probe").not.toMatch(/sk_(test|live)_|SESSION_SECRET|DATABASE_URL/);
    }
    await api.dispose();
  });

  /**
   * OPEN FINDING — unmatched `/api/*` paths fall through to the SPA shell.
   *
   * Both the dev fallback (server/vite.ts:36-54) and the production one
   * (server/static.ts:48-54) are pathless middleware that answer every
   * unmatched request with `200 text/html`. So an unknown API path — or a known
   * path with the wrong verb — returns the React index page with a 200, without
   * ever passing through `isAuthenticated`. No tenant data escapes, but a
   * client typo becomes an invisible success, which is precisely the defect
   * class this programme exists to catch: the caller's `res.json()` then fails
   * on HTML rather than on a 404 anyone can see.
   */
  test.fail("an unknown /api path must 404, not return the SPA shell with 200", async () => {
    const api = await apiAnonymous();
    const probes: { method: "get" | "post" | "patch" | "put" | "delete"; path: string }[] = [
      { method: "get", path: "/api/definitely-not-a-route" },
      { method: "post", path: "/api/definitely-not-a-route" },
      { method: "patch", path: "/api/rules/00000000-0000-4000-8000-000000000000" }, // registered as PUT
      { method: "patch", path: "/api/scheduled-reports/00000000-0000-4000-8000-000000000000" },
    ];
    const htmlTwoHundreds: string[] = [];
    for (const p of probes) {
      const res = await api[p.method](p.path);
      const type = res.headers()["content-type"] ?? "";
      if (res.status() === 200 && type.includes("text/html")) {
        htmlTwoHundreds.push(`${p.method.toUpperCase()} ${p.path} → 200 ${type}`);
      }
    }
    await api.dispose();
    console.log(
      `[5.4 FINDING] ${htmlTwoHundreds.length}/${probes.length} unmatched API requests returned the SPA ` +
        `shell with 200: ${htmlTwoHundreds.join("; ")} (server/vite.ts:36, server/static.ts:48)`,
    );
    expect(htmlTwoHundreds, "unmatched /api paths must 404 as JSON").toEqual([]);
  });
});
