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

const SEED_ORG_NAME = "Midnight Demo Org";
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

  const [org] = await db
    .insert(organizations)
    .values({ name: SEED_ORG_NAME })
    .returning();

  if (!org) {
    throw new Error("Failed to create organization");
  }
  console.log("[Seed] Created org:", org.id, org.name);

  const [location] = await db
    .insert(locations)
    .values({
      orgId: org.id,
      name: SEED_LOCATION_NAME,
      address: "123 High Street",
      city: "London",
      state: "LD",
      zipCode: "SW1A 1AA",
      phone: "+44 20 7946 0958",
      email: "store@midnight-demo.local",
    })
    .returning();

  if (!location) {
    throw new Error("Failed to create location");
  }
  console.log("[Seed] Created location:", location.id, location.name);

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

  for (const p of SEED_PRODUCTS) {
    await db.insert(products).values({
      orgId: org.id,
      productId: p.productId,
      name: p.name,
      defaultSalePrice: p.defaultSalePrice,
      costPrice: p.costPrice,
      stock: p.stock,
      stockLimit: 20,
    });
  }
  console.log("[Seed] Created sample products:", SEED_PRODUCTS.length);

  console.log("[Seed] Done. Org ID:", org.id, "| Location ID:", location.id);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[Seed] Error:", err);
    process.exit(1);
  });
