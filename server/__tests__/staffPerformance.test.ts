/**
 * Staff Performance and Order Timing by person (v1.2 Phase 7A/7B), against a
 * real database.
 *
 *  - Last week lists everyone who worked, keyed by login (the Staff KPI
 *    rebuild, STF-01).
 *  - Staff rows + Admin cover + Unattributed = Total = gross settled sales,
 *    the figure sales Evidence reads (`settledRevenueByTradingDay`).
 *  - Q14 on the server: a manager sees cashiers and themselves, is refused
 *    another manager's drill-down, and a cashier is refused the page.
 *  - Customers appear by name only in the drill-down.
 *  - Migration 170 stamps each actor's station on the order events they write.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml).
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { allowedUsers, customers, orderEvents, orderItems, opsStaff, orders, organizations, refunds } from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;
const tag = randomUUID().slice(0, 8);
const id = (who: string) => `perf_${who}_${tag}`;
const CARA = id("cara");
const CODY = id("cody");
const MIA = id("mia");
const MAX = id("max");
const ADA = id("ada");

// Mon 12 – Sun 18 January 2026: GMT, so trading days are 06:00Z to 06:00Z.
const WEEK = { from: "2026-01-12", to: "2026-01-18" };
const at = (day: number, hhmm: string) => new Date(`2026-01-${String(day).padStart(2, "0")}T${hhmm}:00.000Z`);

describe.skipIf(!hasDb)("Staff Performance on real orders", () => {
  let db: (typeof import("../db"))["db"];
  let orgId: string;
  let customerId: string;
  const orderIds: Record<string, string> = {};

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, name: `Staff Performance ${tag}`, timezone: "Europe/London" } as never);
    await db.insert(allowedUsers).values(
      [
        [CARA, "Cara Cashier", "CASHIER"],
        [CODY, "Cody Cashier", "CASHIER"],
        [MIA, "Mia Manager", "MANAGER"],
        [MAX, "Max Manager", "MANAGER"],
        [ADA, "Ada Admin", "ADMIN"],
      ].map(([u, name, role]) => ({ replitUserId: u, authUserId: u, name, role, orgId })) as never,
    );
    // Stations before any event is written, so the trigger has something to stamp.
    await db.insert(opsStaff).values([
      { orgId, userId: MIA, station: "collection" },
      { orgId, userId: MAX, station: null },
    ]);
    const [c] = await db
      .insert(customers)
      .values({ orgId, name: "Priya Shah", phone: "07700 900123", email: "priya@example.invalid" })
      .returning();
    customerId = c.id;

    const make = async (key: string, v: Partial<typeof orders.$inferInsert>) => {
      const [o] = await db
        .insert(orders)
        .values({ orgId, total: "0.00", paymentMethod: "cash", status: "completed", ...v } as never)
        .returning();
      orderIds[key] = o.id;
      return o.id;
    };
    const done = (total: string, day: number, extra: Partial<typeof orders.$inferInsert>) => ({
      total,
      settledTotal: total,
      settledAt: at(day, "12:00"),
      enteredAt: at(day, "11:00"),
      createdAt: at(day, "11:00"),
      ...extra,
    });

    await make("solo", done("20.00", 12, { inputUserId: CARA, completedUserId: CARA, customerId }));
    await make("grab", done("50.00", 13, { inputUserId: CODY, completedUserId: CARA, assignedUserId: CODY }));
    await make("delivery", done("30.00", 14, { inputUserId: MIA, completedUserId: CODY, fulfilmentMethod: "delivery" }));
    await make("cover", done("40.00", 15, { inputUserId: CARA, completedUserId: ADA }));
    await make("nobody", done("12.34", 15, { completedUserId: null }));
    await make("personal", done("0.00", 16, { inputUserId: CARA, completedUserId: CARA, paymentMethod: "personal_use", personalUseReason: "Staff lunch" }));
    await make("maxSolo", done("25.00", 17, { inputUserId: MAX, completedUserId: MAX }));
    await make("lastWeek", done("99.00", 6, { inputUserId: CARA, completedUserId: CARA }));
    await make("open", { total: "18.00", status: "pending", inputUserId: CODY, enteredAt: at(16, "10:00"), createdAt: at(16, "10:00") });

    await db.insert(orderItems).values({ orgId, orderId: orderIds.solo, quantity: 2, unitPrice: "10.00", totalPrice: "20.00" });
    await db.insert(orderEvents).values([
      { orgId, orderId: orderIds.delivery, kind: "ready", userId: MIA, at: at(14, "11:20") },
      { orgId, orderId: orderIds.delivery, kind: "out_for_delivery", userId: MAX, at: at(14, "11:30") },
      { orgId, orderId: orderIds.solo, kind: "reopened", userId: ADA, at: at(12, "13:00"), meta: { completedUserId: CARA } },
    ]);
    await db.insert(refunds).values({
      orderId: orderIds.grab,
      orgId,
      cashierId: CARA,
      reason: "wrong_item",
      refundMethod: "cash",
      total: "5.00",
      createdAt: at(13, "15:00"),
    });
  });

  afterAll(async () => {
    if (!orgId) return;
    await db.delete(refunds).where(eq(refunds.orgId, orgId));
    await db.delete(orderEvents).where(eq(orderEvents.orgId, orgId));
    await db.delete(orderItems).where(eq(orderItems.orgId, orgId));
    await db.delete(orders).where(eq(orders.orgId, orgId));
    await db.delete(customers).where(eq(customers.orgId, orgId));
    await db.delete(opsStaff).where(eq(opsStaff.orgId, orgId));
    await db.delete(allowedUsers).where(inArray(allowedUsers.replitUserId, [CARA, CODY, MIA, MAX, ADA]));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  const admin = { userId: ADA, role: "ADMIN" };
  const run = async (viewer: { userId: string; role: string }) => {
    const { staffPerformance } = await import("../services/staffPerformance");
    return staffPerformance(orgId, { fromIso: WEEK.from, toIso: WEEK.to, adminCover: true }, viewer);
  };

  it("last week lists everyone who worked, by login and name — including someone who only loaded and prepared", async () => {
    const report = await run(admin);
    expect(report.rows.map((r) => r.name).sort()).toEqual(["Cara Cashier", "Cody Cashier", "Max Manager", "Mia Manager"]);
    const cara = report.rows.find((r) => r.userId === CARA)!;
    expect(cara.completed).toBe(2); // solo + the card she took at handover; personal use is not a sale
    expect(cara.salesCompleted).toBe(70);
    expect(cara.valueBroughtIn).toBe(20 + 45 + 4); // 100% solo, 90% of Cody's, 10% of the admin-covered order
    expect(cara.completedOthers).toBe(1);
    expect(cara.reopens).toBe(1);
    expect(cara.refundsProcessed).toBe(1);
    expect(cara.previous.salesCompleted).toBe(99);
    const mia = report.rows.find((r) => r.userId === MIA)!;
    expect(mia.loaded).toBe(1);
    expect(mia.prepared).toBe(1);
    expect(mia.completed).toBe(0);
    const cody = report.rows.find((r) => r.userId === CODY)!;
    expect(cody.delivered).toBe(1);
    expect(cody.stillOpen).toBe(1);
    expect(report.rows.find((r) => r.userId === MAX)!.dispatched).toBe(1);
    // The £5 wrong-item refund is against the order Cody loaded and nobody prepared separately — Cara completed (picked) it.
    expect(cara.wrongItemOrders).toBe(1);
  });

  it("staff rows + Admin cover + Unattributed = Total = gross settled sales from sales Evidence", async () => {
    const report = await run(admin);
    const pence = (v: number) => Math.round(v * 100);
    const staff = report.rows.reduce((s, r) => s + pence(r.salesCompleted), 0);
    const parts = staff + pence(report.team.adminCover!.salesCompleted) + pence(report.team.unattributed.salesCompleted);
    expect(parts).toBe(pence(report.team.total.salesCompleted));
    expect(report.team.total.salesCompleted).toBe(report.grossSettledSales);

    const { settledRevenueByTradingDay } = await import("../services/revenue");
    const byDay = await settledRevenueByTradingDay(orgId, "Europe/London", WEEK.from, WEEK.to);
    let evidenceGross = 0;
    for (const day of byDay.values()) evidenceGross += pence(day.revenue + day.refundsTotal);
    expect(parts).toBe(evidenceGross);
    expect(evidenceGross).toBe(pence(20 + 50 + 30 + 40 + 12.34 + 25));

    const value = report.rows.reduce((s, r) => s + pence(r.valueBroughtIn), 0);
    expect(value + pence(report.team.adminCover!.valueBroughtIn) + pence(report.team.unattributed.valueBroughtIn)).toBe(evidenceGross);
    expect(report.team.adminCover!.salesCompleted).toBe(40);
    expect(report.team.unattributed.salesCompleted).toBe(12.34);
  });

  it("a manager sees cashiers and themselves; other managers stay in the Total, unlisted", async () => {
    const report = await run({ userId: MIA, role: "MANAGER" });
    expect(report.rows.map((r) => r.userId).sort()).toEqual([CARA, CODY, MIA].sort());
    expect(report.hiddenPeople).toBe(1);
    expect(report.team.total.salesCompleted).toBe((await run(admin)).team.total.salesCompleted);
  });

  it("filters by fulfilment and hides Admin cover on request, without changing what the rows mean", async () => {
    const { staffPerformance } = await import("../services/staffPerformance");
    const delivery = await staffPerformance(orgId, { fromIso: WEEK.from, toIso: WEEK.to, fulfilment: "delivery", adminCover: false }, admin);
    expect(delivery.grossSettledSales).toBe(30);
    expect(delivery.team.adminCover).toBeNull();
    expect(delivery.rows.find((r) => r.userId === CODY)?.completed).toBe(1);
  });

  describe("the routes", () => {
    const appAs = async (userId: string, role: string) => {
      const { registerStaffPerformanceRoutes } = await import("../routes/staffPerformance");
      const scoped: RequestHandler = (req: any, _res, next) => {
        req.orgContext = { orgId, locationId: null, role };
        req.user = { id: userId, role };
        next();
      };
      const app = express();
      registerStaffPerformanceRoutes(app as never, [scoped]);
      return app;
    };
    const q = `from=${WEEK.from}&to=${WEEK.to}`;

    it("a cashier is refused; a manager is refused another manager's drill-down but not a cashier's", async () => {
      await request(await appAs(CARA, "CASHIER")).get(`/api/evidence/staff-performance?${q}`).expect(403);
      await request(await appAs(CARA, "CASHIER")).get(`/api/evidence/order-timing?${q}`).expect(403);
      const mia = await appAs(MIA, "MANAGER");
      await request(mia).get(`/api/evidence/staff-performance/${MAX}?${q}`).expect(403);
      await request(mia).get(`/api/evidence/staff-performance/nobody_${tag}?${q}`).expect(404);
      const res = await request(mia).get(`/api/evidence/staff-performance/${CARA}?${q}`).expect(200);
      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.body.trend).toHaveLength(8);
      expect(res.body.trend[7].weekStart).toBe("2026-01-12");
      expect(res.body.trend[7].salesCompleted).toBe(70);
      expect(res.body.trend[6].salesCompleted).toBe(99);
    });

    it("the drill-down names the customer and nothing else about them", async () => {
      const res = await request(await appAs(ADA, "ADMIN")).get(`/api/evidence/staff-performance/${CARA}?${q}`).expect(200);
      const solo = res.body.orders.find((o: { orderId: string }) => o.orderId === orderIds.solo);
      expect(solo.customerName).toBe("Priya Shah");
      expect(solo.jobs).toEqual(["loaded", "completed"]);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain("900123");
      expect(text).not.toContain("priya@example.invalid");
      // Admins are Admin cover in the list, but their own drill-down still works.
      const ada = await request(await appAs(ADA, "ADMIN")).get(`/api/evidence/staff-performance/${ADA}?${q}`).expect(200);
      expect(ada.body.figures.salesCompleted).toBe(40);
    });

    it("Order Timing groups by person with names, cut the same way", async () => {
      const mia = await appAs(MIA, "MANAGER");
      const res = await request(mia).get(`/api/evidence/order-timing?${q}&groupBy=completer`).expect(200);
      const labels = res.body.groups.map((g: { label: string }) => g.label);
      expect(labels).toContain("Cara Cashier");
      expect(labels).not.toContain("Max Manager");
      expect(labels).not.toContain("Ada Admin");
      expect(res.body.hiddenGroups).toBe(2);
      const hours = await request(mia).get(`/api/evidence/order-timing?${q}&groupBy=hour`).expect(200);
      expect(hours.body.groups.map((g: { label: string }) => g.label)).toContain("11:00–11:59");
      expect(hours.body.provisional).toBe(false);
      await request(mia).get(`/api/evidence/order-timing?${q}&groupBy=station`).expect(400);
    });
  });

  it("stamps each actor's station on the events they write (migration 170)", async () => {
    const rows = await db
      .select({ kind: orderEvents.kind, station: orderEvents.station })
      .from(orderEvents)
      .where(eq(orderEvents.orgId, orgId));
    const byKind = new Map(rows.map((r) => [r.kind, r.station]));
    expect(byKind.get("ready")).toBe("collection"); // Mia's station
    expect(byKind.get("out_for_delivery")).toBe("all"); // Max has no station set: "All"
    expect(byKind.get("reopened")).toBeNull(); // Ada has never opened the board
  });
});
