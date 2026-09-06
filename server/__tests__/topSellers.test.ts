/**
 * Top sellers feed the one-tap chips on the order form, so the ranking has to
 * be by units, org-scoped, and limited to sales that actually went out.
 *
 * Runs against a real database (imports ../db), so it is excluded from the
 * no-DB run in vitest.config.ts.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { orderItems, orders, organizations, products } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("top selling products", () => {
  let db: (typeof import("../db"))["db"];
  let topSellingProducts: (typeof import("../services/topSellers"))["topSellingProducts"];
  let orgId: string;
  let otherOrgId: string;
  let steady: string;
  let occasional: string;
  let heldOnly: string;
  let foreign: string;

  async function sale(org: string, productId: string, quantity: number, status = "completed", when = new Date()) {
    const [order] = await db
      .insert(orders)
      .values({ orgId: org, total: "10.00", paymentMethod: "cash", status, createdAt: when } as never)
      .returning();
    await db.insert(orderItems).values({
      orgId: org,
      orderId: order.id,
      productId,
      quantity,
      unitPrice: "1.00",
      totalPrice: String(quantity),
    } as never);
  }

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ topSellingProducts } = await import("../services/topSellers"));
    orgId = randomUUID();
    otherOrgId = randomUUID();
    await db.insert(organizations).values([
      { id: orgId, name: "Top Sellers Test" },
      { id: otherOrgId, name: "Top Sellers Other" },
    ]);
    const mk = async (org: string, name: string) => {
      const [p] = await db
        .insert(products)
        .values({ orgId: org, name, productId: `${name}-${randomUUID().slice(0, 8)}`, defaultSalePrice: "1.00" } as never)
        .returning();
      return p.id as string;
    };
    steady = await mk(orgId, "Steady");
    occasional = await mk(orgId, "Occasional");
    heldOnly = await mk(orgId, "HeldOnly");
    foreign = await mk(otherOrgId, "Foreign");

    // A till sale is "pending" until collected; it is still a sale.
    await sale(orgId, steady, 5, "pending");
    await sale(orgId, steady, 7);
    await sale(orgId, occasional, 3);
    // Held for review (oversold) is not a sale, however big.
    await sale(orgId, heldOnly, 50, "on-hold");
    await sale(otherOrgId, foreign, 100);
    // Old enough to fall outside a 30-day window.
    await sale(orgId, occasional, 40, "completed", new Date(Date.now() - 45 * 86_400_000));
  });

  afterEach(async () => {
    for (const org of [orgId, otherOrgId]) {
      await db.delete(orderItems).where(eq(orderItems.orgId, org));
      await db.delete(orders).where(eq(orders.orgId, org));
      await db.delete(products).where(eq(products.orgId, org));
      await db.delete(organizations).where(eq(organizations.id, org));
    }
  });

  it("ranks by units, within the org, within the window, real sales only", async () => {
    const rows = await topSellingProducts(orgId, { days: 30 });
    expect(rows.map((r) => r.productId)).toEqual([steady, occasional]);
    expect(rows[0].units).toBe(12);
    expect(rows[1].units).toBe(3);
  });

  it("widens with the window and honours the limit", async () => {
    const wide = await topSellingProducts(orgId, { days: 90 });
    expect(wide.map((r) => r.productId)).toEqual([occasional, steady]);
    expect(wide[0].units).toBe(43);

    const one = await topSellingProducts(orgId, { days: 90, limit: 1 });
    expect(one).toHaveLength(1);
  });
});
