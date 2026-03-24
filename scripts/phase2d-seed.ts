/**
 * Phase 2D Multi-Org Isolation Test Seed
 * Creates Org A, Org B, locations, users, products, customers, orders.
 * No hardcoded IDs - all generated.
 *
 * Run: PHASE2D_TEST=1 npx tsx scripts/phase2d-seed.ts
 */
import { db } from "../server/db";
import {
  organizations,
  locations,
  products,
  customers,
  orders,
  orderItems,
  overheadExpenses,
  allowedUsers,
} from "../shared/schema";
export interface Phase2DSeedResult {
  orgA: { id: string; locationId: string; productId: string; customerId: string; orderId: string };
  orgB: { id: string; locationId: string; productId: string; customerId: string; orderId: string };
  users: {
    superAdmin: string;
    adminA: string;
    managerA: string;
    cashierA: string;
    cashierB: string;
  };
}

async function seed(): Promise<Phase2DSeedResult> {
  console.log("[Phase2D Seed] Creating Org A...");
  const [orgA] = await db
    .insert(organizations)
    .values({ name: "Phase2D Org A" })
    .returning();
  if (!orgA) throw new Error("Failed to create Org A");
  const orgAId = orgA.id;

  console.log("[Phase2D Seed] Creating Org B...");
  const [orgB] = await db
    .insert(organizations)
    .values({ name: "Phase2D Org B" })
    .returning();
  if (!orgB) throw new Error("Failed to create Org B");
  const orgBId = orgB.id;

  console.log("[Phase2D Seed] Creating locations...");
  const [locA] = await db
    .insert(locations)
    .values({
      orgId: orgAId,
      name: "Store A",
      address: "1 Org A Street",
      city: "London",
      state: "LD",
      zipCode: "SW1A 1AA",
      phone: "+441234567890",
      email: "store-a@phase2d.local",
    })
    .returning();
  const [locB] = await db
    .insert(locations)
    .values({
      orgId: orgBId,
      name: "Store B",
      address: "2 Org B Avenue",
      city: "Birmingham",
      state: "BH",
      zipCode: "B1 1AA",
      phone: "+441234567891",
      email: "store-b@phase2d.local",
    })
    .returning();
  if (!locA || !locB) throw new Error("Failed to create locations");
  const locAId = locA.id;
  const locBId = locB.id;

  console.log("[Phase2D Seed] Creating allowed users...");
  const userIds = {
    superAdmin: "phase2d-super-admin",
    adminA: "phase2d-admin-a",
    managerA: "phase2d-manager-a",
    cashierA: "phase2d-cashier-a",
    cashierB: "phase2d-cashier-b",
  };
  const usersToInsert = [
    { replitUserId: userIds.superAdmin, name: "Super Admin", email: "sa@phase2d.local", isOwner: 1, orgId: null, role: "SUPER_ADMIN" as const },
    { replitUserId: userIds.adminA, name: "Admin A", email: "admin-a@phase2d.local", isOwner: 0, orgId: orgAId, role: "ADMIN" as const },
    { replitUserId: userIds.managerA, name: "Manager A", email: "manager-a@phase2d.local", isOwner: 0, orgId: orgAId, role: "MANAGER" as const },
    { replitUserId: userIds.cashierA, name: "Cashier A", email: "cashier-a@phase2d.local", isOwner: 0, orgId: orgAId, role: "CASHIER" as const },
    { replitUserId: userIds.cashierB, name: "Cashier B", email: "cashier-b@phase2d.local", isOwner: 0, orgId: orgBId, role: "CASHIER" as const },
  ];
  for (const u of usersToInsert) {
    await db.insert(allowedUsers).values(u).onConflictDoUpdate({
      target: allowedUsers.replitUserId,
      set: { orgId: u.orgId, role: u.role, name: u.name, email: u.email },
    });
  }

  console.log("[Phase2D Seed] Creating products...");
  const [prodA] = await db
    .insert(products)
    .values({
      orgId: orgAId,
      productId: `P2D-A-${Date.now()}`,
      name: "Product Org A",
      defaultSalePrice: "10.00",
      costPrice: "5.00",
      stock: 50,
      stockLimit: 20,
    })
    .returning();
  const [prodB] = await db
    .insert(products)
    .values({
      orgId: orgBId,
      productId: `P2D-B-${Date.now()}`,
      name: "Product Org B",
      defaultSalePrice: "20.00",
      costPrice: "8.00",
      stock: 30,
      stockLimit: 15,
    })
    .returning();
  if (!prodA || !prodB) throw new Error("Failed to create products");

  console.log("[Phase2D Seed] Creating customers...");
  const [custA] = await db
    .insert(customers)
    .values({
      orgId: orgAId,
      name: "Customer Org A",
      email: "cust-a@phase2d.local",
      phone: "+441111111111",
    })
    .returning();
  const [custB] = await db
    .insert(customers)
    .values({
      orgId: orgBId,
      name: "Customer Org B",
      email: "cust-b@phase2d.local",
      phone: "+442222222222",
    })
    .returning();
  if (!custA || !custB) throw new Error("Failed to create customers");

  console.log("[Phase2D Seed] Creating orders...");
  const [orderA] = await db
    .insert(orders)
    .values({
      orgId: orgAId,
      locationId: locAId,
      customerId: custA.id,
      total: "10.00",
      paymentMethod: "card",
      status: "completed",
    })
    .returning();
  const [orderB] = await db
    .insert(orders)
    .values({
      orgId: orgBId,
      locationId: locBId,
      customerId: custB.id,
      total: "20.00",
      paymentMethod: "cash",
      status: "completed",
    })
    .returning();
  if (!orderA || !orderB) throw new Error("Failed to create orders");

  await db.insert(orderItems).values([
    { orgId: orgAId, orderId: orderA.id, productId: prodA.id, quantity: 1, unitPrice: "10.00", totalPrice: "10.00" },
    { orgId: orgBId, orderId: orderB.id, productId: prodB.id, quantity: 1, unitPrice: "20.00", totalPrice: "20.00" },
  ]);

  console.log("[Phase2D Seed] Done.");
  return {
    orgA: { id: orgAId, locationId: locAId, productId: prodA.id, customerId: custA.id, orderId: orderA.id },
    orgB: { id: orgBId, locationId: locBId, productId: prodB.id, customerId: custB.id, orderId: orderB.id },
    users: userIds,
  };
}

seed()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("[Phase2D Seed] Error:", err);
    process.exit(1);
  });

export { seed as phase2dSeed };
