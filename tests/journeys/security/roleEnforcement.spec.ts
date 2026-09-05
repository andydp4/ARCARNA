/**
 * Checkpoint 5.1 — role enforcement on mutating routes.
 *
 * ## How to run this file
 *
 * `requireRole()` short-circuits to `next()` whenever `DEV_AUTH_BYPASS=1`
 * (server/auth/commonAuth.ts:94-95), and `playwright.config.ts` sets that flag
 * in its managed `webServer` env. Against that server no 403 can ever be
 * produced, so these assertions would be vacuous. They therefore skip
 * themselves unless the server under test has the bypass off, and one test
 * below records the bypass-on behaviour explicitly so the gap is visible rather
 * than silently skipped.
 *
 * To exercise the gates, start the app yourself and let Playwright reuse it
 * (`reuseExistingServer` is on outside CI):
 *
 *   DATABASE_URL=... SESSION_SECRET=... NODE_ENV=development PORT=5100 \
 *   PHASE2D_TEST=1 PHASE2D_TEST_SECRET=journey-suite-local-secret \
 *   APP_BASE_PATH=/ VITE_BASE_PATH=/ npx tsx server/index.ts &
 *   PORT=5100 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5100 \
 *     npx playwright test --project=journeys tests/journeys/security/
 *
 * ## How each probe is built
 *
 * Every probe is deliberately shaped so that an *authorised* caller also fails
 * — an unknown id, or a body that cannot validate. That makes the pair of
 * assertions meaningful without writing anything:
 *
 *   - the denied role must get **403**;
 *   - the permitted role must get something that is **not 403**, proving the
 *     403 came from the role gate and not from the route being broken;
 *   - and an org-wide database fingerprint must be **identical** before and
 *     after every probe, proving no rejected request wrote anything.
 *
 * A 403 that still wrote is worse than one that did not, and a status-only
 * assertion cannot tell the two apart.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { apiAs, type Role } from "../fixtures";
import {
  authMode,
  destroyProvisioned,
  orgFingerprint,
  provisionOrgRecords,
  resolveOrgAId,
  ROLE_GATE_OFF_REASON,
  internalLeak,
  type OrgRecords,
} from "./tenants";

/** Well-formed but unused UUID — a route reached with it must 404, never 200. */
const ABSENT = "00000000-0000-4000-8000-000000000000";

type Method = "post" | "put" | "patch" | "delete";

type Probe = {
  method: Method;
  path: string;
  /** Body chosen so an authorised caller gets a non-403 4xx. */
  body?: unknown;
  /** Roles the route is declared to allow, from its `requireRole(...)` call. */
  allow: Role[];
  /** Where the guard is declared, for a failure message that points at code. */
  where: string;
  /**
   * Statuses that count as "denied" for this route. Defaults to 403 only. The
   * import routes sit behind `importLimiter` (5/min, server/security.ts:46),
   * which is mounted before the auth chain, so on a reused server they answer
   * 429 before the role gate is reached. That is still a denial and still
   * writes nothing, so both are accepted — but only where a limiter exists.
   */
  deny?: number[];
};

/**
 * Routes whose `requireRole(...)` excludes CASHIER. Grouped by the role set so
 * the "permitted role" control can pick a role that is genuinely allowed.
 */
const MANAGER_AND_UP: Probe[] = [
  { method: "post", path: "/api/suppliers", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/suppliers.ts:64" },
  { method: "patch", path: `/api/suppliers/${ABSENT}`, body: { name: "" }, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/suppliers.ts:78" },
  { method: "delete", path: `/api/suppliers/${ABSENT}`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/suppliers.ts:88" },
  { method: "post", path: "/api/product-suppliers", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/suppliers.ts:110" },
  { method: "patch", path: `/api/product-suppliers/${ABSENT}`, body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/suppliers.ts:124" },
  { method: "delete", path: `/api/product-suppliers/${ABSENT}`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/suppliers.ts:134" },

  { method: "patch", path: `/api/purchase-drafts/${ABSENT}`, body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/purchaseDrafts.ts:66" },
  { method: "delete", path: `/api/purchase-drafts/${ABSENT}`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/purchaseDrafts.ts:76" },
  { method: "patch", path: `/api/purchase-drafts/${ABSENT}/status`, body: { status: "not-a-status" }, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/purchaseDrafts.ts:86" },
  { method: "post", path: `/api/purchase-drafts/${ABSENT}/items`, body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/purchaseDrafts.ts:100" },
  { method: "patch", path: `/api/purchase-drafts/${ABSENT}/items/${ABSENT}`, body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/purchaseDrafts.ts:114" },
  { method: "delete", path: `/api/purchase-drafts/${ABSENT}/items/${ABSENT}`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/purchaseDrafts.ts:124" },

  { method: "post", path: "/api/goods-receipts", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/goodsReceipts.ts:68" },
  { method: "post", path: `/api/goods-receipts/${ABSENT}/complete`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/goodsReceipts.ts:99" },
  { method: "post", path: `/api/goods-receipts/${ABSENT}/void`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/goodsReceipts.ts:113" },

  { method: "post", path: "/api/replenishment/create-transfer-draft", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/replenishment.ts:86" },
  { method: "post", path: "/api/replenishment/create-purchase-draft", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/replenishment.ts:116" },
  { method: "post", path: "/api/replenishment/create-purchase-drafts", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/replenishment.ts:146" },

  { method: "post", path: "/api/inventory/transfers", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/inventoryTransfers.ts:67" },
  { method: "patch", path: `/api/inventory/transfers/${ABSENT}/status`, body: { status: "not-a-status" }, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/inventoryTransfers.ts:103" },
  { method: "patch", path: `/api/inventory/${ABSENT}`, body: { adjustment: 5, type: "adjustment" }, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/inventory.ts:30" },

  { method: "put", path: `/api/orders/${ABSENT}`, body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/orders.ts:324" },
  { method: "delete", path: `/api/orders/${ABSENT}`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/orders.ts:375" },

  { method: "put", path: "/api/loyalty/settings", body: { redemptionRate: "not-a-number" }, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/loyalty.ts:45" },
  { method: "put", path: "/api/receipts/settings", body: { receiptFooterText: 12345 }, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/receipts.ts:76" },

  { method: "post", path: "/api/rules", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/automation.ts:44" },
  { method: "put", path: `/api/rules/${ABSENT}`, body: { trigger: 42 }, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/automation.ts:75" },
  { method: "delete", path: `/api/rules/${ABSENT}`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/automation.ts:115" },
  { method: "post", path: "/api/rules/test", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/automation.ts:135" },

  { method: "post", path: "/api/scheduled-reports", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/scheduledReports.ts:44" },
  { method: "put", path: `/api/scheduled-reports/${ABSENT}`, body: { cadence: 99 }, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/scheduledReports.ts:77" },
  { method: "delete", path: `/api/scheduled-reports/${ABSENT}`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/scheduledReports.ts:126" },

  { method: "post", path: "/api/reseller-partners", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/reportCapture.ts:158" },
  { method: "post", path: "/api/reseller-transactions", body: {}, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/reportCapture.ts:186" },

  { method: "post", path: `/api/shifts/${ABSENT}/reopen`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/shifts.ts:319" },
  { method: "post", path: `/api/gift-cards/NOSUCHCODE/void`, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/giftCards.ts:96" },

  { method: "patch", path: "/api/org/setup", body: { businessName: 12345 }, allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/setupImports.ts:60" },
  { method: "post", path: "/api/products/import/preview", body: {}, deny: [403, 429], allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/setupImports.ts:103" },
  { method: "post", path: "/api/products/import", body: {}, deny: [403, 429], allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/setupImports.ts:121" },
  { method: "post", path: "/api/customers/import/preview", body: {}, deny: [403, 429], allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/setupImports.ts:176" },
  { method: "post", path: "/api/customers/import", body: {}, deny: [403, 429], allow: ["SUPER_ADMIN", "ADMIN", "MANAGER"], where: "server/routes/setupImports.ts:216" },
];

/** Routes restricted to SUPER_ADMIN/ADMIN — a MANAGER must be refused too. */
const ADMIN_ONLY: Probe[] = [
  { method: "post", path: "/api/locations", body: {}, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/locations.ts:30" },
  { method: "patch", path: `/api/locations/${ABSENT}`, body: {}, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/locations.ts:42" },
  { method: "delete", path: `/api/locations/${ABSENT}`, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/locations.ts:54" },
  { method: "post", path: `/api/locations/${ABSENT}/set-default`, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/locations.ts:67" },
  { method: "post", path: "/api/cashiers", body: {}, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/cashiers.ts:96" },
  { method: "patch", path: `/api/cashiers/${ABSENT}`, body: {}, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/cashiers.ts:139" },
  { method: "delete", path: `/api/cashiers/${ABSENT}`, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/cashiers.ts:178" },
  { method: "put", path: "/api/feature-flags/not_a_real_flag", body: { enabled: true }, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/featureFlags.ts:50" },
  { method: "post", path: "/api/api-keys", body: {}, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/channels.ts:69" },
  { method: "post", path: `/api/api-keys/${ABSENT}/revoke`, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/channels.ts:96" },
  { method: "post", path: "/api/webhooks", body: {}, allow: ["SUPER_ADMIN", "ADMIN"], where: "server/routes/channels.ts:136" },
];

/**
 * Mutating routes registered with `scoped` only — no `requireRole` at all — so a
 * CASHIER reaches the handler. Whether that is the intended policy is a product
 * decision, so this suite characterises the behaviour instead of asserting a
 * verdict: the set of routes a CASHIER can reach is pinned, and adding or
 * removing a guard turns the test red and asks for the list to be updated.
 * Every entry here is reported as a Phase 5.1 finding.
 */
const UNGUARDED_MUTATIONS: Probe[] = [
  { method: "post", path: "/api/products", body: {}, allow: [], where: "server/routes/products.ts:68" },
  { method: "put", path: `/api/products/${ABSENT}`, body: {}, allow: [], where: "server/routes/products.ts:94" },
  { method: "patch", path: `/api/products/${ABSENT}/aliases`, body: { aliases: "not-an-array" }, allow: [], where: "server/routes/products.ts:122" },
  { method: "delete", path: `/api/products/${ABSENT}`, allow: [], where: "server/routes/products.ts:142" },
  { method: "post", path: "/api/customers", body: {}, allow: [], where: "server/routes/customers.ts:77" },
  { method: "put", path: `/api/customers/${ABSENT}`, body: {}, allow: [], where: "server/routes/customers.ts:89" },
  { method: "delete", path: `/api/customers/${ABSENT}`, allow: [], where: "server/routes/customers.ts:104" },
  { method: "post", path: "/api/promotions", body: {}, allow: [], where: "server/routes/promotions.ts:31" },
  { method: "patch", path: `/api/promotions/${ABSENT}`, body: {}, allow: [], where: "server/routes/promotions.ts:47" },
  { method: "delete", path: `/api/promotions/${ABSENT}`, allow: [], where: "server/routes/promotions.ts:64" },
  { method: "post", path: "/api/loyalty-tiers", body: {}, allow: [], where: "server/routes/loyalty.ts:90" },
  { method: "patch", path: `/api/loyalty-tiers/${ABSENT}`, body: {}, allow: [], where: "server/routes/loyalty.ts:106" },
  { method: "delete", path: `/api/loyalty-tiers/${ABSENT}`, allow: [], where: "server/routes/loyalty.ts:123" },
  { method: "post", path: "/api/overhead-expenses", body: {}, allow: [], where: "server/routes/expenses.ts:30" },
  { method: "put", path: `/api/overhead-expenses/${ABSENT}`, body: {}, allow: [], where: "server/routes/expenses.ts:46" },
  { method: "delete", path: `/api/overhead-expenses/${ABSENT}`, allow: [], where: "server/routes/expenses.ts:62" },
];

async function send(api: APIRequestContext, probe: Probe) {
  const options = probe.body === undefined ? undefined : { data: probe.body };
  switch (probe.method) {
    case "post":
      return api.post(probe.path, options);
    case "put":
      return api.put(probe.path, options);
    case "patch":
      return api.patch(probe.path, options);
    case "delete":
      return api.delete(probe.path, options);
  }
}

const label = (p: Probe) => `${p.method.toUpperCase()} ${p.path}`;

/** Statuses that count as a denial for this probe. */
const denials = (p: Probe) => p.deny ?? [403];

/**
 * Serial, and the only file in this directory that provisions inside org A.
 * The "nothing was written" assertions compare an org-wide database fingerprint
 * before and after each probe, which a second worker provisioning into the same
 * org would invalidate. Every other spec here works in its own throwaway org.
 */
test.describe.configure({ mode: "default" });

let orgAId: string;
let records: OrgRecords;
let bypassOn: boolean;

test.beforeAll(async () => {
  bypassOn = (await authMode()).devAuthBypass;
  orgAId = await resolveOrgAId();
  const admin = await apiAs("ADMIN", orgAId);
  records = await provisionOrgRecords(admin, orgAId);
  await admin.dispose();
});

test.afterAll(async () => {
  await destroyProvisioned();
});

test.describe("5.1 role enforcement on mutating routes", () => {
  test("CASHIER is refused every route whose requireRole excludes CASHIER", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    const cashier = await apiAs("CASHIER", orgAId);
    const before = await orgFingerprint(orgAId);

    const wrongStatus: string[] = [];
    const leaks: string[] = [];
    for (const probe of MANAGER_AND_UP) {
      const res = await send(cashier, probe);
      const body = await res.text();
      if (!denials(probe).includes(res.status())) {
        wrongStatus.push(
          `${label(probe)} → ${res.status()}, expected ${denials(probe).join("/")} ` +
            `(guard at ${probe.where}) ${body.slice(0, 160)}`,
        );
      }
      const leak = internalLeak(body);
      if (leak) leaks.push(`${label(probe)} leaked ${leak}`);
    }
    await cashier.dispose();

    expect(wrongStatus, "every one of these must answer 403 to a CASHIER").toEqual([]);
    expect(leaks, "a denial must not disclose internals").toEqual([]);
    // A 403 that still wrote is the dangerous case; prove nothing moved.
    expect(await orgFingerprint(orgAId), "no refused request may write").toEqual(before);
  });

  test("the same requests are NOT 403 for MANAGER — so the 403 above is the role gate", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    const manager = await apiAs("MANAGER", orgAId);
    const before = await orgFingerprint(orgAId);

    const stillForbidden: string[] = [];
    for (const probe of MANAGER_AND_UP) {
      const res = await send(manager, probe);
      if (res.status() === 403) {
        stillForbidden.push(`${label(probe)} → 403 for MANAGER (declared allow: ${probe.allow.join("/")}, guard at ${probe.where})`);
      }
    }
    await manager.dispose();

    expect(
      stillForbidden,
      "MANAGER is in the allow-list for these; a 403 here means the CASHIER 403 proved nothing",
    ).toEqual([]);
    // Each probe was shaped to fail validation or miss its id, so an authorised
    // caller must not have written either.
    expect(await orgFingerprint(orgAId), "authorised-but-invalid requests must not write").toEqual(
      before,
    );
  });

  test("MANAGER is refused the SUPER_ADMIN/ADMIN-only routes", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    const manager = await apiAs("MANAGER", orgAId);
    const before = await orgFingerprint(orgAId);

    const wrongStatus: string[] = [];
    for (const probe of ADMIN_ONLY) {
      const res = await send(manager, probe);
      if (!denials(probe).includes(res.status())) {
        wrongStatus.push(
          `${label(probe)} → ${res.status()}, expected ${denials(probe).join("/")} (guard at ${probe.where})`,
        );
      }
    }
    await manager.dispose();

    expect(wrongStatus, "these are declared SUPER_ADMIN/ADMIN only").toEqual([]);
    expect(await orgFingerprint(orgAId)).toEqual(before);
  });

  test("CASHIER is refused the SUPER_ADMIN/ADMIN-only routes", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    const cashier = await apiAs("CASHIER", orgAId);
    const before = await orgFingerprint(orgAId);

    const wrongStatus: string[] = [];
    for (const probe of ADMIN_ONLY) {
      const res = await send(cashier, probe);
      if (!denials(probe).includes(res.status())) {
        wrongStatus.push(
          `${label(probe)} → ${res.status()}, expected ${denials(probe).join("/")} (guard at ${probe.where})`,
        );
      }
    }
    await cashier.dispose();

    expect(wrongStatus).toEqual([]);
    expect(await orgFingerprint(orgAId)).toEqual(before);
  });

  test("PATCH /api/orgs/:id refuses a CASHIER via its in-handler role check", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    // No requireRole middleware here; the check lives inside the handler
    // (server/routes/auth.ts:170-179), so it is asserted separately.
    const cashier = await apiAs("CASHIER", orgAId);
    const before = await orgFingerprint(orgAId);
    const own = await cashier.patch(`/api/orgs/${orgAId}`, { data: { name: "renamed-by-cashier" } });
    const other = await cashier.patch(`/api/orgs/${ABSENT}`, { data: { name: "renamed-by-cashier" } });
    await cashier.dispose();
    expect(own.status(), "a CASHIER must not rename its own org").toBe(403);
    expect(other.status(), "nor any other org").toBe(403);
    expect(await orgFingerprint(orgAId), "the org name must be untouched").toEqual(before);
  });

  test("read-only routes a CASHIER should not see are also gated", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    const cashier = await apiAs("CASHIER", orgAId);
    const gatedReads = [
      { path: `/api/locations/${records.locationId}/stock`, where: "server/routes/locations.ts:79" },
      { path: "/api/webhooks", where: "server/routes/channels.ts:112" },
      { path: "/api/cashier-commission", where: "server/routes/cashiers.ts:323" },
    ];
    const wrongStatus: string[] = [];
    for (const r of gatedReads) {
      const res = await cashier.get(r.path);
      if (res.status() !== 403) wrongStatus.push(`GET ${r.path} → ${res.status()} (guard at ${r.where})`);
    }
    await cashier.dispose();
    expect(wrongStatus).toEqual([]);
  });

  test("GET /api/locations is readable by a CASHIER but carries no revenue stats", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    // A cashier cannot open a POS shift without picking a location
    // (client/src/pages/pos/shift-open.tsx), so the list itself is not gated —
    // only the admin payload's per-location revenue/order stats are
    // (server/routes/locations.ts:19).
    const cashier = await apiAs("CASHIER", orgAId);
    const res = await cashier.get("/api/locations");
    const body = res.ok() ? await res.json() : null;
    await cashier.dispose();

    expect(res.status(), "a CASHIER must be able to list locations").toBe(200);
    expect(Array.isArray(body), "the list must be an array").toBe(true);
    const withStats = (body as Array<Record<string, unknown>>).filter((l) => "stats" in l);
    expect(withStats, "a CASHIER must not receive per-location revenue stats").toEqual([]);
    for (const loc of body as Array<Record<string, unknown>>) {
      expect(Object.keys(loc).sort(), "only the picker fields are exposed").toEqual([
        "id",
        "isActive",
        "isDefault",
        "name",
      ]);
    }
  });
});

test.describe("5.1 characterisation — mutating routes with no role guard", () => {
  /**
   * FINDING, not a passing gate. Each route below is registered with
   * `scoped = [isAuthenticated, requireOrgContext, requireOrgScope]`
   * (server/routes.ts:62) and no `requireRole`, so a CASHIER reaches the
   * handler. The test pins that list; a change in either direction is worth a
   * human look.
   */
  test("the set of unguarded mutations a CASHIER can reach is unchanged", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    const cashier = await apiAs("CASHIER", orgAId);
    const reachable: string[] = [];
    const refused: string[] = [];
    for (const probe of UNGUARDED_MUTATIONS) {
      const res = await send(cashier, probe);
      if (res.status() === 403) refused.push(`${label(probe)} (${probe.where})`);
      else reachable.push(`${label(probe)} → ${res.status()} (${probe.where})`);
    }
    await cashier.dispose();

    // Pinned expectation: none of these are role-guarded today.
    expect(
      refused,
      "a route here has gained a role guard — good news; move it into MANAGER_AND_UP or ADMIN_ONLY",
    ).toEqual([]);
    expect(reachable.length, "every unguarded route must still be reachable by CASHIER").toBe(
      UNGUARDED_MUTATIONS.length,
    );
    console.log(
      `[5.1 FINDING] ${reachable.length} mutating routes have no role guard; a CASHIER reaches the handler:\n  ` +
        reachable.join("\n  "),
    );
  });

  test("a CASHIER can really delete a product — the unguarded case, proven end to end", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    // The characterisation test above only reads status codes against absent
    // ids. This one uses a real product, so the finding is a demonstrated
    // deletion rather than an inference from a 404.
    const admin = await apiAs("ADMIN", orgAId);
    const created = await admin.post("/api/products", {
      data: {
        name: `ZZ-SEC cashier-delete probe`,
        productId: `ZZSEC-DEL-${Date.now()}`,
        productCode: `ZZSEC-DEL-${Date.now()}`,
        locationId: records.locationId,
        defaultSalePrice: "1.00",
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const product = (await created.json()) as { id: string };

    const cashier = await apiAs("CASHIER", orgAId);
    const del = await cashier.delete(`/api/products/${product.id}`);
    const after = await admin.get(`/api/products/${product.id}`);
    await cashier.dispose();
    await admin.dispose();

    console.log(
      `[5.1 FINDING] DELETE /api/products/:id as CASHIER → ${del.status()}; ` +
        `follow-up GET → ${after.status()} (no requireRole at server/routes/products.ts:142)`,
    );
    expect(del.status(), "characterised: no role guard, so the delete succeeds").toBe(200);
    expect(after.status(), "and the product is really gone").toBe(404);
  });
});

test.describe("5.1 the bypass itself", () => {
  test("with DEV_AUTH_BYPASS=1 the role gate is open — recorded, not asserted away", async () => {
    test.skip(!bypassOn, "only meaningful on a bypass-enabled server");
    // playwright.config.ts sets DEV_AUTH_BYPASS=1 for its managed webServer, and
    // requireRole() returns next() unconditionally in that mode. Anything in
    // this file that expected a 403 would pass for the wrong reason, so it is
    // recorded here explicitly instead.
    const cashier = await apiAs("CASHIER", orgAId);
    const res = await cashier.post("/api/suppliers", { data: {} });
    await cashier.dispose();
    console.log(
      `[5.1 CONFIG] DEV_AUTH_BYPASS=1: POST /api/suppliers as CASHIER → ${res.status()} ` +
        `(403 impossible; requireRole short-circuits at server/auth/commonAuth.ts:94)`,
    );
    expect(
      res.status(),
      "bypass mode must reach the handler (400 from validation), not the role gate",
    ).not.toBe(403);
  });
});
