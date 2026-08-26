/**
 * Checkpoint 5.6 — the org-scope override cannot be forged by a client.
 *
 * `requireOrgContext` (server/auth/commonAuth.ts:117-151) resolves the org for
 * a request like this:
 *
 *     let orgId = role === "SUPER_ADMIN" ? headerOrg || queryOrg || null : userOrgId;
 *
 * so `x-org-id` and `?orgId=` are honoured *only* for SUPER_ADMIN, and everyone
 * else is pinned to the org recorded against their user. That reads correctly.
 * Reading correctly is not evidence, so this file sends the headers for real.
 *
 * Every test here carries a positive control: the same header, sent by a
 * SUPER_ADMIN, must genuinely switch org. Without that control a test could
 * pass simply because the header is ignored everywhere — including where it is
 * supposed to work — which would prove nothing about the check.
 *
 * Run the security directory with `--workers=1`: this file and
 * roleEnforcement.spec.ts both write transiently into the seeded org, and their
 * before/after database fingerprints must not interleave.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { db } from "../../../server/db";
import { shifts } from "@shared/schema";
import { apiAs, type Role } from "../fixtures";
import {
  apiWithHeaders,
  authMode,
  createOrgB,
  destroyProvisioned,
  leakedValues,
  orgFingerprint,
  provisionOrgRecords,
  resolveOrgAId,
  type OrgRecords,
} from "./tenants";

test.describe.configure({ mode: "default" });

let orgAId: string;
let orgBId: string;
let b: OrgRecords;
let bApi: APIRequestContext;

test.beforeAll(async () => {
  await authMode();
  orgAId = await resolveOrgAId();
  const created = await createOrgB();
  orgBId = created.orgId;
  bApi = created.api;
  b = await provisionOrgRecords(bApi, orgBId);
});

test.afterAll(async () => {
  await bApi.dispose();
  await destroyProvisioned();
});

/** Org-B values that must never be reachable through a forged scope. */
function bSecrets(): string[] {
  return [b.locationId, b.productId, b.supplierId, b.purchaseDraftId, b.customerId, b.giftCardId];
}

/** Collections whose contents differ per org, so a scope switch is visible. */
const SCOPED_LISTS = [
  "/api/products",
  "/api/suppliers",
  "/api/purchase-drafts",
  "/api/customers",
  "/api/goods-receipts",
  "/api/inventory/transfers",
  "/api/product-suppliers",
];

test.describe("5.6 forged org scope", () => {
  for (const role of ["ADMIN", "MANAGER", "CASHIER"] as Role[]) {
    test(`x-org-id pointing at org B is ignored for ${role} of org A`, async () => {
      const forged = await apiWithHeaders(role, { "x-org-id": orgBId });
      const leaks: string[] = [];
      const reached: string[] = [];
      for (const path of SCOPED_LISTS) {
        const res = await forged.get(path);
        if (!res.ok()) continue; // role-gated lists are covered by 5.1
        reached.push(path);
        const body = await res.text();
        const found = leakedValues(body, bSecrets());
        if (found.length) leaks.push(`GET ${path} with x-org-id: ${orgBId} leaked ${found.join(", ")}`);
      }
      await forged.dispose();
      expect(reached.length, "no list was reachable — the assertion would be vacuous").toBeGreaterThan(0);
      expect(leaks, "the forged x-org-id header switched tenant").toEqual([]);
    });

    test(`?orgId= pointing at org B is ignored for ${role} of org A`, async () => {
      const api = await apiAs(role, orgAId);
      const leaks: string[] = [];
      let reached = 0;
      for (const path of SCOPED_LISTS) {
        const res = await api.get(`${path}?orgId=${orgBId}`);
        if (!res.ok()) continue;
        reached += 1;
        const body = await res.text();
        const found = leakedValues(body, bSecrets());
        if (found.length) leaks.push(`GET ${path}?orgId=${orgBId} leaked ${found.join(", ")}`);
      }
      await api.dispose();
      expect(reached, "no list was reachable — the assertion would be vacuous").toBeGreaterThan(0);
      expect(leaks, "the forged orgId query parameter switched tenant").toEqual([]);
    });
  }

  test("header and query together, and a bogus org id, still resolve to org A", async () => {
    const combos: Record<string, string>[] = [
      { "x-org-id": orgBId },
      { "x-org-id": "00000000-0000-4000-8000-000000000000" },
      { "x-org-id": "not-a-uuid" },
      { "x-org-id": `${orgAId},${orgBId}` },
      { "x-org-id": orgBId, "x-location-id": b.locationId },
    ];
    const failures: string[] = [];
    for (const headers of combos) {
      const forged = await apiWithHeaders("ADMIN", headers);
      const res = await forged.get(`/api/suppliers?orgId=${orgBId}`);
      const body = await res.text();
      if (!res.ok()) {
        failures.push(`headers ${JSON.stringify(headers)} → ${res.status()} ${body.slice(0, 120)}`);
      } else {
        const found = leakedValues(body, bSecrets());
        if (found.length) failures.push(`headers ${JSON.stringify(headers)} leaked ${found.join(", ")}`);
      }
      await forged.dispose();
    }
    expect(failures, "a header/param combination escaped org A").toEqual([]);
  });

  test("POSITIVE CONTROL — the same x-org-id genuinely switches org for SUPER_ADMIN", async () => {
    // Without this, every assertion above could pass because the header is
    // simply never read. Here it must be read, and must work.
    const su = await apiWithHeaders("SUPER_ADMIN", { "x-org-id": orgBId });
    const res = await su.get("/api/suppliers");
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.text();
    expect(
      leakedValues(body, [b.supplierId]),
      "SUPER_ADMIN with x-org-id must see org B — otherwise the header is inert and the negative tests prove nothing",
    ).toEqual([b.supplierId]);
    await su.dispose();

    // And the query-parameter form of the same override.
    const suQuery = await apiAs("SUPER_ADMIN");
    const viaQuery = await suQuery.get(`/api/suppliers?orgId=${orgBId}`);
    expect(viaQuery.ok()).toBeTruthy();
    expect(leakedValues(await viaQuery.text(), [b.supplierId])).toEqual([b.supplierId]);
    await suQuery.dispose();
  });

  test("a write sent with a forged x-org-id lands in org A, never in org B", async () => {
    const beforeB = await orgFingerprint(orgBId);
    const forged = await apiWithHeaders("ADMIN", { "x-org-id": orgBId });
    const name = `ZZ-SEC forged-scope probe ${Date.now()}`;
    const created = await forged.post(`/api/suppliers?orgId=${orgBId}`, { data: { name } });
    expect(created.status(), await created.text()).toBe(201);
    const supplier = (await created.json()) as { id: string; orgId: string };
    await forged.dispose();

    expect(supplier.orgId, "the new supplier must belong to the caller's own org").toBe(orgAId);
    expect(await orgFingerprint(orgBId), "org B must be untouched by the forged write").toEqual(
      beforeB,
    );

    // Org B's own admin must not be able to see it either.
    const inB = await bApi.get("/api/suppliers");
    expect(leakedValues(await inB.text(), [supplier.id])).toEqual([]);

    // Clean up: the row is real and belongs to the seeded org.
    const admin = await apiAs("ADMIN", orgAId);
    const removed = await admin.delete(`/api/suppliers/${supplier.id}`);
    expect(removed.ok(), "probe supplier should be removable").toBeTruthy();
    await admin.dispose();
  });

  test("a forged x-location-id cannot be used to read another tenant's stock", async () => {
    // requireOrgContext takes x-location-id from any role without checking that
    // the location belongs to the caller's org (server/auth/commonAuth.ts:136).
    // The org filter downstream should still make that harmless — proven, not
    // assumed.
    const forged = await apiWithHeaders("ADMIN", { "x-location-id": b.locationId });
    const products = await forged.get("/api/products");
    const body = await products.text();
    expect(products.ok()).toBeTruthy();
    expect(
      leakedValues(body, bSecrets()),
      "a forged x-location-id surfaced another tenant's rows",
    ).toEqual([]);

    const stock = await forged.get(`/api/locations/${b.locationId}/stock`);
    expect(stock.status(), "another tenant's location must not resolve").toBe(404);
    await forged.dispose();
  });

  test("a forged x-location-id cannot open a POS shift against another tenant's location", async () => {
    const countPoisonedShifts = async () =>
      (
        await db
          .select({ id: shifts.id })
          .from(shifts)
          .where(and(eq(shifts.orgId, orgAId), eq(shifts.locationId, b.locationId)))
      ).length;

    const before = await countPoisonedShifts();
    const forged = await apiWithHeaders("CASHIER", { "x-location-id": b.locationId });
    const res = await forged.post("/api/shifts/open", {
      data: { locationId: b.locationId, openingFloat: 10 },
    });
    const body = await res.text();
    await forged.dispose();

    expect(res.status(), `foreign location shift open returned ${res.status()} ${body}`).toBe(404);
    expect(
      await countPoisonedShifts(),
      "opening a shift must not create an org-A row that references org-B's location",
    ).toBe(before);
  });

  test("impersonation headers without the shared secret cannot select a user", async () => {
    // The whole role matrix rests on this: if the id header alone were honoured,
    // any client could name itself seed-super-admin.
    const noSecret = await (
      await import("@playwright/test")
    ).request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000",
      extraHTTPHeaders: {
        "x-test-replit-user-id": "seed-super-admin",
        "x-org-id": orgBId,
      },
    });
    const res = await noSecret.get("/api/suppliers");
    const body = await res.text();
    await noSecret.dispose();

    // Without the secret the request is not authenticated at all, so it must not
    // return org B's data under any status.
    expect(leakedValues(body, bSecrets()), "a forged user id reached another org").toEqual([]);

    const wrongSecret = await (
      await import("@playwright/test")
    ).request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000",
      extraHTTPHeaders: {
        "x-test-replit-user-id": "seed-super-admin",
        "x-test-secret": "wrong-secret",
        "x-org-id": orgBId,
      },
    });
    const res2 = await wrongSecret.get("/api/suppliers");
    const body2 = await res2.text();
    await wrongSecret.dispose();
    expect(leakedValues(body2, bSecrets()), "a wrong secret still selected a user").toEqual([]);
  });
});
