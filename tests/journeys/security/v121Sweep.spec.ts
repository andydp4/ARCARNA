/**
 * v1.2.1 sec sweep — failing repros found by attacking a gates-on server with
 * two real organisations. Each test states the behaviour the fix must produce;
 * on the v1.2 code (d31d2e0) they FAIL. Findings live in the sec bot's report;
 * the ids (SEC-…) match it.
 *
 * Run gates-on (see roleEnforcement.spec.ts for the full command):
 *   PHASE2D_TEST=1 PHASE2D_TEST_SECRET=journey-suite-local-secret DEV_AUTH_BYPASS=0 \
 *   APP_BASE_PATH=/ VITE_BASE_PATH=/ PORT=$PORT npx tsx server/index.ts &
 *   PORT=$PORT PLAYWRIGHT_BASE_URL=http://127.0.0.1:$PORT \
 *     npx playwright test --project=journeys --workers=1 tests/journeys/security/v121Sweep.spec.ts
 *
 * Tests that depend on the role gate skip themselves on a bypass-on server,
 * like the rest of this directory. The others hold in both modes.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { allowedUsers, locations, opsStaff, orderItems, products, userApprovalRequests } from "@shared/schema";
import { apiAs } from "../fixtures";
import {
  authMode,
  createOrgB,
  destroyProvisioned,
  provisionOrgRecords,
  resolveOrgAId,
  SEC_PREFIX,
  type OrgRecords,
} from "./tenants";

test.describe.configure({ mode: "default" });

let orgAId: string;
let orgBId: string;
let b: OrgRecords;
let bApi: APIRequestContext;
let bypassOn: boolean;
let aLocationId: string;
let aProductId: string;
let startedAt: Date;

test.beforeAll(async () => {
  startedAt = new Date(Date.now() - 1000);
  bypassOn = (await authMode()).devAuthBypass;
  orgAId = await resolveOrgAId();
  const created = await createOrgB();
  orgBId = created.orgId;
  bApi = created.api;
  b = await provisionOrgRecords(bApi, orgBId);

  const [loc] = await db.select({ id: locations.id }).from(locations).where(eq(locations.orgId, orgAId)).limit(1);
  const [prod] = await db.select({ id: products.id }).from(products).where(eq(products.orgId, orgAId)).limit(1);
  if (!loc || !prod) throw new Error("seeded org A needs a location and a product");
  aLocationId = loc.id;
  aProductId = prod.id;

  // The till refuses a sale without an open shift; open one if there is none.
  const cashier = await apiAs("CASHIER");
  await cashier.post("/api/shifts/open", { data: { locationId: aLocationId, openingFloat: 0 } });
  await cashier.dispose();
});

test.afterAll(async () => {
  // Any org-A order line this file managed to write against org B's product
  // must go before destroyProvisioned deletes that product.
  await db.execute(sql`DELETE FROM order_items WHERE product_id = ${b.productId}::uuid AND org_id = ${orgAId}::uuid`);
  await bApi.dispose();
  await destroyProvisioned();
});

async function orgALinesOnBProduct(): Promise<number> {
  const rows = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(and(eq(orderItems.productId, b.productId), eq(orderItems.orgId, orgAId), gte(orderItems.createdAt, startedAt)));
  return rows.length;
}

// ---------------------------------------------------------------------------
// SEC-ORDER-XPROD: POST /api/orders and PUT /api/orders/:id accept another
// tenant's productId. The org-A order is written with org B's product, its
// list/floor price and unit cost (4.44 in the live repro), and org B's product
// name then shows on org A's order, board, receipts, Would-have-flagged and
// Evidence ("B Widget"). Root cause: packages/domain/src/engine.ts
// products.findById / snapshotLines are not org-scoped.
// ---------------------------------------------------------------------------
test.describe("SEC-ORDER-XPROD: order lines are tenant-scoped", () => {
  test("a sale cannot be rung up with another organisation's product", async () => {
    const cashier = await apiAs("CASHIER");
    const res = await cashier.post("/api/orders", {
      headers: { "x-location-id": aLocationId },
      data: {
        lines: [{ productId: b.productId, quantity: 1, unitPrice: 1 }],
        paymentMethod: "cash",
      },
    });
    const body = await res.text();
    await cashier.dispose();
    expect(res.status(), `expected a 4xx, got ${res.status()}: ${body.slice(0, 200)}`).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
    const [bProduct] = await db.select({ name: products.name }).from(products).where(eq(products.id, b.productId));
    expect(body, "org B's product name must not be echoed to org A").not.toContain(bProduct?.name ?? "\u0000");
    expect(await orgALinesOnBProduct()).toBe(0);
  });

  test("an order edit cannot swap in another organisation's product", async () => {
    test.skip(bypassOn, "order edits are MANAGER+; the gate is open under DEV_AUTH_BYPASS");
    const cashier = await apiAs("CASHIER");
    const placed = await cashier.post("/api/orders", {
      headers: { "x-location-id": aLocationId },
      data: { lines: [{ productId: aProductId, quantity: 1, unitPrice: 1 }], paymentMethod: "cash" },
    });
    const placedText = await placed.text();
    await cashier.dispose();
    expect(placed.status(), placedText).toBe(201);
    const { orderId } = JSON.parse(placedText) as { orderId: string };

    const manager = await apiAs("MANAGER");
    const preview = await manager.post(`/api/orders/${orderId}/edit-preview`, {
      data: { lines: [{ productId: b.productId, quantity: 1, unitPrice: 9.99 }] },
    });
    const edit = await manager.put(`/api/orders/${orderId}`, {
      data: { lines: [{ productId: b.productId, quantity: 1, unitPrice: 9.99 }], reason: `${SEC_PREFIX} cross-tenant edit` },
    });
    const editText = await edit.text();
    await manager.dispose();
    expect(preview.status(), "edit-preview must refuse a foreign product").toBeGreaterThanOrEqual(400);
    expect(edit.status(), `edit must refuse a foreign product: ${editText.slice(0, 200)}`).toBeGreaterThanOrEqual(400);
    expect(await orgALinesOnBProduct()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SEC-XSS-PREVIEW: GET /api/receipts/preview?template=<html> renders the
// caller-supplied template as text/html on the app's own origin, for any
// signed-in role. A link to it runs script with the victim's session (Lax
// cookies ride a top-level GET) and there is no CSP. Reflected XSS.
// ---------------------------------------------------------------------------
test("SEC-XSS-PREVIEW: the receipt preview never renders caller-supplied markup", async () => {
  const marker = `sec${randomUUID().slice(0, 8)}`;
  const cashier = await apiAs("CASHIER");
  const res = await cashier.get("/api/receipts/preview", {
    params: { template: `<html><body><script>window.${marker}=1</script><img src=x onerror="${marker}()"></body></html>` },
  });
  const body = await res.text();
  const type = res.headers()["content-type"] ?? "";
  await cashier.dispose();
  const executable = type.includes("text/html") && (body.includes(`<script>window.${marker}`) || body.includes(`onerror="${marker}`));
  expect(executable, `preview reflected live markup (status ${res.status()}, ${type})`).toBe(false);
});

// ---------------------------------------------------------------------------
// SEC-APPROVE-XORG: POST /api/admin/approve/:id never checks that the target
// is unclaimed or in the actor's org. storage.approveUser upserts
// allowed_users from any approval-request row (pending OR already approved),
// so an org-A admin moves an org-B member into org A with a role of their
// choosing (live repro: secb-manager MANAGER@B → CASHIER@A). The same path
// sets isOwner=0 on an owner who has a request row.
// ---------------------------------------------------------------------------
test.describe("SEC-APPROVE-XORG: approving is scoped to unclaimed requests", () => {
  let bMemberId: string;

  test.beforeAll(async () => {
    bMemberId = `${SEC_PREFIX}-bmember-${randomUUID().slice(0, 8)}`;
    await db.insert(allowedUsers).values({
      replitUserId: bMemberId,
      authProvider: "replit",
      email: `${bMemberId.toLowerCase()}@example.invalid`,
      name: `${SEC_PREFIX} B Member`,
      isOwner: 0,
      orgId: orgBId,
      role: "MANAGER",
    });
    // They joined through the normal flow, so their request row is "approved".
    await db.insert(userApprovalRequests).values({
      replitUserId: bMemberId,
      authProvider: "replit",
      email: `${bMemberId.toLowerCase()}@example.invalid`,
      name: `${SEC_PREFIX} B Member`,
      status: "approved",
    });
  });

  test.afterAll(async () => {
    await db.delete(userApprovalRequests).where(eq(userApprovalRequests.replitUserId, bMemberId)).catch(() => {});
    await db.delete(allowedUsers).where(eq(allowedUsers.replitUserId, bMemberId)).catch(() => {});
  });

  test("an org-A admin cannot pull an org-B member into org A by approving them", async () => {
    test.skip(bypassOn, "admin routes are ungated under DEV_AUTH_BYPASS");
    const adminA = await apiAs("ADMIN");
    const res = await adminA.post(`/api/admin/approve/${bMemberId}`, { data: { role: "CASHIER" } });
    await adminA.dispose();
    const [row] = await db.select().from(allowedUsers).where(eq(allowedUsers.replitUserId, bMemberId));
    expect(row?.orgId, "the member must still belong to org B").toBe(orgBId);
    expect(row?.role).toBe("MANAGER");
    expect([400, 403, 404, 409]).toContain(res.status());
  });

  test("an org-A admin cannot reject an org-B member's request", async () => {
    test.skip(bypassOn, "admin routes are ungated under DEV_AUTH_BYPASS");
    const adminA = await apiAs("ADMIN");
    const res = await adminA.post(`/api/admin/reject/${bMemberId}`);
    await adminA.dispose();
    const [req] = await db.select().from(userApprovalRequests).where(eq(userApprovalRequests.replitUserId, bMemberId));
    expect(req?.status).toBe("approved");
    expect([400, 403, 404, 409]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// SEC-STATION-XORG: PATCH /api/operations/station/:userId writes an ops_staff
// row in the actor's org for ANY user id, including another org's staff.
// ---------------------------------------------------------------------------
test("SEC-STATION-XORG: a station can only be set for someone in your own organisation", async () => {
  test.skip(bypassOn, "MANAGER+ route; gate open under DEV_AUTH_BYPASS");
  const foreignUser = `${SEC_PREFIX}-bstaff-${randomUUID().slice(0, 8)}`;
  await db.insert(allowedUsers).values({
    replitUserId: foreignUser,
    authProvider: "replit",
    email: `${foreignUser.toLowerCase()}@example.invalid`,
    name: `${SEC_PREFIX} B Staff`,
    isOwner: 0,
    orgId: orgBId,
    role: "CASHIER",
  });
  try {
    const manager = await apiAs("MANAGER");
    const res = await manager.patch(`/api/operations/station/${foreignUser}`, { data: { station: "delivery" } });
    await manager.dispose();
    const rows = await db.select().from(opsStaff).where(and(eq(opsStaff.userId, foreignUser), eq(opsStaff.orgId, orgAId)));
    expect(rows.length, "no org-A ops_staff row for an org-B user").toBe(0);
    expect([400, 403, 404]).toContain(res.status());
  } finally {
    await db.delete(opsStaff).where(eq(opsStaff.userId, foreignUser)).catch(() => {});
    await db.delete(allowedUsers).where(eq(allowedUsers.replitUserId, foreignUser)).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// SEC-CSRF-FORM: every /api mutation also parses
// application/x-www-form-urlencoded (server/index.ts express.urlencoded) and
// nothing checks Origin. An HTML form on another site can POST to the API; the
// only thing stopping it is the browser's SameSite=Lax on the session cookie,
// which a same-site sibling (another *.viger.cloud host) does not trip.
// ---------------------------------------------------------------------------
test("SEC-CSRF-FORM: a cross-site form post cannot create a customer", async () => {
  const name = `${SEC_PREFIX} CSRF ${randomUUID().slice(0, 8)}`;
  const admin = await apiAs("ADMIN");
  const res = await admin.post("/api/customers", {
    headers: { origin: "https://evil.example.invalid", "content-type": "application/x-www-form-urlencoded" },
    data: `name=${encodeURIComponent(name)}`,
  });
  await admin.dispose();
  const created = await db.execute(sql`SELECT id FROM customers WHERE name = ${name}`);
  const rows = (created as unknown as { rows?: unknown[] }).rows ?? (created as unknown as unknown[]);
  await db.execute(sql`DELETE FROM customers WHERE name = ${name}`);
  expect(rows.length, `a form-encoded cross-origin POST created a customer (status ${res.status()})`).toBe(0);
});
