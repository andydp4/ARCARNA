/**
 * ARC-004: "Confirm paid" could never succeed for a shift opened lazily on
 * first sale (migration 058) — those shifts have no cashier code, so
 * `cashierId` was always null on them, and `commissionPaymentSchema` required
 * a uuid `cashierId`. The client's "Confirm paid" button sends exactly
 * `{ cashierId: row.cashierId, shiftId: row.shiftId, amountPaid }`, and
 * `row.cashierId` is null for a codeless shift — so every such payment 400'd
 * before this fix, while the commission itself accrued and sat forever unpaid.
 *
 * These tests hit the real route (mounted the same way
 * requireOpenShift.test.ts does) against a real database, because the fix is
 * precisely about what the database will and won't accept — a mocked drizzle
 * chain would not have caught the NOT NULL constraint this migrates away
 * from.
 */
import express, { type RequestHandler } from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminAuditLogs,
  cashierCommissionPayments,
  cashierProfiles,
  cashierShifts,
  organizations,
} from "@shared/schema";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("commission payments: legacy code and codeless-user identity", () => {
  let db: (typeof import("../db"))["db"];
  let app: express.Express;
  let orgId: string;
  let managerUserId: string;

  beforeEach(async () => {
    ({ db } = await import("../db"));
    const { registerCashierRoutes } = await import("../routes/cashiers");

    orgId = randomUUID();
    managerUserId = `manager-${randomUUID()}`;

    await db.insert(organizations).values({ id: orgId, name: "Commission Payment Test" });

    const scoped: RequestHandler = (req: any, _res, next) => {
      req.orgContext = { orgId, locationId: null, role: "MANAGER" };
      req.user = { id: managerUserId, role: "MANAGER" };
      next();
    };

    app = express();
    app.use(express.json());
    registerCashierRoutes(app, [scoped]);
  });

  afterEach(async () => {
    await db.delete(cashierCommissionPayments).where(eq(cashierCommissionPayments.orgId, orgId));
    await db.delete(cashierShifts).where(eq(cashierShifts.orgId, orgId));
    await db.delete(cashierProfiles).where(eq(cashierProfiles.orgId, orgId));
    // The route's admin-audit write (recordAdminAudit) FK's to this org.
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("records a payment for a codeless (userId-only) shift from shiftId alone — the exact request the client sends", async () => {
    const cashierUserId = `cashier-${randomUUID()}`;
    const [shift] = await db
      .insert(cashierShifts)
      .values({
        orgId,
        userId: cashierUserId,
        openedByUserId: cashierUserId,
        status: "closed",
      })
      .returning();

    // This is exactly what client/src/pages/cashier-payroll.tsx sends: the
    // GET /api/cashier-commission row's `cashierId` is null for a codeless
    // shift, and it is forwarded as-is.
    const res = await request(app)
      .post("/api/cashier-commission/payments")
      .send({ cashierId: null, shiftId: shift.id, amountPaid: 12.5 })
      .expect(201);

    expect(res.body.cashierId).toBeNull();
    expect(res.body.userId).toBe(cashierUserId);
    expect(res.body.shiftId).toBe(shift.id);
    expect(parseFloat(res.body.amountPaid)).toBeCloseTo(12.5);

    const [stored] = await db
      .select()
      .from(cashierCommissionPayments)
      .where(eq(cashierCommissionPayments.id, res.body.id));
    expect(stored.userId).toBe(cashierUserId);
    expect(stored.cashierId).toBeNull();
  });

  it("still resolves and records a legacy coded shift's payment unchanged", async () => {
    const [cashier] = await db
      .insert(cashierProfiles)
      .values({ orgId, cashierCode: `CC-${randomUUID().slice(0, 8)}`, displayName: "Legacy Cashier" })
      .returning();
    const [shift] = await db
      .insert(cashierShifts)
      .values({ orgId, cashierId: cashier.id, openedByUserId: managerUserId, status: "closed" })
      .returning();

    const res = await request(app)
      .post("/api/cashier-commission/payments")
      .send({ cashierId: cashier.id, shiftId: shift.id, amountPaid: 5 })
      .expect(201);

    expect(res.body.cashierId).toBe(cashier.id);
    expect(res.body.userId).toBeNull();
  });

  it("404s a legacy cashierId that does not exist in this org — unchanged behaviour", async () => {
    await request(app)
      .post("/api/cashier-commission/payments")
      .send({ cashierId: randomUUID(), amountPaid: 5 })
      .expect(404);
  });

  it("400s when nothing identifies who the payment is for", async () => {
    const res = await request(app)
      .post("/api/cashier-commission/payments")
      .send({ amountPaid: 5 })
      .expect(400);
    const messages = JSON.stringify(res.body.errors ?? res.body);
    expect(messages).toMatch(/cashierId|userId|shiftId/i);
  });

  it("404s when shiftId points at a shift that does not exist", async () => {
    await request(app)
      .post("/api/cashier-commission/payments")
      .send({ shiftId: randomUUID(), amountPaid: 5 })
      .expect(404);
  });
});
