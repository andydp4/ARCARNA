/**
 * Seed script: creates default org, location (store), roles, and sample products.
 * Run after: npm run db:push
 * Usage: npx tsx scripts/seed.ts
 *
 * Creates:
 * - 1 organization
 * - 1 location (store)
 * - 4 allowed users (SUPER_ADMIN, ADMIN, MANAGER, CASHIER) with placeholder IDs
 * - Sample products
 */
import { db } from "../server/db";
import {
  organizations,
  locations,
  products,
  allowedUsers,
} from "../shared/schema";
import { ONBOARDING_STEPS } from "../shared/onboarding";
import { and, eq } from "drizzle-orm";

const SEED_ORG_NAME = "Arcarna Demo Org";
const SEED_LOCATION_NAME = "Main Store";
const SEED_PRODUCTS = [
  { productId: "COF-001", name: "Espresso", defaultSalePrice: "2.50", costPrice: "0.80", stock: 100 },
  { productId: "COF-002", name: "Latte", defaultSalePrice: "3.50", costPrice: "1.00", stock: 80 },
  { productId: "COF-003", name: "Cappuccino", defaultSalePrice: "3.50", costPrice: "1.00", stock: 75 },
  { productId: "TEA-001", name: "Black Tea", defaultSalePrice: "2.00", costPrice: "0.30", stock: 50 },
  { productId: "SNK-001", name: "Croissant", defaultSalePrice: "2.80", costPrice: "1.20", stock: 40 },
];

async function seed() {
  console.log("[Seed] Starting...");

  // Idempotent: re-running this script must reuse the seed org rather than
  // insert a second row of the same name. `organizations.name` carries no
  // unique constraint, so a bare insert-every-time silently forked the seed
  // identities (seed-admin/seed-cashier/seed-manager) from whichever org
  // `resolveOrgId()` happened to pick via `GET /api/orgs` — a real,
  // reproducible cause of org-id-mismatch test flakiness. Ordered by
  // createdAt so a repeat run is stable even against a database that already
  // has more than one (this script does not merge or delete those; that is a
  // separate, deliberately manual cleanup — see scripts/README or ask the
  // build lead).
  const [existingOrg] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, SEED_ORG_NAME))
    .orderBy(organizations.createdAt)
    .limit(1);

  let org: typeof organizations.$inferSelect;
  if (existingOrg) {
    org = existingOrg;
    console.log("[Seed] Reusing existing org:", org.id, org.name);
  } else {
    const [created] = await db
      .insert(organizations)
      // This seed produces a complete org — location, products, role users, and
      // the first sale below — so leaving it "not set up" sent the SPA to a
      // wizard on every navigation: setup_complete = 0 to /setup-wizard, and an
      // empty onboarding_state to /onboarding/wizard. Locally that was masked
      // (the SessionStart hook patches setup_complete, and this dev database had
      // onboarding clicked through by hand long ago), so the browser journeys
      // passed here while testing a wizard on a fresh CI database. The seed owns
      // the state it creates.
      .values({
        name: SEED_ORG_NAME,
        setupComplete: 1,
        onboardingState: { completedSteps: [...ONBOARDING_STEPS] },
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create organization");
    }
    org = created;
    console.log("[Seed] Created org:", org.id, org.name);
  }

  const [existingLocation] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.orgId, org.id), eq(locations.name, SEED_LOCATION_NAME)))
    .limit(1);

  let location: typeof locations.$inferSelect;
  if (existingLocation) {
    location = existingLocation;
    console.log("[Seed] Reusing existing location:", location.id, location.name);
  } else {
    const [created] = await db
      .insert(locations)
      .values({
        orgId: org.id,
        name: SEED_LOCATION_NAME,
        address: "123 High Street",
        city: "London",
        state: "LD",
        zipCode: "SW1A 1AA",
        phone: "+44 20 7946 0958",
        email: "store@arcarna-demo.local",
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create location");
    }
    location = created;
    console.log("[Seed] Created location:", location.id, location.name);
  }

  const roleUsers = [
    { replitUserId: "seed-super-admin", name: "Super Admin", email: "superadmin@seed.local", role: "SUPER_ADMIN" as const, orgId: null },
    { replitUserId: "seed-admin", name: "Admin", email: "admin@seed.local", role: "ADMIN" as const, orgId: org.id },
    { replitUserId: "seed-manager", name: "Manager", email: "manager@seed.local", role: "MANAGER" as const, orgId: org.id },
    { replitUserId: "seed-cashier", name: "Cashier", email: "cashier@seed.local", role: "CASHIER" as const, orgId: org.id },
  ];

  for (const u of roleUsers) {
    await db
      .insert(allowedUsers)
      .values({
        replitUserId: u.replitUserId,
        email: u.email,
        name: u.name,
        isOwner: u.role === "SUPER_ADMIN" ? 1 : 0,
        orgId: u.orgId,
        role: u.role,
      })
      .onConflictDoUpdate({
        target: allowedUsers.replitUserId,
        set: { orgId: u.orgId, role: u.role, name: u.name, email: u.email },
      });
  }
  console.log("[Seed] Created/updated 4 role users (SUPER_ADMIN, ADMIN, MANAGER, CASHIER)");

  // No unique constraint backs (orgId, productId), so re-run safety is a
  // manual existence check per product rather than onConflictDoNothing.
  let productsCreated = 0;
  for (const p of SEED_PRODUCTS) {
    const [existingProduct] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.orgId, org.id), eq(products.productId, p.productId)))
      .limit(1);

    if (existingProduct) continue;

    await db.insert(products).values({
      orgId: org.id,
      productId: p.productId,
      name: p.name,
      defaultSalePrice: p.defaultSalePrice,
      costPrice: p.costPrice,
      stock: p.stock,
      stockLimit: 20,
    });
    productsCreated++;
  }
  console.log(
    `[Seed] Products ensured: ${SEED_PRODUCTS.length} (${productsCreated} created, ${SEED_PRODUCTS.length - productsCreated} already present)`,
  );

  console.log("[Seed] Done. Org ID:", org.id, "| Location ID:", location.id);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[Seed] Error:", err);
    process.exit(1);
  });
