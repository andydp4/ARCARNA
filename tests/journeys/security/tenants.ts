/**
 * Phase 5 security-suite support: real records in two real organisations, plus
 * the probes the specs need in order to describe the server they are actually
 * talking to.
 *
 * Why the second tenant has to be real: a cross-tenant assertion made against a
 * fabricated UUID proves nothing. A random id returns 404 because it does not
 * exist, not because the query was org-scoped. Every isolation assertion in this
 * directory therefore points at a row that genuinely exists, in a genuinely
 * different organisation, which the caller genuinely must not be able to reach.
 *
 * Org B is created by direct insert rather than through `POST /api/orgs`,
 * because that route sits behind `requireSuperAdminMfa` and cannot be satisfied
 * without a real Clerk session. Everything *inside* both orgs is then created
 * through the HTTP API, so the fixtures exercise the same code paths the
 * application does.
 */
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../server/db";
import {
  organizations,
  locations,
  productLocationStock,
  purchaseDraftItems,
  promotions,
} from "@shared/schema";
import { apiAs, authHeaders, uniqueSuffix, type Role } from "../fixtures";

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";

/** Every record this suite creates carries this prefix, so a stray row after a
 *  crashed run is identifiable and safe to delete by hand. */
export const SEC_PREFIX = "ZZ-SEC";

// ---------------------------------------------------------------- server probe

export type AuthMode = {
  /** DEV_AUTH_BYPASS=1 — `requireRole`, `isOwner` and `requireSuperAdminMfa`
   *  all short-circuit to `next()`, so no role assertion can be made. */
  devAuthBypass: boolean;
  /** PHASE2D_TEST=1 — the role-impersonation headers are honoured. */
  phase2dTest: boolean;
  /** Clerk is the selected provider *and* has a publishable key configured. */
  clerkConfigured: boolean;
  nodeEnv: string;
};

let cachedMode: AuthMode | null = null;

/**
 * Reads `/api/auth/runtime` (deliberately unauthenticated) to discover which
 * auth mode the server under test is in. The specs branch on this rather than
 * assuming, because the two modes have genuinely different behaviour and
 * asserting the wrong one would be theatre.
 */
export async function authMode(): Promise<AuthMode> {
  if (cachedMode) return cachedMode;
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const res = await ctx.get("/api/auth/runtime");
  if (!res.ok()) {
    await ctx.dispose();
    throw new Error(`/api/auth/runtime returned ${res.status()} — cannot determine auth mode`);
  }
  const body = (await res.json()) as {
    devAuthBypass?: boolean;
    phase2dTest?: boolean;
    clerkPublishableKey?: string | null;
    nodeEnv?: string;
  };
  await ctx.dispose();
  cachedMode = {
    devAuthBypass: body.devAuthBypass === true,
    phase2dTest: body.phase2dTest === true,
    clerkConfigured: !!body.clerkPublishableKey,
    nodeEnv: body.nodeEnv ?? "unknown",
  };
  return cachedMode;
}

/** Skip message explaining why a role assertion is unavailable on this server. */
export const ROLE_GATE_OFF_REASON =
  "DEV_AUTH_BYPASS=1 on the server under test: requireRole() returns next() " +
  "unconditionally (server/auth/commonAuth.ts:94-95), so no 403 can be produced. " +
  "Start the app without DEV_AUTH_BYPASS to assert role gates — see this " +
  "directory's header comment for the command.";

// ------------------------------------------------------------- org A resolution

/**
 * Org A is the org `seed-admin` belongs to — read from the API, not from
 * `orgs[0]`. `resolveOrgId()` in the shared fixtures takes the first row of a
 * name-ordered list, which would silently switch orgs the moment this suite
 * adds a second one.
 */
export async function resolveOrgAId(): Promise<string> {
  const api = await apiAs("ADMIN");
  const res = await api.get("/api/auth/user");
  if (!res.ok()) {
    await api.dispose();
    throw new Error(`/api/auth/user as ADMIN returned ${res.status()} — is the DB seeded?`);
  }
  const user = (await res.json()) as { orgId?: string | null };
  await api.dispose();
  if (!user.orgId) {
    throw new Error("seed-admin has no orgId — run `npm run seed` against this database.");
  }
  return user.orgId;
}

// -------------------------------------------------------------- provisioning

/** The record set every `:id` route in this phase's sweep needs. */
export type OrgRecords = {
  orgId: string;
  locationId: string;
  secondLocationId: string;
  productId: string;
  supplierId: string;
  productSupplierId: string;
  purchaseDraftId: string;
  purchaseDraftItemId: string;
  goodsReceiptId: string;
  transferId: string;
  customerId: string;
  promotionId: string;
  loyaltyTierId: string;
  expenseId: string;
  /** Gift-card code — a money-bearing, guessable identifier, so its own probe. */
  giftCardCode: string;
  giftCardId: string;
};

/** Ids created by this module, per table, for dependency-ordered teardown. */
const created = {
  orgs: [] as string[],
  goodsReceipts: [] as string[],
  purchaseDrafts: [] as string[],
  transfers: [] as string[],
  productSuppliers: [] as string[],
  products: [] as string[],
  suppliers: [] as string[],
  locations: [] as string[],
  customers: [] as string[],
  promotions: [] as string[],
  loyaltyTiers: [] as string[],
  expenses: [] as string[],
  giftCards: [] as string[],
};

async function jsonOrThrow(
  res: { ok(): boolean; status(): number; text(): Promise<string> },
  what: string,
): Promise<any> {
  const raw = await res.text();
  if (!res.ok()) {
    throw new Error(`Security-suite setup failed at ${what}: ${res.status()} ${raw}`);
  }
  return JSON.parse(raw);
}

/**
 * Creates one of every record type this phase reaches, inside `orgId`, using
 * `api` (which must already be scoped to that org).
 */
export async function provisionOrgRecords(
  api: APIRequestContext,
  orgId: string,
): Promise<OrgRecords> {
  const suffix = uniqueSuffix();

  const location = await jsonOrThrow(
    await api.post("/api/locations", {
      data: {
        name: `${SEC_PREFIX} Store ${suffix}`,
        address: "1 Isolation Way",
        city: "Tenantville",
        state: "TB",
        zipCode: "TB1 1TB",
        phone: "0000000000",
        email: `sec-${suffix}@example.invalid`,
      },
    }),
    "POST /api/locations",
  );
  created.locations.push(location.id);

  const [secondLocation] = await db
    .insert(locations)
    .values({
      orgId,
      name: `${SEC_PREFIX} Annex ${suffix}`,
      address: "2 Isolation Way",
      city: "Tenantville",
      state: "TB",
      zipCode: "TB2 2TB",
      phone: "0000000000",
      email: `sec-annex-${suffix}@example.invalid`,
    })
    .returning();
  created.locations.push(secondLocation.id);

  const product = await jsonOrThrow(
    await api.post("/api/products", {
      data: {
        name: `${SEC_PREFIX} Widget ${suffix}`,
        productId: `SECSKU-${suffix}`,
        productCode: `SECSKU-${suffix}`,
        locationId: location.id,
        defaultSalePrice: "12.50",
        costPrice: "6.00",
      },
    }),
    "POST /api/products",
  );
  created.products.push(product.id);

  await db.insert(productLocationStock).values({
    orgId,
    productId: product.id,
    locationId: location.id,
    stock: 40,
    stockLimit: 200,
  });

  const supplier = await jsonOrThrow(
    await api.post("/api/suppliers", {
      data: { name: `${SEC_PREFIX} Supplier ${suffix}`, leadTimeDays: 3 },
    }),
    "POST /api/suppliers",
  );
  created.suppliers.push(supplier.id);

  const productSupplier = await jsonOrThrow(
    await api.post("/api/product-suppliers", {
      data: {
        productId: product.id,
        supplierId: supplier.id,
        costPrice: 6,
        packSize: 1,
        isPreferred: true,
      },
    }),
    "POST /api/product-suppliers",
  );
  created.productSuppliers.push(productSupplier.id);

  const draft = await jsonOrThrow(
    await api.post("/api/replenishment/create-purchase-draft", {
      data: {
        supplierId: supplier.id,
        locationId: location.id,
        items: [{ productId: product.id, quantity: 9, estimatedCost: 6 }],
      },
    }),
    "POST /api/replenishment/create-purchase-draft",
  );
  created.purchaseDrafts.push(draft.id);

  const [draftItem] = await db
    .select()
    .from(purchaseDraftItems)
    .where(eq(purchaseDraftItems.purchaseDraftId, draft.id))
    .limit(1);
  if (!draftItem) throw new Error("Security-suite setup failed: purchase draft has no items");

  // A goods receipt is only accepted against an approved draft.
  await jsonOrThrow(
    await api.patch(`/api/purchase-drafts/${draft.id}/status`, { data: { status: "reviewed" } }),
    "PATCH /api/purchase-drafts/:id/status reviewed",
  );
  await jsonOrThrow(
    await api.patch(`/api/purchase-drafts/${draft.id}/status`, { data: { status: "approved" } }),
    "PATCH /api/purchase-drafts/:id/status approved",
  );

  const receipt = await jsonOrThrow(
    await api.post("/api/goods-receipts", {
      data: {
        purchaseDraftId: draft.id,
        supplierReference: `${SEC_PREFIX}-REF-${suffix}`,
        items: [
          { purchaseDraftItemId: draftItem.id, productId: product.id, quantityReceived: 2 },
        ],
      },
    }),
    "POST /api/goods-receipts",
  );
  created.goodsReceipts.push(receipt.id);

  const transfer = await jsonOrThrow(
    await api.post("/api/inventory/transfers", {
      data: {
        fromLocationId: location.id,
        toLocationId: secondLocation.id,
        items: [{ productId: product.id, quantity: 1 }],
      },
    }),
    "POST /api/inventory/transfers",
  );
  created.transfers.push(transfer.id);

  const customer = await jsonOrThrow(
    await api.post("/api/customers", {
      data: {
        name: `${SEC_PREFIX} Customer ${suffix}`,
        phone: `+4470${Math.floor(Math.random() * 100_000_000)}`,
        email: `sec-cust-${suffix}@example.invalid`,
      },
    }),
    "POST /api/customers",
  );
  created.customers.push(customer.id);

  // Inserted directly, not via POST /api/promotions: that route validates with
  // `insertPromotionSchema`, whose startDate/endDate are `z.date()` (drizzle-zod
  // over a timestamp column) and so cannot be satisfied by any JSON body. See
  // the recorded finding — the real client hits the same wall.
  const [promotion] = await db
    .insert(promotions)
    .values({
      orgId,
      name: `${SEC_PREFIX} Promo ${suffix}`,
      type: "percentage",
      value: "10",
      startDate: new Date(Date.now() - 86_400_000),
      endDate: new Date(Date.now() + 30 * 86_400_000),
      isActive: 1,
    })
    .returning();
  created.promotions.push(promotion.id);

  const loyaltyTier = await jsonOrThrow(
    await api.post("/api/loyalty-tiers", {
      data: {
        name: `${SEC_PREFIX} Tier ${suffix}`,
        pointsRequired: 100,
        discountPercentage: "5",
      },
    }),
    "POST /api/loyalty-tiers",
  );
  created.loyaltyTiers.push(loyaltyTier.id);

  const expense = await jsonOrThrow(
    await api.post("/api/overhead-expenses", {
      data: {
        name: `${SEC_PREFIX} Expense ${suffix}`,
        category: "utilities",
        amount: "42.00",
        frequency: "monthly",
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
      },
    }),
    "POST /api/overhead-expenses",
  );
  created.expenses.push(expense.id);

  const giftCard = await jsonOrThrow(
    await api.post("/api/gift-cards", { data: { amount: 25 } }),
    "POST /api/gift-cards",
  );
  created.giftCards.push(giftCard.giftCard.id);

  return {
    orgId,
    locationId: location.id,
    secondLocationId: secondLocation.id,
    productId: product.id,
    supplierId: supplier.id,
    productSupplierId: productSupplier.id,
    purchaseDraftId: draft.id,
    purchaseDraftItemId: draftItem.id,
    goodsReceiptId: receipt.id,
    transferId: transfer.id,
    customerId: customer.id,
    promotionId: promotion.id,
    loyaltyTierId: loyaltyTier.id,
    expenseId: expense.id,
    giftCardCode: giftCard.code,
    giftCardId: giftCard.giftCard.id,
  };
}

/** A brand-new organisation, plus a SUPER_ADMIN context scoped to it. */
export async function createOrgB(): Promise<{ orgId: string; api: APIRequestContext }> {
  // The name sorts last on purpose, so `resolveOrgId()` in the shared fixtures —
  // which returns the first name-ordered org — keeps returning the seeded org.
  const [org] = await db
    .insert(organizations)
    .values({ name: `${SEC_PREFIX}-TENANT-B ${uniqueSuffix()}`, setupComplete: 1 })
    .returning();
  created.orgs.push(org.id);
  return { orgId: org.id, api: await apiAs("SUPER_ADMIN", org.id) };
}

/**
 * Deletes everything this module created, in dependency order, wherever it
 * ended up.
 *
 * Written as explicit ordered SQL rather than a drizzle chain for two reasons.
 * First, most of these tables reference `organizations` with NO ACTION, not
 * CASCADE, so the org row can only go last. Second — and this is why it is not
 * simply "delete my tracked ids" — the cross-tenant suite deliberately provokes
 * the server into creating rows that reference records across org boundaries
 * (see the `create-purchase-draft` finding), so a row created in org A can hold
 * a foreign key onto an org-B supplier, location or product. Teardown therefore
 * sweeps by reference as well as by id.
 */
export async function destroyProvisioned(): Promise<void> {
  const list = (ids: string[]) => sql.raw(ids.map((id) => `'${id}'::uuid`).join(","));
  const has = (ids: string[]) => ids.length > 0;

  const orgs = created.orgs;
  const P = created.products;
  const S = created.suppliers;
  const L = created.locations;

  // Purchase drafts to remove: those in a created org, those pointing at a
  // created supplier or location, and those with a line on a created product.
  if (has(orgs) || has(S) || has(L) || has(P)) {
    const conditions: string[] = [];
    if (has(orgs)) conditions.push(`org_id IN (${orgs.map((o) => `'${o}'::uuid`).join(",")})`);
    if (has(S)) conditions.push(`supplier_id IN (${S.map((x) => `'${x}'::uuid`).join(",")})`);
    if (has(L)) conditions.push(`location_id IN (${L.map((x) => `'${x}'::uuid`).join(",")})`);
    if (has(P))
      conditions.push(
        `id IN (SELECT purchase_draft_id FROM purchase_draft_items WHERE product_id IN (${P.map((x) => `'${x}'::uuid`).join(",")}))`,
      );
    const where = sql.raw(conditions.join(" OR "));
    await db.execute(sql`DELETE FROM goods_receipt_items WHERE goods_receipt_id IN (SELECT id FROM goods_receipts WHERE purchase_draft_id IN (SELECT id FROM purchase_drafts WHERE ${where}))`);
    await db.execute(sql`DELETE FROM goods_receipts WHERE purchase_draft_id IN (SELECT id FROM purchase_drafts WHERE ${where})`);
    await db.execute(sql`DELETE FROM purchase_draft_items WHERE purchase_draft_id IN (SELECT id FROM purchase_drafts WHERE ${where})`);
    await db.execute(sql`DELETE FROM purchase_drafts WHERE ${where}`);
  }

  if (has(orgs) || has(L) || has(P)) {
    const conditions: string[] = [];
    if (has(orgs)) conditions.push(`org_id IN (${orgs.map((o) => `'${o}'::uuid`).join(",")})`);
    if (has(L))
      conditions.push(
        `from_location_id IN (${L.map((x) => `'${x}'::uuid`).join(",")}) OR to_location_id IN (${L.map((x) => `'${x}'::uuid`).join(",")})`,
      );
    const where = sql.raw(conditions.join(" OR "));
    await db.execute(sql`DELETE FROM inventory_transfer_items WHERE transfer_id IN (SELECT id FROM inventory_transfers WHERE ${where})`);
    if (has(P)) {
      await db.execute(sql`DELETE FROM inventory_transfer_items WHERE product_id IN (${list(P)})`);
    }
    await db.execute(sql`DELETE FROM inventory_transfers WHERE ${where}`);
  }

  if (has(P)) {
    await db.execute(sql`DELETE FROM goods_receipt_items WHERE product_id IN (${list(P)})`);
    await db.execute(sql`DELETE FROM inventory_movements WHERE product_id IN (${list(P)})`);
    await db.execute(sql`DELETE FROM order_items WHERE product_id IN (${list(P)})`);
    await db.execute(sql`DELETE FROM product_suppliers WHERE product_id IN (${list(P)})`);
    await db.execute(sql`DELETE FROM product_location_stock WHERE product_id IN (${list(P)})`);
  }
  if (has(S)) {
    await db.execute(sql`DELETE FROM product_suppliers WHERE supplier_id IN (${list(S)})`);
  }
  if (has(L)) {
    await db.execute(sql`DELETE FROM inventory_movements WHERE location_id IN (${list(L)}) OR from_location_id IN (${list(L)}) OR to_location_id IN (${list(L)})`);
    await db.execute(sql`DELETE FROM product_location_stock WHERE location_id IN (${list(L)})`);
  }
  if (has(created.giftCards)) {
    // gift_card_movements cascades from gift_cards.
    await db.execute(sql`DELETE FROM gift_cards WHERE id IN (${list(created.giftCards)})`);
  }
  if (has(created.expenses)) {
    await db.execute(sql`DELETE FROM overhead_expenses WHERE id IN (${list(created.expenses)})`);
  }
  if (has(created.promotions)) {
    await db.execute(sql`DELETE FROM promotions WHERE id IN (${list(created.promotions)})`);
  }
  if (has(created.customers)) {
    await db.execute(sql`DELETE FROM customers WHERE id IN (${list(created.customers)})`);
  }
  if (has(created.loyaltyTiers)) {
    await db.execute(sql`UPDATE customers SET tier_id = NULL WHERE tier_id IN (${list(created.loyaltyTiers)})`);
    await db.execute(sql`DELETE FROM loyalty_tiers WHERE id IN (${list(created.loyaltyTiers)})`);
  }
  if (has(P)) {
    await db.execute(sql`DELETE FROM products WHERE id IN (${list(P)})`);
  }
  if (has(S)) {
    await db.execute(sql`DELETE FROM suppliers WHERE id IN (${list(S)})`);
  }
  if (has(L)) {
    await db.execute(sql`DELETE FROM locations WHERE id IN (${list(L)})`);
  }

  if (has(orgs)) {
    const o = list(orgs);
    // Everything else that can hold an org id. Ordered children-before-parents;
    // rows with ON DELETE CASCADE are included anyway so the order is explicit.
    for (const stmt of [
      sql`DELETE FROM gift_cards WHERE org_id IN (${o})`,
      sql`DELETE FROM inventory_movements WHERE org_id IN (${o})`,
      sql`DELETE FROM product_suppliers WHERE org_id IN (${o})`,
      sql`DELETE FROM product_location_stock WHERE org_id IN (${o})`,
      sql`DELETE FROM saved_views WHERE org_id IN (${o})`,
      sql`DELETE FROM satisfaction_scores WHERE org_id IN (${o})`,
      sql`DELETE FROM reseller_transactions WHERE org_id IN (${o})`,
      sql`DELETE FROM reseller_partners WHERE org_id IN (${o})`,
      sql`DELETE FROM scheduled_report_runs WHERE org_id IN (${o})`,
      sql`DELETE FROM scheduled_reports WHERE org_id IN (${o})`,
      sql`DELETE FROM automation_rules WHERE org_id IN (${o})`,
      sql`DELETE FROM api_keys WHERE org_id IN (${o})`,
      sql`DELETE FROM outbound_webhooks WHERE org_id IN (${o})`,
      sql`DELETE FROM feature_flags WHERE org_id IN (${o})`,
      sql`DELETE FROM org_notifications WHERE org_id IN (${o})`,
      sql`DELETE FROM loyalty_settings WHERE org_id IN (${o})`,
      sql`DELETE FROM loyalty_ledger WHERE org_id IN (${o})`,
      sql`DELETE FROM order_expenses WHERE org_id IN (${o})`,
      sql`DELETE FROM order_items WHERE org_id IN (${o})`,
      sql`DELETE FROM invoices WHERE org_id IN (${o})`,
      sql`DELETE FROM refunds WHERE org_id IN (${o})`,
      sql`DELETE FROM orders WHERE org_id IN (${o})`,
      sql`DELETE FROM cashier_shift_summaries WHERE org_id IN (${o})`,
      sql`DELETE FROM cashier_commission_payments WHERE org_id IN (${o})`,
      sql`DELETE FROM cashier_shifts WHERE org_id IN (${o})`,
      sql`DELETE FROM cashier_profiles WHERE org_id IN (${o})`,
      sql`DELETE FROM shifts WHERE org_id IN (${o})`,
      sql`DELETE FROM customer_rfm WHERE org_id IN (${o})`,
      sql`DELETE FROM customers WHERE org_id IN (${o})`,
      sql`DELETE FROM loyalty_tiers WHERE org_id IN (${o})`,
      sql`DELETE FROM promotions WHERE org_id IN (${o})`,
      sql`DELETE FROM overhead_expenses WHERE org_id IN (${o})`,
      sql`DELETE FROM products WHERE org_id IN (${o})`,
      sql`DELETE FROM suppliers WHERE org_id IN (${o})`,
      sql`DELETE FROM locations WHERE org_id IN (${o})`,
      sql`DELETE FROM import_history WHERE org_id IN (${o})`,
      sql`DELETE FROM analytics_daily WHERE org_id IN (${o})`,
      sql`DELETE FROM analytics_weekly WHERE org_id IN (${o})`,
      sql`DELETE FROM analytics_monthly WHERE org_id IN (${o})`,
      sql`DELETE FROM admin_audit_logs WHERE org_id IN (${o})`,
      sql`DELETE FROM allowed_users WHERE org_id IN (${o})`,
      sql`UPDATE users SET org_id = NULL WHERE org_id IN (${o})`,
      sql`UPDATE domain_outbox SET org_id = NULL WHERE org_id IN (${o})`,
      sql`DELETE FROM organizations WHERE id IN (${o})`,
    ]) {
      await db.execute(stmt);
    }
  }

  for (const key of Object.keys(created) as (keyof typeof created)[]) {
    created[key].length = 0;
  }
}

// ------------------------------------------------------------ state snapshots

/**
 * A comparable fingerprint of every table a mutating route in this phase can
 * touch, restricted to one org. Comparing before/after is how "the request was
 * rejected" is upgraded to "and nothing was written" — a 403 that still wrote
 * is far worse than one that did not, and a status-only assertion cannot tell
 * the difference.
 */
export async function orgFingerprint(orgId: string): Promise<Record<string, string>> {
  const org = sql.raw(`'${orgId}'::uuid`);
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM suppliers WHERE org_id = ${org}) AS suppliers,
      (SELECT coalesce(string_agg(name, ',' ORDER BY id::text),'-') FROM suppliers WHERE org_id = ${org}) AS supplier_names,
      (SELECT coalesce(sum(coalesce(lead_time_days,0)),0) FROM suppliers WHERE org_id = ${org}) AS supplier_lead_times,
      (SELECT count(*) FROM product_suppliers WHERE org_id = ${org}) AS product_suppliers,
      (SELECT count(*) FROM purchase_drafts WHERE org_id = ${org}) AS purchase_drafts,
      (SELECT coalesce(string_agg(status, ',' ORDER BY id::text),'-') FROM purchase_drafts WHERE org_id = ${org}) AS draft_statuses,
      (SELECT count(*) FROM purchase_draft_items i JOIN purchase_drafts d ON d.id = i.purchase_draft_id WHERE d.org_id = ${org}) AS draft_items,
      (SELECT coalesce(sum(i.quantity),0) FROM purchase_draft_items i JOIN purchase_drafts d ON d.id = i.purchase_draft_id WHERE d.org_id = ${org}) AS draft_item_qty,
      (SELECT count(*) FROM goods_receipts WHERE org_id = ${org}) AS goods_receipts,
      (SELECT coalesce(string_agg(status, ',' ORDER BY id::text),'-') FROM goods_receipts WHERE org_id = ${org}) AS receipt_statuses,
      (SELECT count(*) FROM inventory_transfers WHERE org_id = ${org}) AS transfers,
      (SELECT coalesce(string_agg(status, ',' ORDER BY id::text),'-') FROM inventory_transfers WHERE org_id = ${org}) AS transfer_statuses,
      (SELECT count(*) FROM locations WHERE org_id = ${org}) AS locations,
      (SELECT coalesce(string_agg(name, ',' ORDER BY id::text),'-') FROM locations WHERE org_id = ${org}) AS location_names,
      (SELECT coalesce(sum(is_default),0) FROM locations WHERE org_id = ${org}) AS default_locations,
      (SELECT count(*) FROM products WHERE org_id = ${org}) AS products,
      (SELECT coalesce(string_agg(name, ',' ORDER BY id::text),'-') FROM products WHERE org_id = ${org}) AS product_names,
      (SELECT coalesce(sum(stock),0) FROM product_location_stock WHERE org_id = ${org}) AS stock_total,
      (SELECT count(*) FROM inventory_movements WHERE org_id = ${org}) AS movements,
      (SELECT count(*) FROM customers WHERE org_id = ${org}) AS customers,
      (SELECT coalesce(string_agg(name, ',' ORDER BY id::text),'-') FROM customers WHERE org_id = ${org}) AS customer_names,
      (SELECT count(*) FROM promotions WHERE org_id = ${org}) AS promotions,
      (SELECT count(*) FROM loyalty_tiers WHERE org_id = ${org}) AS loyalty_tiers,
      (SELECT count(*) FROM overhead_expenses WHERE org_id = ${org}) AS expenses,
      (SELECT count(*) FROM gift_cards WHERE org_id = ${org}) AS gift_cards,
      (SELECT coalesce(sum(balance),0) FROM gift_cards WHERE org_id = ${org}) AS gift_card_balance,
      (SELECT coalesce(string_agg(status, ',' ORDER BY id::text),'-') FROM gift_cards WHERE org_id = ${org}) AS gift_card_statuses,
      (SELECT count(*) FROM orders WHERE org_id = ${org}) AS orders,
      (SELECT name FROM organizations WHERE id = ${org}) AS org_name
  `);
  const rows = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? (result as unknown as Record<string, unknown>[]);
  const row = rows[0];
  if (!row) throw new Error(`orgFingerprint: no row for org ${orgId}`);
  // Postgres returns bigints as strings; normalise everything so a diff reads cleanly.
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)]));
}

// ------------------------------------------------------------------- contexts

/** A request context with arbitrary extra headers — for forgery attempts. */
export async function apiWithHeaders(
  role: Role,
  extra: Record<string, string>,
): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { ...authHeaders(role), ...extra },
  });
}

/** No auth headers whatsoever. */
export async function apiAnonymous(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: BASE_URL });
}

// ----------------------------------------------------------------- assertions

/** Which of `needles` appear verbatim in `body`. Used to prove zero leakage. */
export function leakedValues(body: string, needles: (string | undefined)[]): string[] {
  return needles.filter((n): n is string => !!n && body.includes(n));
}

/**
 * Names the kind of internal detail that escaped into a response body.
 *
 * The SQL patterns are not hypothetical: the `*ErrorPayload` helpers in
 * server/services/*.ts fall back to `err.message` for anything that is not
 * their own error class, and drizzle embeds the full statement and its bound
 * parameters in that message.
 */
export function internalLeak(body: string): string | null {
  const patterns: [RegExp, string][] = [
    [/\bat\s+\S*\s*\(?\/[^\s)]+\.(ts|js):\d+:\d+/, "stack frame with absolute path"],
    [/\/home\/[^\s"]+\.(ts|js)/, "absolute source path"],
    [/node_modules\//, "node_modules path"],
    [/Failed query:/i, "driver error echoing the failed query"],
    [/\binsert\s+into\s+\\?"?[a-z_]+/i, "raw SQL INSERT"],
    [/\bupdate\s+\\?"?[a-z_]+\\?"?\s+set\b/i, "raw SQL UPDATE"],
    [/\bdelete\s+from\s+\\?"?[a-z_]+/i, "raw SQL DELETE"],
    [/\bselect\s+[^\s]+.*\bfrom\s+\\?"?[a-z_]+/i, "raw SQL SELECT"],
    [/postgres(ql)?:\/\//, "database connection string"],
    [/\bsk_(test|live)_/, "secret key material"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(body)) return label;
  }
  return null;
}
