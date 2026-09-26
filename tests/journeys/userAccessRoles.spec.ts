/**
 * v1.2.1 e2e — changing someone's role in Settings › User Access.
 *
 * The owner's real task: "cashier 02" was set up as a manager by mistake and
 * has to become a cashier. This walks that through the screen at desktop and
 * phone width, then attacks the same endpoints the screen uses from every
 * angle a user could reach: a manager promoting, an admin touching the owner,
 * an admin of one business reaching into another, and a demoted person's tab
 * that is still open.
 *
 * Every person here is created by this file (fictional names, @example.invalid
 * emails) and removed again afterwards. The second business is a direct insert,
 * the same way `security/tenants.ts` makes one, because creating an org through
 * the API needs a real Clerk session with MFA.
 *
 * Run against a server with DEV_AUTH_BYPASS off to see the role gates too (see
 * `security/roleEnforcement.spec.ts` for the command); the assertions that only
 * mean something with the gates on skip themselves otherwise.
 */
import { inArray, sql } from "drizzle-orm";
import {
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { db } from "../../server/db";
import { allowedUsers, organizations, userApprovalRequests } from "@shared/schema";
import { LATEST_WHATS_NEW_VERSION } from "../../shared/whatsNew";
import { LATEST_OPS_TOUR_VERSION, opsTourSeenKey } from "../../shared/opsTour";
import { CENTRE_TOUR_CENTRES, FEATURE_TOURS, centreTourLocalKey, featureTourLocalKey } from "../../shared/uiSeen";
import { expect, pageAs, test, uniqueSuffix } from "./fixtures";
import { authMode } from "./security/tenants";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 5000}`;
const TEST_SECRET = process.env.PHASE2D_TEST_SECRET ?? "journey-suite-local-secret";

function headersFor(userId: string, orgId?: string): Record<string, string> {
  return {
    "x-test-replit-user-id": userId,
    "x-test-secret": TEST_SECRET,
    ...(orgId ? { "x-org-id": orgId } : {}),
  };
}

async function apiAsUser(userId: string, orgId?: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: headersFor(userId, orgId) });
}

/** `pageAs` for a person who is not one of the four seeded roles. */
async function pageAsUser(browser: Browser, userId: string, orgId: string, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: headersFor(userId, orgId), ...(viewport ? { viewport } : {}) });
  await context.addInitScript((id) => window.localStorage.setItem("arcarna.selectedOrgId", id), orgId);
  await context.addInitScript((v) => window.localStorage.setItem(`whatsNew:seen:${v}`, "1"), LATEST_WHATS_NEW_VERSION);
  await context.addInitScript((k) => window.localStorage.setItem(k, "1"), opsTourSeenKey(LATEST_OPS_TOUR_VERSION));
  await context.addInitScript(
    (keys) => {
      for (const key of keys) localStorage.setItem(key, "1");
    },
    [...CENTRE_TOUR_CENTRES.map((c) => centreTourLocalKey(c)), ...FEATURE_TOURS.map((f) => featureTourLocalKey(f))],
  );
  return context.newPage();
}

type Person = { id: string; name: string; role: "ADMIN" | "MANAGER" | "CASHIER" | "SUPER_ADMIN"; orgId: string | null };

const made = { users: [] as string[], orgs: [] as string[] };

async function addPerson(p: Person): Promise<Person> {
  await db.insert(allowedUsers).values({
    replitUserId: p.id,
    authUserId: p.id,
    authProvider: "replit",
    name: p.name,
    email: `${p.id}@example.invalid`,
    role: p.role,
    orgId: p.orgId,
    isOwner: 0,
  });
  made.users.push(p.id);
  return p;
}

async function roleOf(id: string): Promise<{ role: string | null; orgId: string | null } | null> {
  const rows = await db.execute(sql`SELECT role::text AS role, org_id::text AS org_id FROM allowed_users WHERE replit_user_id = ${id}`);
  const row = (rows as any).rows?.[0] ?? (rows as any)[0];
  return row ? { role: row.role, orgId: row.org_id } : null;
}

async function makeOrgB(): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({ name: `ZZ-E2E-ROLES-B ${uniqueSuffix()}`, setupComplete: 1 })
    .returning();
  made.orgs.push(org.id);
  return org.id;
}

test.afterAll(async () => {
  if (made.users.length) {
    await db.delete(userApprovalRequests).where(inArray(userApprovalRequests.replitUserId, made.users));
    await db.delete(allowedUsers).where(inArray(allowedUsers.replitUserId, made.users));
  }
  for (const id of made.orgs) {
    await db.execute(sql`DELETE FROM organizations WHERE id = ${id}::uuid`).catch(() => undefined);
  }
});

async function demoteThroughScreen(page: Page, target: Person) {
  await page.goto("/user-access");
  await page.getByTestId("tab-allowed").click();
  const trigger = page.getByTestId(`role-select-${target.id}`);
  await expect(trigger, "cashier 02's row must show a role picker").toBeVisible({ timeout: 60_000 });
  await expect(trigger).toContainText("MANAGER");
  const box = await trigger.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box, "the role picker must be laid out").not.toBeNull();
  // On a phone the table scrolls inside its card, but the picker must still be
  // reachable: scrolled into view it has to sit on screen.
  await trigger.scrollIntoViewIfNeeded();
  const inView = await trigger.boundingBox();
  expect(inView!.x, "role picker must be on screen once scrolled to").toBeGreaterThanOrEqual(0);
  expect(inView!.x + inView!.width, "role picker must be on screen once scrolled to").toBeLessThanOrEqual(vw + 1);
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/admin/allowed-users/${target.id}`) && r.request().method() === "PATCH",
  );
  await trigger.click();
  await page.getByRole("option", { name: "CASHIER", exact: true }).click();
  const res = await saved;
  expect(res.status(), await res.text()).toBe(200);
  await expect(page.getByText("Role updated").first()).toBeVisible();
  await expect(trigger).toContainText("CASHIER");
}

for (const [label, viewport] of [
  ["desktop 1440×900", { width: 1440, height: 900 }],
  ["phone 412×915", { width: 412, height: 915 }],
] as const) {
  test.describe(`User Access: demote cashier 02 — ${label}`, () => {
    test.use({ viewport });

    test("the owner demotes cashier 02 from manager to cashier; it takes effect at once and is audited", async ({ browser, orgId }) => {
      const target = await addPerson({ id: `e2e-c02-${uniqueSuffix()}`, name: "cashier 02", role: "MANAGER", orgId });
      const asTarget = await apiAsUser(target.id, orgId);
      const before = await (await asTarget.get("/api/auth/user")).json();
      expect(before.role).toBe("MANAGER");

      const page = await pageAs(browser, "ADMIN", orgId);
      await page.setViewportSize(viewport);
      await demoteThroughScreen(page, target);
      await page.context().close();

      // Straight away: the very next request as cashier 02 is a cashier.
      const after = await (await asTarget.get("/api/auth/user")).json();
      expect(after.role, "the demotion must apply to cashier 02's next request").toBe("CASHIER");
      expect((await roleOf(target.id))?.role).toBe("CASHIER");

      const mode = await authMode();
      if (!mode.devAuthBypass) {
        // A manager-only screen's data is now refused, with no stale session.
        const users = await asTarget.get("/api/admin/allowed-users");
        expect(users.status()).toBe(403);
        const needsALook = await asTarget.get("/api/needs-a-look");
        expect(needsALook.status(), "a manager-only read must be refused once demoted").toBe(403);
      }
      await asTarget.dispose();

      // Audited — and the entry says what changed, not just the new value: a
      // demotion and a promotion to the same role must read differently.
      const rows = await db.execute(
        sql`SELECT actor_user_id, action, metadata FROM admin_audit_logs WHERE target_id = ${target.id} ORDER BY created_at DESC`,
      );
      const audit = ((rows as any).rows ?? rows) as Array<{ actor_user_id: string; action: string; metadata: any }>;
      const entry = audit.find((r) => r.action === "access.update_allowed_user");
      expect(entry, "the role change must write an audit entry").toBeTruthy();
      expect(entry!.actor_user_id).toBe("seed-admin");
      expect(entry!.metadata?.role).toBe("CASHIER");
      expect(
        entry!.metadata?.previousRole ?? entry!.metadata?.fromRole ?? null,
        "the audit entry must record the role it changed FROM (MANAGER), or a demotion cannot be told from a promotion",
      ).toBe("MANAGER");
    });
  });
}

test.describe("User Access: role changes that must be refused", () => {
  test("a manager cannot promote anyone, themselves included", async ({ orgId }) => {
    const cashier = await addPerson({ id: `e2e-cash-${uniqueSuffix()}`, name: "Promo Target", role: "CASHIER", orgId });
    const manager = await addPerson({ id: `e2e-mgr-${uniqueSuffix()}`, name: "Pushy Manager", role: "MANAGER", orgId });
    const asManager = await apiAsUser(manager.id, orgId);
    for (const [who, role] of [
      [cashier.id, "ADMIN"],
      [cashier.id, "MANAGER"],
      [manager.id, "ADMIN"],
    ] as const) {
      const res = await asManager.patch(`/api/admin/allowed-users/${who}`, { data: { role } });
      expect(res.status(), `manager → ${who} as ${role}: ${await res.text()}`).toBe(403);
    }
    await asManager.dispose();
    expect((await roleOf(cashier.id))?.role).toBe("CASHIER");
    expect((await roleOf(manager.id))?.role).toBe("MANAGER");
  });

  test("an admin cannot demote the owner, change their own role, or make a super admin", async ({ api }) => {
    const owner = await api.patch("/api/admin/allowed-users/seed-super-admin", { data: { role: "CASHIER" } });
    expect(owner.status(), await owner.text()).toBeGreaterThanOrEqual(400);
    expect((await roleOf("seed-super-admin"))?.role).toBe("SUPER_ADMIN");

    const self = await api.patch("/api/admin/allowed-users/seed-admin", { data: { role: "CASHIER" } });
    expect(self.status()).toBeGreaterThanOrEqual(400);
    expect((await roleOf("seed-admin"))?.role).toBe("ADMIN");

    const sa = await api.patch("/api/admin/allowed-users/seed-cashier", { data: { role: "SUPER_ADMIN" } });
    expect(sa.status()).toBe(403);
    expect((await roleOf("seed-cashier"))?.role).toBe("CASHIER");
  });

  test("an admin cannot remove a super admin's access", async ({ api }) => {
    // Not the owner (that one is protected by name) — any other platform
    // super admin. An org admin cannot change their role (canManageUser), so
    // removing them outright must not be the way round it.
    const sa = await addPerson({ id: `e2e-sa-${uniqueSuffix()}`, name: "Platform Helper", role: "SUPER_ADMIN", orgId: null });
    const res = await api.delete(`/api/admin/allowed-users/${sa.id}`);
    expect(res.status(), `an org admin removed a super admin: ${await res.text()}`).toBeGreaterThanOrEqual(400);
    expect(await roleOf(sa.id), "the super admin must still have access").not.toBeNull();
  });
});

test.describe("User Access: one business cannot touch another's people", () => {
  test("an admin of business A cannot remove a user of business B", async ({ api }) => {
    const orgB = await makeOrgB();
    const bCashier = await addPerson({ id: `e2e-bcash-${uniqueSuffix()}`, name: "B Till", role: "CASHIER", orgId: orgB });
    const res = await api.delete(`/api/admin/allowed-users/${bCashier.id}`);
    expect(res.status(), `business A's admin removed business B's cashier: ${await res.text()}`).toBeGreaterThanOrEqual(400);
    expect(await roleOf(bCashier.id), "business B's cashier must still have access").not.toBeNull();
  });

  test("an admin of business A cannot 'approve' business B's admin into business A", async ({ api, orgId }) => {
    const orgB = await makeOrgB();
    const bAdmin = await addPerson({ id: `e2e-badmin-${uniqueSuffix()}`, name: "B Owner", role: "ADMIN", orgId: orgB });
    // Everyone who joined through sign-up has an approval row that stays
    // behind, marked approved, after they are let in.
    await db.insert(userApprovalRequests).values({
      replitUserId: bAdmin.id,
      authUserId: bAdmin.id,
      authProvider: "replit",
      email: `${bAdmin.id}@example.invalid`,
      name: bAdmin.name,
      status: "approved",
    });
    const res = await api.post(`/api/admin/approve/${bAdmin.id}`, { data: { role: "CASHIER" } });
    const now = await roleOf(bAdmin.id);
    expect(
      { status: res.status(), orgId: now?.orgId, role: now?.role },
      "business B's admin must stay business B's admin",
    ).toEqual({ status: expect.any(Number), orgId: orgB, role: "ADMIN" });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    void orgId;
  });

  test("an admin of business A does not see business B's pending sign-ups", async ({ api }) => {
    const pendingId = `e2e-pend-${uniqueSuffix()}`;
    made.users.push(pendingId);
    await db.insert(userApprovalRequests).values({
      replitUserId: pendingId,
      authUserId: pendingId,
      authProvider: "replit",
      email: `${pendingId}@example.invalid`,
      name: "Somebody Else's Hire",
      status: "pending",
    });
    // A pending sign-up has no business yet, so the list is platform-wide.
    // Every org admin on the platform reads every stranger's name and email.
    const res = await api.get("/api/admin/pending-approvals");
    expect(res.ok()).toBeTruthy();
    const rows = (await res.json()) as Array<{ replitUserId: string }>;
    expect(
      rows.some((r) => r.replitUserId === pendingId),
      "an org admin must not list sign-ups that are not theirs (name + email of anyone signing up anywhere)",
    ).toBe(false);
  });
});

test.describe("User Access: a demoted person's open tab", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("an already-open manager tab stops showing manager screens after demotion", async ({ browser, api, orgId }) => {
    const target = await addPerson({ id: `e2e-stale-${uniqueSuffix()}`, name: "cashier 02 (tab)", role: "MANAGER", orgId });
    const page = await pageAsUser(browser, target.id, orgId);
    await page.goto("/");
    const productsLink = page.locator('a[href$="/products"]').first();
    await expect(productsLink, "a manager sees Products in the menu").toBeAttached({ timeout: 60_000 });

    const res = await api.patch(`/api/admin/allowed-users/${target.id}`, { data: { role: "CASHIER" } });
    expect(res.status()).toBe(200);

    // The tab stays open; they carry on and move to another screen (no reload).
    await page.evaluate(() => {
      window.history.pushState({}, "", `${location.pathname.replace(/\/$/, "")}/products`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(1500);
    await expect(
      page.getByTestId("alert-no-role-access"),
      "a cashier on the Products screen must get the no-access state, not the manager's page from a stale session",
    ).toBeVisible({ timeout: 10_000 });
    await page.context().close();
  });
});
