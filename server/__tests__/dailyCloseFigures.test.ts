/**
 * v1.2.1 money audit (M12): the 06:00 close valued personal use at sale price
 * (its payment leg), not what the goods cost, and counted gift card and Card
 * (link) money as card. The card figure is the card terminal's; personal use
 * is the cost the till books for it.
 */
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dailyCloseRuns, orderExpenses, orderPayments, orders, organizations, orgNotifications } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;
const LONDON = "Europe/London";

describe.skipIf(!hasDb)("what the close counts as card and as personal use", () => {
  let db: (typeof import("../db"))["db"];
  let closeTradingDay: (typeof import("../services/dailyClose"))["closeTradingDay"];
  let orgId: string;

  async function sale(total: number, method: string, at: string, legAmount = total) {
    const [o] = await db
      .insert(orders)
      .values({ orgId, total: total.toFixed(2), settledTotal: total.toFixed(2), paymentMethod: method, status: "completed", createdAt: new Date(at), settledAt: new Date(at) } as never)
      .returning();
    await db.insert(orderPayments).values({ orgId, orderId: o.id, method, amount: legAmount.toFixed(2) });
    return o.id;
  }

  beforeEach(async () => {
    ({ db } = await import("../db"));
    ({ closeTradingDay } = await import("../services/dailyClose"));
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: "Close Figures Test", timezone: LONDON } as never);
  });

  afterEach(async () => {
    await db.delete(orgNotifications).where(eq(orgNotifications.orgId, orgId));
    await db.delete(dailyCloseRuns).where(eq(dailyCloseRuns.orgId, orgId));
    await db.delete(orderExpenses).where(eq(orderExpenses.orgId, orgId));
    await db.delete(orderPayments).where(eq(orderPayments.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("counts only card-terminal money as card, and personal use at cost", async () => {
    const day = "2026-03-02";
    await sale(40, "card", "2026-03-02T11:00:00Z");
    await sale(20, "gift_card", "2026-03-02T11:10:00Z");
    await sale(25, "card_link", "2026-03-02T11:20:00Z");
    // Two Widgets taken for personal use: £20 at sale price on its leg, £8 at cost.
    const personal = await sale(0, "personal_use", "2026-03-02T11:30:00Z", 20);
    await db.insert(orderExpenses).values({ orgId, orderId: personal, category: "personal_use", description: "Personal use", amount: "8.00" });

    await closeTradingDay(orgId, day, LONDON);
    const [run] = await db
      .select()
      .from(dailyCloseRuns)
      .where(and(eq(dailyCloseRuns.orgId, orgId), eq(dailyCloseRuns.tradingDay, day)));
    expect(parseFloat(String(run.cardSales))).toBe(40);
    expect(parseFloat(String(run.personalUseCost))).toBe(8);
    expect(parseFloat(String(run.grossSales))).toBe(85);
    expect(run.orderCount).toBe(3);
  });
});
