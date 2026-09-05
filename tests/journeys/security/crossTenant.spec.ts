/**
 * Checkpoints 5.2, 5.3 and 5.5 — cross-tenant reads, cross-tenant writes, and
 * the IDOR sweep.
 *
 * A second organisation is created for real, with a real location, product,
 * supplier, purchase draft, goods receipt, transfer, customer, promotion,
 * loyalty tier, expense and gift card. Every probe below then uses those
 * genuine ids while authenticated as org A. That distinction matters: pointing
 * at a random UUID would return 404 because the row does not exist, which
 * proves nothing about scoping. Here the row definitely exists, and the only
 * reason the caller must not see it is that it belongs to someone else.
 *
 * Two things are asserted for every write attempt, not one:
 *   1. the response is a refusal (404/403/400 — never 2xx), and
 *   2. org B's database fingerprint is byte-identical afterwards.
 * A rejected request that still landed a partial write is the failure mode a
 * status-code assertion cannot see.
 *
 * This file never provisions into org A, so it is safe to run in parallel with
 * roleEnforcement.spec.ts, which does.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { apiAs, type Role } from "../fixtures";
import {
  authMode,
  createOrgB,
  destroyProvisioned,
  internalLeak,
  leakedValues,
  orgFingerprint,
  provisionOrgRecords,
  resolveOrgAId,
  ROLE_GATE_OFF_REASON,
  type OrgRecords,
} from "./tenants";

test.describe.configure({ mode: "default" });

let orgAId: string;
let orgBId: string;
let b: OrgRecords;
/** A throwaway "attacker" org, used where a probe would otherwise write into
 *  org A and race roleEnforcement.spec.ts's org-A fingerprints. */
let orgCId: string;
let cApi: APIRequestContext;
let bypassOn: boolean;

test.beforeAll(async () => {
  bypassOn = (await authMode()).devAuthBypass;
  orgAId = await resolveOrgAId();
  const createdB = await createOrgB();
  orgBId = createdB.orgId;
  b = await provisionOrgRecords(createdB.api, createdB.orgId);
  await createdB.api.dispose();
  const createdC = await createOrgB();
  orgCId = createdC.orgId;
  cApi = createdC.api;
});

test.afterAll(async () => {
  await cApi.dispose();
  await destroyProvisioned();
});

/** Every org-B value that must never appear in a response served to org A. */
function secrets(): string[] {
  return [
    orgBId,
    b.locationId,
    b.secondLocationId,
    b.productId,
    b.supplierId,
    b.productSupplierId,
    b.purchaseDraftId,
    b.purchaseDraftItemId,
    b.goodsReceiptId,
    b.transferId,
    b.customerId,
    b.promotionId,
    b.loyaltyTierId,
    b.expenseId,
    b.giftCardId,
  ];
}

type Read = { path: string; what: string };

function crossTenantReads(): Read[] {
  return [
    { path: `/api/products/${b.productId}`, what: "product" },
    { path: `/api/customers/${b.customerId}`, what: "customer" },
    { path: `/api/customers/${b.customerId}/intelligence`, what: "customer intelligence" },
    { path: `/api/purchase-drafts/${b.purchaseDraftId}`, what: "purchase draft" },
    { path: `/api/purchase-drafts/${b.purchaseDraftId}/receiving`, what: "draft receiving state" },
    { path: `/api/goods-receipts/${b.goodsReceiptId}`, what: "goods receipt" },
    { path: `/api/inventory/transfers/${b.transferId}`, what: "inventory transfer" },
    { path: `/api/locations/${b.locationId}/stock`, what: "location stock" },
    { path: `/api/gift-cards/${b.giftCardCode}`, what: "gift card by code" },
    { path: `/api/analytics/promotions/${b.promotionId}/lift`, what: "promotion lift" },
    { path: `/api/orders/${b.purchaseDraftId}`, what: "order (id from another table)" },
    { path: `/api/invoices/${b.purchaseDraftId}/pdf`, what: "invoice pdf" },
  ];
}

type Write = { method: "post" | "put" | "patch" | "delete"; path: string; body?: unknown; what: string };

function crossTenantWrites(): Write[] {
  return [
    { method: "patch", path: `/api/suppliers/${b.supplierId}`, body: { name: "OWNED BY A" }, what: "rename B's supplier" },
    { method: "delete", path: `/api/suppliers/${b.supplierId}`, what: "delete B's supplier" },
    { method: "patch", path: `/api/product-suppliers/${b.productSupplierId}`, body: { costPrice: 1 }, what: "reprice B's product-supplier link" },
    { method: "delete", path: `/api/product-suppliers/${b.productSupplierId}`, what: "unlink B's product-supplier" },
    { method: "patch", path: `/api/purchase-drafts/${b.purchaseDraftId}`, body: { notes: "OWNED BY A" }, what: "edit B's purchase draft" },
    { method: "patch", path: `/api/purchase-drafts/${b.purchaseDraftId}/status`, body: { status: "cancelled" }, what: "cancel B's purchase draft" },
    { method: "delete", path: `/api/purchase-drafts/${b.purchaseDraftId}`, what: "delete B's purchase draft" },
    { method: "post", path: `/api/purchase-drafts/${b.purchaseDraftId}/items`, body: { productId: b.productId, quantity: 3 }, what: "add a line to B's draft" },
    { method: "patch", path: `/api/purchase-drafts/${b.purchaseDraftId}/items/${b.purchaseDraftItemId}`, body: { quantity: 999 }, what: "edit a line on B's draft" },
    { method: "delete", path: `/api/purchase-drafts/${b.purchaseDraftId}/items/${b.purchaseDraftItemId}`, what: "delete a line from B's draft" },
    { method: "post", path: `/api/goods-receipts/${b.goodsReceiptId}/complete`, what: "complete B's goods receipt (would move B's stock)" },
    { method: "post", path: `/api/goods-receipts/${b.goodsReceiptId}/void`, what: "void B's goods receipt" },
    { method: "patch", path: `/api/inventory/transfers/${b.transferId}/status`, body: { status: "cancelled" }, what: "cancel B's transfer" },
    { method: "patch", path: `/api/inventory/${b.productId}`, body: { adjustment: 500, type: "adjustment" }, what: "adjust B's stock" },
    { method: "put", path: `/api/products/${b.productId}`, body: { name: "OWNED BY A" }, what: "rename B's product" },
    { method: "delete", path: `/api/products/${b.productId}`, what: "delete B's product" },
    { method: "patch", path: `/api/products/${b.productId}/aliases`, body: { aliases: ["owned-by-a"] }, what: "alias B's product" },
    { method: "put", path: `/api/customers/${b.customerId}`, body: { name: "OWNED BY A" }, what: "rename B's customer" },
    { method: "delete", path: `/api/customers/${b.customerId}`, what: "delete B's customer" },
    { method: "patch", path: `/api/promotions/${b.promotionId}`, body: { name: "OWNED BY A" }, what: "edit B's promotion" },
    { method: "delete", path: `/api/promotions/${b.promotionId}`, what: "delete B's promotion" },
    { method: "patch", path: `/api/loyalty-tiers/${b.loyaltyTierId}`, body: { name: "OWNED BY A" }, what: "edit B's loyalty tier" },
    { method: "delete", path: `/api/loyalty-tiers/${b.loyaltyTierId}`, what: "delete B's loyalty tier" },
    { method: "put", path: `/api/overhead-expenses/${b.expenseId}`, body: { name: "OWNED BY A" }, what: "edit B's expense" },
    { method: "delete", path: `/api/overhead-expenses/${b.expenseId}`, what: "delete B's expense" },
    { method: "patch", path: `/api/locations/${b.locationId}`, body: { name: "OWNED BY A" }, what: "rename B's location" },
    { method: "delete", path: `/api/locations/${b.locationId}`, what: "delete B's location" },
    { method: "post", path: `/api/locations/${b.locationId}/set-default`, what: "make B's location A's default" },
    { method: "post", path: `/api/gift-cards/${b.giftCardCode}/void`, what: "void B's gift card" },
    { method: "post", path: `/api/gift-cards/${b.giftCardCode}/redeem`, body: { amount: 5 }, what: "redeem B's gift card" },
    { method: "patch", path: `/api/orgs/${orgBId}`, body: { name: "OWNED BY A" }, what: "rename org B itself" },
  ];
}

async function send(api: APIRequestContext, w: Write) {
  const options = w.body === undefined ? undefined : { data: w.body };
  switch (w.method) {
    case "post":
      return api.post(w.path, options);
    case "put":
      return api.put(w.path, options);
    case "patch":
      return api.patch(w.path, options);
    case "delete":
      return api.delete(w.path, options);
  }
}

test.describe("5.2 cross-tenant reads", () => {
  for (const role of ["ADMIN", "MANAGER", "CASHIER"] as Role[]) {
    test(`${role} of org A cannot read any of org B's records by id`, async () => {
      // MANAGER/CASHIER hit role gates on some of these paths; a 403 is still a
      // refusal, so the assertion is "not 2xx, and no org-B value in the body".
      const api = await apiAs(role, orgAId);
      const served: string[] = [];
      const leaks: string[] = [];
      const internals: string[] = [];

      for (const r of crossTenantReads()) {
        const res = await api.get(r.path);
        const body = await res.text();
        if (res.status() >= 200 && res.status() < 300) {
          served.push(`GET ${r.path} → ${res.status()} served ${r.what}: ${body.slice(0, 200)}`);
        }
        const found = leakedValues(body, secrets());
        if (found.length) leaks.push(`GET ${r.path} leaked ${found.join(", ")}`);
        const internal = internalLeak(body);
        if (internal) internals.push(`GET ${r.path} disclosed ${internal}: ${body.slice(0, 200)}`);
      }
      await api.dispose();

      expect(served, "another tenant's record was served").toEqual([]);
      expect(leaks, "another tenant's identifiers appeared in a response body").toEqual([]);
      expect(internals, "a refusal disclosed server internals").toEqual([]);
    });
  }

  test("org A's list endpoints contain nothing belonging to org B", async () => {
    const api = await apiAs("ADMIN", orgAId);
    const lists = [
      "/api/products",
      "/api/customers",
      "/api/suppliers",
      "/api/product-suppliers",
      "/api/purchase-drafts",
      "/api/goods-receipts",
      "/api/inventory/transfers",
      "/api/promotions",
      "/api/loyalty-tiers",
      "/api/overhead-expenses",
      "/api/gift-cards",
      "/api/locations",
      "/api/orgs",
      "/api/replenishment/recommendations",
    ];
    const leaks: string[] = [];
    for (const path of lists) {
      const res = await api.get(path);
      if (!res.ok()) continue; // role-gated or unavailable lists are covered elsewhere
      const body = await res.text();
      const found = leakedValues(body, secrets());
      if (found.length) leaks.push(`GET ${path} leaked ${found.join(", ")}`);
    }
    await api.dispose();
    expect(leaks, "a list endpoint returned another tenant's rows").toEqual([]);
  });
});

test.describe("5.3 cross-tenant writes", () => {
  test("ADMIN of org A cannot mutate any of org B's records, and nothing lands", async () => {
    const api = await apiAs("ADMIN", orgAId);
    const before = await orgFingerprint(orgBId);

    const accepted: string[] = [];
    const internals: string[] = [];
    for (const w of crossTenantWrites()) {
      const res = await send(api, w);
      const body = await res.text();
      if (res.status() >= 200 && res.status() < 300) {
        accepted.push(`${w.method.toUpperCase()} ${w.path} → ${res.status()} (${w.what}) ${body.slice(0, 200)}`);
      }
      const internal = internalLeak(body);
      if (internal) internals.push(`${w.method.toUpperCase()} ${w.path} disclosed ${internal}`);
    }
    await api.dispose();

    expect(accepted, "a cross-tenant mutation was accepted").toEqual([]);
    expect(internals, "a refusal disclosed server internals").toEqual([]);
    // The assertion that matters most: even the refusals must not have written.
    expect(await orgFingerprint(orgBId), "org B's data changed during the sweep").toEqual(before);
  });

  test("cross-tenant ids smuggled inside a create are rejected on the routes that check", async () => {
    // The dangerous shape is not "GET someone else's id" but "reference someone
    // else's id from a create that is otherwise legitimate in my own org".
    // Runs as org C — a throwaway attacker tenant — so nothing is written into
    // the seeded org and this file stays parallel-safe.
    const beforeB = await orgFingerprint(orgBId);

    const attempts = [
      {
        what: "transfer between B's locations",
        res: await cApi.post("/api/inventory/transfers", {
          data: {
            fromLocationId: b.locationId,
            toLocationId: b.secondLocationId,
            items: [{ productId: b.productId, quantity: 1 }],
          },
        }),
      },
      {
        what: "transfer draft from replenishment into B's location",
        res: await cApi.post("/api/replenishment/create-transfer-draft", {
          data: {
            toLocationId: b.locationId,
            items: [{ productId: b.productId, fromLocationId: b.secondLocationId, quantity: 1 }],
          },
        }),
      },
      {
        what: "goods receipt against B's purchase draft",
        res: await cApi.post("/api/goods-receipts", {
          data: {
            purchaseDraftId: b.purchaseDraftId,
            items: [
              {
                purchaseDraftItemId: b.purchaseDraftItemId,
                productId: b.productId,
                quantityReceived: 1,
              },
            ],
          },
        }),
      },
      {
        what: "product-supplier link joining B's product to B's supplier",
        res: await cApi.post("/api/product-suppliers", {
          data: { productId: b.productId, supplierId: b.supplierId, costPrice: 1 },
        }),
      },
    ];

    const accepted: string[] = [];
    for (const a of attempts) {
      if (a.res.status() >= 200 && a.res.status() < 300) {
        accepted.push(`${a.what} → ${a.res.status()} ${(await a.res.text()).slice(0, 240)}`);
      }
    }

    expect(accepted, "a create referencing another tenant's ids was accepted").toEqual([]);
    expect(await orgFingerprint(orgBId), "org B's data changed").toEqual(beforeB);
  });

  /**
   * OPEN FINDING — cross-tenant reference injection and data disclosure.
   *
   * `POST /api/replenishment/create-purchase-draft` (and the batch variant)
   * accept `supplierId`, `locationId` and `productId` belonging to another
   * organisation and create the draft anyway:
   * `insertDraftWithItems` (server/services/purchaseDrafts.ts:229-261) inserts
   * `orgId` from the caller's context but never checks that the referenced rows
   * belong to it.
   *
   * CLOSED. insertDraftWithItems now calls assertReferencesBelongToOrg, which
   * checks the supplier, the location and every referenced product against the
   * caller's org before any row is written. The product check does not name
   * which id failed — the caller has already proved it does not own them, and
   * saying which exist would turn the error into an existence oracle for
   * another tenant's catalogue.
   *
   * Kept as a live expectation so the create path cannot quietly reopen.
   */
  test("a create must not be allowed to reference another tenant's supplier, location or product", async () => {
    const single = await cApi.post("/api/replenishment/create-purchase-draft", {
      data: {
        supplierId: b.supplierId,
        locationId: b.locationId,
        items: [{ productId: b.productId, quantity: 4, estimatedCost: 1 }],
      },
    });
    const batch = await cApi.post("/api/replenishment/create-purchase-drafts", {
      data: {
        lines: [
          { supplierId: b.supplierId, locationId: b.locationId, productId: b.productId, quantity: 4 },
        ],
      },
    });
    expect(single.status(), "single create must refuse another tenant's ids").toBeGreaterThanOrEqual(400);
    expect(batch.status(), "batch create must refuse another tenant's ids").toBeGreaterThanOrEqual(400);
  });

  test("FINDING PROOF: the injected draft then discloses org B's names to org C", async () => {
    // The injection above is not merely untidy data — it is a working read
    // oracle. Anyone holding another tenant's UUIDs can plant them in a draft
    // of their own and read that tenant's supplier, location and product names
    // straight back out, because loadDraftWithItems joins suppliers, locations
    // and products with no org predicate
    // (server/services/purchaseDrafts.ts:156-157, 175).
    const create = await cApi.post("/api/replenishment/create-purchase-draft", {
      data: {
        supplierId: b.supplierId,
        locationId: b.locationId,
        items: [{ productId: b.productId, quantity: 2, estimatedCost: 1 }],
      },
    });
    if (create.status() >= 400) {
      // The injection has been fixed; there is nothing left to disclose.
      console.log("[5.3] injection now refused — disclosure path is closed");
      return;
    }
    const draft = (await create.json()) as { id: string };

    const readback = await cApi.get(`/api/purchase-drafts/${draft.id}`);
    const body = await readback.text();
    const disclosed = leakedValues(body, [
      b.supplierId,
      b.locationId,
      b.productId,
    ]);
    console.log(
      `[5.3 FINDING] GET /api/purchase-drafts/${draft.id} as org C returned org B's ` +
        `supplierName/locationName/productName. Disclosed ids: ${disclosed.join(", ")}`,
    );
    // Asserted as the *current* behaviour so the proof is recorded and the log
    // line is produced; the expectation of a fix lives in the test.fail() above.
    expect(readback.status()).toBe(200);
    expect(body, "org B's supplier name is served to org C").toContain("ZZ-SEC Supplier");
    expect(body, "org B's product name is served to org C").toContain("ZZ-SEC Widget");
  });
});

test.describe("5.5 IDOR sweep", () => {
  test("enumerating org B's ids as every org-A role leaks nothing", async () => {
    // 5.2 covers reads and 5.3 covers writes as ADMIN. This crosses the two:
    // every role × every id, so no combination is left unprobed.
    const roles: Role[] = bypassOn ? ["ADMIN"] : ["ADMIN", "MANAGER", "CASHIER"];
    const before = await orgFingerprint(orgBId);
    const failures: string[] = [];

    for (const role of roles) {
      const api = await apiAs(role, orgAId);
      for (const r of crossTenantReads()) {
        const res = await api.get(r.path);
        const body = await res.text();
        if (res.status() >= 200 && res.status() < 300) {
          failures.push(`${role} GET ${r.path} → ${res.status()}`);
        }
        const found = leakedValues(body, secrets());
        if (found.length) failures.push(`${role} GET ${r.path} leaked ${found.join(", ")}`);
      }
      for (const w of crossTenantWrites()) {
        const res = await send(api, w);
        if (res.status() >= 200 && res.status() < 300) {
          failures.push(`${role} ${w.method.toUpperCase()} ${w.path} → ${res.status()} (${w.what})`);
        }
      }
      await api.dispose();
    }

    expect(failures, "cross-tenant access succeeded for some role").toEqual([]);
    expect(await orgFingerprint(orgBId), "org B changed during the sweep").toEqual(before);
  });

  test("a CASHIER of org A gets no more than an ADMIN of org A on org B's ids", async () => {
    test.skip(bypassOn, ROLE_GATE_OFF_REASON);
    // Guards against a route that is role-gated for ADMIN but reachable by a
    // lower role through a different code path.
    const cashier = await apiAs("CASHIER", orgAId);
    const twoHundreds: string[] = [];
    for (const r of crossTenantReads()) {
      const res = await cashier.get(r.path);
      if (res.ok()) twoHundreds.push(`GET ${r.path} → ${res.status()}`);
    }
    await cashier.dispose();
    expect(twoHundreds).toEqual([]);
  });

  test("org B is intact after every sweep in this file", async () => {
    // The final ledger check. If a probe above wrote and a later probe wrote it
    // back, the per-test fingerprints could both pass; this compares against the
    // record set as provisioned.
    const api = await apiAs("SUPER_ADMIN", orgBId);
    const draft = await api.get(`/api/purchase-drafts/${b.purchaseDraftId}`);
    expect(draft.ok(), "org B's own admin must still see its draft").toBeTruthy();
    const draftBody = (await draft.json()) as { status: string; items?: { quantity: number }[] };
    expect(draftBody.status, "status must still be the one org B set").toBe("approved");
    expect(draftBody.items?.[0]?.quantity, "line quantity must be untouched").toBe(9);

    const supplier = await api.get("/api/suppliers");
    const suppliers = (await supplier.json()) as { id: string; name: string }[];
    expect(
      suppliers.find((s) => s.id === b.supplierId)?.name,
      "supplier name must not have been overwritten by org A",
    ).toContain("ZZ-SEC Supplier");

    const card = await api.get(`/api/gift-cards/${b.giftCardCode}`);
    expect(card.ok(), "org B's gift card must still exist").toBeTruthy();
    const cardBody = (await card.json()) as { balance: number; status: string };
    expect(cardBody.status, "gift card must not have been voided by org A").toBe("active");
    expect(cardBody.balance, "gift card balance must be untouched").toBe(25);

    await api.dispose();
  });
});
