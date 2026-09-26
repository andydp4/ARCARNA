/**
 * Staff and pay (v1.2 Phase 0B part 5, STF-FN4 / FIX-10) against a real
 * database: shift sheets by whose they are, the staff list without PINs or
 * (below admin) rates, and commission payments nobody can confirm for
 * themselves. The owner's check: "a cashier cannot open a colleague's shift".
 *
 * Whose sheet a manager may read depends on the colleague's role in
 * allowed_users, so this needs the real table. In CI's unit-db job by
 * explicit file name.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("staff and pay lock-down", () => {
  let db: (typeof import("../db"))["db"];
  let schema: typeof import("@shared/schema");
  let app: express.Express;
  const orgId = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const id = (who: string) => `stf-${who}-${tag}`;
  const roles: Record<string, string> = {
    cashierA: "CASHIER",
    cashierB: "CASHIER",
    managerM: "MANAGER",
    managerN: "MANAGER",
    admin: "ADMIN",
  };
  let as = "cashierA";
  const cashierShift: Record<string, string> = {};
  const tillShift: Record<string, string> = {};
  let codedShiftId = "";
  let locationId = "";

  beforeAll(async () => {
    process.env.DEV_AUTH_BYPASS = "0";
    ({ db } = await import("../db"));
    schema = await import("@shared/schema");
    await db.insert(schema.organizations).values({ id: orgId, name: "ZZ Staff Pay Test" });
    await db.insert(schema.allowedUsers).values(
      Object.entries(roles).map(([who, role]) => ({
        replitUserId: id(who),
        authUserId: id(who),
        name: who,
        role: role as any,
        orgId,
      })),
    );
    const [location] = await db
      .insert(schema.locations)
      .values({ orgId, name: "Till", address: "1 St", city: "X", state: "X", zipCode: "X1", phone: "0", email: "t@example.invalid" })
      .returning();
    locationId = location.id;

    for (const who of ["cashierA", "cashierB", "managerM", "managerN", "admin"]) {
      const [cs] = await db
        .insert(schema.cashierShifts)
        .values({ orgId, userId: id(who), openedByUserId: id(who), status: "closed" })
        .returning();
      cashierShift[who] = cs.id;
      const [ts] = await db
        .insert(schema.shifts)
        .values({ orgId, locationId, userId: id(who), status: "closed" })
        .returning();
      tillShift[who] = ts.id;
    }
    const [profile] = await db
      .insert(schema.cashierProfiles)
      .values({ orgId, cashierCode: `C${tag}`.slice(0, 20), displayName: "Coded", pinCode: "9876", defaultCommissionRate: "12.50" })
      .returning();
    const [coded] = await db
      .insert(schema.cashierShifts)
      .values({ orgId, cashierId: profile.id, openedByUserId: id("cashierA"), status: "closed" })
      .returning();
    codedShiftId = coded.id;

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role: roles[as] };
      req.user = { id: id(as), role: roles[as], claims: { sub: id(as) } };
      next();
    };
    const { registerCashierRoutes } = await import("../routes/cashiers");
    const { registerShiftRoutes } = await import("../routes/shifts");
    app = express();
    app.use(express.json());
    registerCashierRoutes(app, [scoped]);
    registerShiftRoutes(app, [scoped]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.cashierCommissionPayments).where(eq(schema.cashierCommissionPayments.orgId, orgId));
    await db.delete(schema.cashierShifts).where(eq(schema.cashierShifts.orgId, orgId));
    await db.delete(schema.cashierProfiles).where(eq(schema.cashierProfiles.orgId, orgId));
    await db.delete(schema.shifts).where(eq(schema.shifts.orgId, orgId));
    await db.delete(schema.locations).where(eq(schema.locations.orgId, orgId));
    await db.delete(schema.adminAuditLogs).where(eq(schema.adminAuditLogs.orgId, orgId));
    await db.delete(schema.orgNotifications).where(eq(schema.orgNotifications.orgId, orgId));
    await db.delete(schema.allowedUsers).where(inArray(schema.allowedUsers.replitUserId, Object.keys(roles).map(id)));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
  });

  const get = (who: string, path: string) => {
    as = who;
    return request(app).get(path);
  };

  describe("shift sheets", () => {
    it("a cashier's lists hold only their own shifts", async () => {
      const cs = await get("cashierA", "/api/cashier-shifts").expect(200);
      expect(cs.body.map((s: any) => s.id).sort()).toEqual([cashierShift.cashierA, codedShiftId].sort());
      const till = await get("cashierA", "/api/shifts?hours=168").expect(200);
      expect(till.body.map((s: any) => s.id)).toEqual([tillShift.cashierA]);
    });

    it("a cashier cannot open a colleague's shift sheet", async () => {
      await get("cashierA", `/api/cashier-shifts/${cashierShift.cashierA}/summary`).expect(200);
      const other = await get("cashierA", `/api/cashier-shifts/${cashierShift.cashierB}/summary`).expect(403);
      expect(other.body.message).toMatch(/own shift sheet/);
      await get("cashierA", `/api/shifts/${tillShift.cashierB}/report`).expect(403);
      await get("cashierA", `/api/shifts/${tillShift.managerM}/report`).expect(403);
    });

    it("a manager reads cashiers' and their own, not another manager's or an admin's", async () => {
      const cs = await get("managerM", "/api/cashier-shifts").expect(200);
      const ids = new Set(cs.body.map((s: any) => s.id));
      expect(ids.has(cashierShift.cashierA)).toBe(true);
      expect(ids.has(cashierShift.cashierB)).toBe(true);
      expect(ids.has(cashierShift.managerM)).toBe(true);
      expect(ids.has(codedShiftId)).toBe(true);
      expect(ids.has(cashierShift.managerN)).toBe(false);
      expect(ids.has(cashierShift.admin)).toBe(false);

      await get("managerM", `/api/cashier-shifts/${cashierShift.managerN}/summary`).expect(403);
      await get("managerM", `/api/shifts/${tillShift.admin}/report`).expect(403);
      await get("managerM", `/api/shifts/${tillShift.cashierB}/report`).expect(200);
    });

    it("a cashier's own sheet carries no cost and no rate; a manager's view no rate (Q6, Q16)", async () => {
      await db.insert(schema.cashierShiftSummaries).values({
        orgId,
        shiftId: cashierShift.cashierA,
        userId: id("cashierA"),
        closedAt: new Date(),
        grossSales: "20.00",
        stockCost: "13.37",
        netSalesProfit: "6.63",
        businessRetainedProfit: "5.30",
        commissionRate: "12.50",
        commissionAmount: "1.33",
      } as any);
      try {
        const own = await get("cashierA", `/api/cashier-shifts/${cashierShift.cashierA}/summary`).expect(200);
        expect(own.body.summary.grossSales).toBe("20.00");
        expect(own.body.summary.commissionAmount).toBe("1.33");
        for (const key of ["stockCost", "netSalesProfit", "businessRetainedProfit", "commissionRate"]) {
          expect(own.body.summary).not.toHaveProperty(key);
        }
        expect(JSON.stringify(own.body)).not.toContain("13.37");

        const manager = await get("managerM", `/api/cashier-shifts/${cashierShift.cashierA}/summary`).expect(200);
        expect(manager.body.summary.stockCost).toBe("13.37");
        expect(manager.body.summary).not.toHaveProperty("commissionRate");

        const admin = await get("admin", `/api/cashier-shifts/${cashierShift.cashierA}/summary`).expect(200);
        expect(admin.body.summary.commissionRate).toBe("12.50");
      } finally {
        await db.delete(schema.cashierShiftSummaries).where(eq(schema.cashierShiftSummaries.shiftId, cashierShift.cashierA));
      }
    });

    it("a manager cannot close or end a shift whose sheet they may not read", async () => {
      const [adminOpen] = await db
        .insert(schema.cashierShifts)
        .values({ orgId, userId: id("admin"), openedByUserId: id("admin"), status: "open" })
        .returning();
      const [peerTill] = await db
        .insert(schema.shifts)
        .values({ orgId, locationId, userId: id("managerN"), status: "open" })
        .returning();
      try {
        as = "managerM";
        await request(app).post(`/api/cashier-shifts/${adminOpen.id}/end`).send({}).expect(403);
        await request(app).post(`/api/shifts/${peerTill.id}/close`).send({ closingCount: 0 }).expect(403);
        const [stillOpen] = await db.select().from(schema.cashierShifts).where(eq(schema.cashierShifts.id, adminOpen.id));
        expect(stillOpen.status).toBe("open");
        const [tillStillOpen] = await db.select().from(schema.shifts).where(eq(schema.shifts.id, peerTill.id));
        expect(tillStillOpen.status).toBe("open");
      } finally {
        await db.delete(schema.cashierShifts).where(eq(schema.cashierShifts.id, adminOpen.id));
        await db.delete(schema.shifts).where(eq(schema.shifts.id, peerTill.id));
      }
    });

    it("an admin reads all", async () => {
      await get("admin", `/api/cashier-shifts/${cashierShift.managerN}/summary`).expect(200);
      await get("admin", `/api/shifts/${tillShift.managerN}/report`).expect(200);
    });
  });

  describe("the staff list", () => {
    it("is refused to a cashier", async () => {
      await get("cashierA", "/api/cashiers").expect(403);
    });

    it("never carries a PIN, and rates only for admins", async () => {
      const manager = await get("managerM", "/api/cashiers").expect(200);
      expect(JSON.stringify(manager.body)).not.toContain("9876");
      expect(manager.body[0]).not.toHaveProperty("pinCode");
      expect(manager.body[0]).not.toHaveProperty("defaultCommissionRate");
      expect(manager.body[0].hasPin).toBe(true);

      const admin = await get("admin", "/api/cashiers").expect(200);
      expect(JSON.stringify(admin.body)).not.toContain("9876");
      expect(admin.body[0].defaultCommissionRate).toBe("12.50");
    });
  });

  describe("commission payments", () => {
    const pay = (who: string, shiftId: string) => {
      as = who;
      return request(app).post("/api/cashier-commission/payments").send({ shiftId, amountPaid: 5 });
    };

    it("nobody confirms their own", async () => {
      const res = await pay("managerM", cashierShift.managerM).expect(403);
      expect(res.body.message).toMatch(/your own/);
      await pay("admin", cashierShift.admin).expect(403);
    });

    it("a manager confirms cashiers' pay, not another manager's", async () => {
      await pay("managerM", cashierShift.managerN).expect(403);
      await pay("managerM", cashierShift.cashierA).expect(201);
    });

    it("the payee is whoever the shift belongs to, not whoever the client names", async () => {
      // M names a stranger as payee while pointing at M's own shift.
      as = "managerM";
      const spoofed = await request(app)
        .post("/api/cashier-commission/payments")
        .send({ shiftId: cashierShift.managerM, userId: "anything", amountPaid: 50 })
        .expect(400);
      expect(spoofed.body.message).toMatch(/someone else/);
      await request(app)
        .post("/api/cashier-commission/payments")
        .send({ shiftId: cashierShift.admin, userId: id("cashierA"), amountPaid: 50 })
        .expect(400);
      // Naming the shift's real owner is fine, and still subject to the rules.
      await request(app)
        .post("/api/cashier-commission/payments")
        .send({ shiftId: cashierShift.managerM, userId: id("managerM"), amountPaid: 50 })
        .expect(403);
      const rows = await db
        .select()
        .from(schema.cashierCommissionPayments)
        .where(inArray(schema.cashierCommissionPayments.shiftId, [cashierShift.managerM, cashierShift.admin]));
      expect(rows).toHaveLength(0);
    });

    it("a range covers the whole `to` trading day", async () => {
      // Closed this afternoon: a raw `closedAt <= new Date(today)` stopped at
      // midnight and gave this shift no row and no "Confirm paid".
      const { currentTradingDay } = await import("@shared/time/tradingDay");
      const today = currentTradingDay("Europe/London");
      await db.update(schema.cashierShifts).set({ tradingDay: today }).where(eq(schema.cashierShifts.id, cashierShift.cashierB));
      await db.insert(schema.cashierShiftSummaries).values({
        orgId,
        shiftId: cashierShift.cashierB,
        userId: id("cashierB"),
        closedAt: new Date(),
        commissionAmount: "12.00",
      } as any);
      try {
        const res = await get("managerM", `/api/cashier-commission?from=${today}&to=${today}`).expect(200);
        expect(res.body.map((r: any) => r.shiftId)).toEqual([cashierShift.cashierB]);
      } finally {
        await db.delete(schema.cashierShiftSummaries).where(eq(schema.cashierShiftSummaries.shiftId, cashierShift.cashierB));
        await db.update(schema.cashierShifts).set({ tradingDay: null }).where(eq(schema.cashierShifts.id, cashierShift.cashierB));
      }
    });

    it("hides the rate each shift was paid at from a manager", async () => {
      await db.insert(schema.cashierShiftSummaries).values({
        orgId,
        shiftId: cashierShift.cashierB,
        userId: id("cashierB"),
        closedAt: new Date(),
        commissionRate: "12.50",
      } as any);
      const manager = await get("managerM", "/api/cashier-commission").expect(200);
      const row = manager.body.find((r: any) => r.shiftId === cashierShift.cashierB);
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty("commissionRate");
      const admin = await get("admin", "/api/cashier-commission").expect(200);
      expect(admin.body.find((r: any) => r.shiftId === cashierShift.cashierB).commissionRate).toBe("12.50");
      await db.delete(schema.cashierShiftSummaries).where(eq(schema.cashierShiftSummaries.orgId, orgId));
    });
  });
});
