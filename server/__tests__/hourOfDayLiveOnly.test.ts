/**
 * ARC-028: a backdated or pre-order sale is stamped with `created_at` at
 * noon local on the day it is FOR (`DATED_ORDER_HOUR`,
 * shared/orders/orderDate.ts) — a placeholder, not the real time of day the
 * sale happened. Busiest Hours bucketed every order by `created_at` hour
 * regardless of `date_kind`, so backdated sales piled onto that placeholder
 * hour (11:00 in Europe/London during BST) and inflated it. This asserts a
 * backdated order contributes nothing to Busiest Hours, while an ordinary
 * live order at the same hour still counts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { orders, organizations } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

/** An instant `daysAgo` days back from now, at a fixed UTC hour — safely inside the rolling analytics window regardless of when the suite runs. */
function recentAt(daysAgo: number, utcHour: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(utcHour, 0, 0, 0);
  return d;
}

describe.skipIf(!hasDb)("Busiest Hours excludes backdated/pre-order placeholder timestamps", () => {
  let orgId: string;
  let db: (typeof import("../db"))["db"];
  let getHourOfDayAnalytics: (typeof import("../services/hourOfDayService"))["getHourOfDayAnalytics"];

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ getHourOfDayAnalytics } = await import("../services/hourOfDayService"));
    orgId = randomUUID();
    // No explicit timezone → defaults to Europe/London, same as production.
    await db.insert(organizations).values({ id: orgId, name: "Hour Of Day Test" });
  });

  afterEach(async () => {
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("excludes a backdated order's placeholder-noon hour from the buckets", async () => {
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "80.00",
      paymentMethod: "cash",
      status: "completed",
      dateKind: "backdated",
      // The DATED_ORDER_HOUR placeholder stamp (noon local) — not a real
      // sale-time hour.
      createdAt: recentAt(3, 12),
    } as never);

    const { buckets } = await getHourOfDayAnalytics(orgId, 12);
    const totalTxns = buckets.reduce((sum, b) => sum + b.txns, 0);

    expect(totalTxns).toBe(0);
  });

  it("still counts an ordinary live order at its real hour", async () => {
    await db.insert(orders).values({
      id: randomUUID(),
      orgId,
      total: "80.00",
      paymentMethod: "cash",
      status: "completed",
      dateKind: "live",
      createdAt: recentAt(3, 18),
    } as never);

    const { buckets } = await getHourOfDayAnalytics(orgId, 12);
    const totalTxns = buckets.reduce((sum, b) => sum + b.txns, 0);

    expect(totalTxns).toBe(1);
  });
});
