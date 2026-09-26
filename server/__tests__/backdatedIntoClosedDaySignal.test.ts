/**
 * v1.2.1 money: a sale keyed in late, into a trading day that already had its
 * 06:00 close, raises a Signal to managers and above naming the date — the
 * owner's decision, since the sale is allowed in but the day's frozen close
 * snapshot does not know about it until the figures check is next run.
 *
 * In CI's unit-db job by explicit file name (.github/workflows/ci.yml). Mocks
 * ../db without a database like roleMatrix.test.ts, so the no-DB run loads it
 * and skips the database half.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

vi.mock("../db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {}, pool: {} },
);

describe.skipIf(!hasDb)("late sale into a closed day (database)", () => {
  let db: any;
  let s: typeof import("@shared/schema");
  let settleBackdatedShift: typeof import("../services/orderDating").settleBackdatedShift;
  const orgId = randomUUID();
  const MANAGER = `bdcd-manager-${orgId.slice(0, 8)}`;
  const CASHIER = `bdcd-cashier-${orgId.slice(0, 8)}`;
  const orderId = randomUUID();

  beforeAll(async () => {
    ({ db } = await import("../db"));
    s = await import("@shared/schema");
    ({ settleBackdatedShift } = await import("../services/orderDating"));
    await db.insert(s.organizations).values({ id: orgId, name: "Backdated Signal Test", timezone: "Europe/London" });
    await db
      .insert(s.allowedUsers)
      .values([
        { replitUserId: MANAGER, orgId, role: "MANAGER", name: "Manager", email: `${MANAGER}@example.invalid` },
        { replitUserId: CASHIER, orgId, role: "CASHIER", name: "Cashier", email: `${CASHIER}@example.invalid` },
      ]);
  });

  afterAll(async () => {
    // cashier_shifts and the Signal tables cascade from organizations;
    // allowed_users does not, so it goes first.
    await db.delete(s.allowedUsers).where(eq(s.allowedUsers.orgId, orgId));
    await db.delete(s.organizations).where(eq(s.organizations.id, orgId));
  });

  async function signalsFor(orderIdVal: string) {
    return db
      .select({ id: s.orgNotifications.id, message: s.orgNotifications.message, metadata: s.orgNotifications.metadata })
      .from(s.orgNotifications)
      .where(and(eq(s.orgNotifications.orgId, orgId), eq(s.orgNotifications.source, "backdated_into_closed_day")))
      .then((rows: any[]) => rows.filter((r) => (r.metadata as any)?.orderId === orderIdVal));
  }

  it("opening a backdated day's shift for the first sale into it raises a Signal to managers", async () => {
    const pastDay = "2026-06-01"; // any day well before "now" for a shift the test opens itself
    const [shift] = await db
      .insert(s.cashierShifts)
      .values({
        orgId,
        userId: CASHIER,
        tradingDay: pastDay,
        openedByUserId: CASHIER,
        status: "open",
      })
      .returning();

    await settleBackdatedShift(orgId, shift, new Date(), { orderId, enteredByUserId: CASHIER });

    const [after] = await db.select().from(s.cashierShifts).where(eq(s.cashierShifts.id, shift.id));
    expect(after.status).toBe("auto_closed"); // closeCashierShift's status for a non-manual close

    const rows = await signalsFor(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain(pastDay);

    const recipients = await db
      .select({ userId: s.orgNotificationRecipients.userId })
      .from(s.orgNotificationRecipients)
      .where(eq(s.orgNotificationRecipients.notificationId, rows[0].id));
    expect(recipients.map((r: any) => r.userId)).toContain(MANAGER);
    expect(recipients.map((r: any) => r.userId)).not.toContain(CASHIER);
  });

  it("a second sale into the same already-closed backdated day raises its own Signal", async () => {
    const pastDay = "2026-06-02";
    const [shift] = await db
      .insert(s.cashierShifts)
      .values({
        orgId,
        userId: CASHIER,
        tradingDay: pastDay,
        openedByUserId: CASHIER,
        status: "closed",
        closedAt: new Date(),
        closedByUserId: null,
        closeReason: "backdated_entry",
      })
      .returning();

    const otherOrderId = randomUUID();
    await settleBackdatedShift(orgId, shift, new Date(), { orderId: otherOrderId, enteredByUserId: CASHIER });

    const rows = await signalsFor(otherOrderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain(pastDay);
  });

  it("never signals a shift for the trading day still in progress", async () => {
    const { currentTradingDay } = await import("@shared/time/tradingDay");
    const today = currentTradingDay("Europe/London", new Date());
    const [shift] = await db
      .insert(s.cashierShifts)
      .values({ orgId, userId: CASHIER, tradingDay: today, openedByUserId: CASHIER, status: "open" })
      .returning();

    const liveOrderId = randomUUID();
    await settleBackdatedShift(orgId, shift, new Date(), { orderId: liveOrderId, enteredByUserId: CASHIER });

    expect(await signalsFor(liveOrderId)).toHaveLength(0);
    const [after] = await db.select().from(s.cashierShifts).where(eq(s.cashierShifts.id, shift.id));
    expect(after.status).toBe("open"); // untouched — today's own close will handle it
  });
});
