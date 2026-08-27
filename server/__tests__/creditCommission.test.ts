/**
 * Commission on a credit sale, released as the money actually arrives.
 *
 * The property that matters is cumulative exactness: however a debt is paid off
 * — one hit, three awkward instalments, a mix of cash and card — a fully
 * settled order must have released exactly its pool, split 90/10, and never a
 * penny more or less. Per-instalment rounding is the obvious way to get that
 * wrong, so the arithmetic tops each cashier up to what they should have earned
 * by now rather than splitting each payment separately.
 *
 * Runs against a real database (imports ../db), so it is excluded from the
 * no-DB run in vitest.config.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import {
  cashierCommissionEntries,
  cashierProfiles,
  creditPayments,
  orderCredit,
  orders,
  organizations,
} from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { recordCreditPayment, voidCredit, writeOffCredit } from "../services/creditLedger";
import { commissionParty } from "@shared/reports/orderCommission";

const SUFFIX = Date.now().toString(36);
let orgId: string;
let completerId: string;
let inputterId: string;
const USER_COMPLETER = `user-completer-${SUFFIX}`;
const USER_INPUTTER = `user-inputter-${SUFFIX}`;

async function makeOrder(
  total: number,
  opts: {
    sameCashier?: boolean;
    codeless?: boolean;
    completedUserId?: string | null;
    inputUserId?: string | null;
    creditAmount?: number;
  } = {},
) {
  const completedUserId = opts.completedUserId ?? (opts.codeless ? USER_COMPLETER : null);
  const inputUserId =
    opts.inputUserId ?? (opts.codeless ? (opts.sameCashier ? completedUserId : USER_INPUTTER) : null);
  const [order] = await db
    .insert(orders)
    .values({
      orgId,
      total: String(total),
      settledTotal: String(total),
      paymentMethod: "tick",
      status: "completed",
      completedCashierId: opts.codeless ? null : completerId,
      inputCashierId: opts.codeless ? null : opts.sameCashier ? completerId : inputterId,
      completedUserId,
      inputUserId,
    })
    .returning();
  const creditAmount = opts.creditAmount ?? total;
  await db.insert(orderCredit).values({
    orderId: order.id,
    orgId,
    amountGiven: String(creditAmount),
    amountOutstanding: String(creditAmount),
    status: "outstanding",
    givenOn: "2026-08-01",
  });
  return order.id;
}

async function releasedFor(orderId: string) {
  const rows = await db
    .select({
      cashierId: cashierCommissionEntries.cashierId,
      userId: cashierCommissionEntries.userId,
      amount: cashierCommissionEntries.amount,
    })
    .from(cashierCommissionEntries)
    .where(and(eq(cashierCommissionEntries.orderId, orderId), isNull(cashierCommissionEntries.reversalOf)));
  const total = rows.reduce((sum, r) => sum + parseFloat(String(r.amount)), 0);
  const byCashier = new Map<string, number>();
  const byParty = new Map<string, number>();
  for (const r of rows) {
    if (r.cashierId) {
      byCashier.set(
        r.cashierId,
        Math.round(((byCashier.get(r.cashierId) ?? 0) + parseFloat(String(r.amount))) * 100) / 100,
      );
    }
    const party = commissionParty(r.userId, r.cashierId);
    if (party) {
      byParty.set(party, Math.round(((byParty.get(party) ?? 0) + parseFloat(String(r.amount))) * 100) / 100);
    }
  }
  return { total: Math.round(total * 100) / 100, byCashier, byParty };
}

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: `credit-test-${SUFFIX}`, defaultCashierCommissionRate: "10.00" })
    .returning();
  orgId = org.id;
  const [a] = await db
    .insert(cashierProfiles)
    .values({ orgId, cashierCode: `C1${SUFFIX}`.slice(0, 12), displayName: "Completer" })
    .returning();
  const [b] = await db
    .insert(cashierProfiles)
    .values({ orgId, cashierCode: `C2${SUFFIX}`.slice(0, 12), displayName: "Inputter" })
    .returning();
  completerId = a.id;
  inputterId = b.id;
});

afterAll(async () => {
  if (!orgId) return;
  // orders has no cascade from organizations, so unwind by hand, deepest first.
  await db.delete(cashierCommissionEntries).where(eq(cashierCommissionEntries.orgId, orgId));
  await db.delete(creditPayments).where(eq(creditPayments.orgId, orgId));
  await db.delete(orderCredit).where(eq(orderCredit.orgId, orgId));
  await db.delete(orders).where(eq(orders.orgId, orgId));
  await db.delete(cashierProfiles).where(eq(cashierProfiles.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe("credit released as it is paid", () => {
  it("releases nothing until money arrives, then the whole pool at once", async () => {
    // £200 sale, £0 stock cost recorded, 10% → a £20 pool.
    const orderId = await makeOrder(200);

    expect((await releasedFor(orderId)).total).toBe(0);

    await recordCreditPayment({ orgId, orderId, amount: 200, method: "cash" });

    const released = await releasedFor(orderId);
    expect(released.total).toBe(20);
    expect(released.byCashier.get(completerId)).toBe(18);
    expect(released.byCashier.get(inputterId)).toBe(2);
  });

  it("releases pro-rata on a part payment", async () => {
    const orderId = await makeOrder(200);

    await recordCreditPayment({ orgId, orderId, amount: 80, method: "cash" });

    const released = await releasedFor(orderId);
    expect(released.total).toBe(8);
    expect(released.byCashier.get(completerId)).toBe(7.2);
    expect(released.byCashier.get(inputterId)).toBe(0.8);
  });

  it("lands on the pool exactly across awkward instalments of mixed kinds", async () => {
    // £33.33 at 10% is a £3.33 pool; £2.99 completer, £0.34 inputter once
    // rounded. Split across three payments, two of them by card.
    const orderId = await makeOrder(33.33);

    await recordCreditPayment({ orgId, orderId, amount: 11.11, method: "cash" });
    await recordCreditPayment({ orgId, orderId, amount: 11.11, method: "card" });
    await recordCreditPayment({ orgId, orderId, amount: 11.11, method: "card" });

    const [credit] = await db.select().from(orderCredit).where(eq(orderCredit.orderId, orderId));
    expect(parseFloat(String(credit.amountOutstanding))).toBe(0);
    expect(credit.status).toBe("settled");

    const released = await releasedFor(orderId);
    const completer = released.byCashier.get(completerId) ?? 0;
    const inputter = released.byCashier.get(inputterId) ?? 0;
    expect(Math.round((completer + inputter) * 100) / 100).toBe(released.total);
    expect(released.total).toBe(3.33);
  });

  it("records how each payment was made, so the drawer can reconcile", async () => {
    const orderId = await makeOrder(100);
    await recordCreditPayment({ orgId, orderId, amount: 60, method: "cash" });
    await recordCreditPayment({ orgId, orderId, amount: 40, method: "card" });

    const rows = await db
      .select({ method: creditPayments.method, amount: creditPayments.amount })
      .from(creditPayments)
      .where(eq(creditPayments.orderId, orderId));

    expect(rows.map((r) => `${r.method}:${parseFloat(String(r.amount))}`).sort()).toEqual([
      "card:40",
      "cash:60",
    ]);
  });

  it("gives one cashier the whole pool when they loaded and completed it", async () => {
    const orderId = await makeOrder(200, { sameCashier: true });
    await recordCreditPayment({ orgId, orderId, amount: 200, method: "cash" });

    const released = await releasedFor(orderId);
    expect(released.byCashier.get(completerId)).toBe(20);
    expect(released.byCashier.size).toBe(1);
  });

  it("releases codeless credit commission to the attributed users", async () => {
    const orderId = await makeOrder(200, { codeless: true });

    await recordCreditPayment({ orgId, orderId, amount: 200, method: "cash" });

    const released = await releasedFor(orderId);
    expect(released.total).toBe(20);
    expect(released.byParty.get(USER_COMPLETER)).toBe(18);
    expect(released.byParty.get(USER_INPUTTER)).toBe(2);
  });

  it("releases only the unpaid credit leg on split-tender orders", async () => {
    const orderId = await makeOrder(100, { sameCashier: true, creditAmount: 50 });

    await recordCreditPayment({ orgId, orderId, amount: 50, method: "cash" });

    const released = await releasedFor(orderId);
    expect(released.total).toBe(5);
    expect(released.byCashier.get(completerId)).toBe(5);
  });
});

describe("credit that is never paid", () => {
  it("refuses a payment larger than what is outstanding", async () => {
    const orderId = await makeOrder(50);
    await expect(recordCreditPayment({ orgId, orderId, amount: 75, method: "cash" })).rejects.toThrow(
      /outstanding/i,
    );
  });

  it("writes a debt off without paying anybody", async () => {
    const orderId = await makeOrder(120);
    const credit = await writeOffCredit(orgId, orderId);

    expect(credit.status).toBe("written_off");
    expect(parseFloat(String(credit.amountOutstanding))).toBe(0);
    expect((await releasedFor(orderId)).total).toBe(0);
  });

  it("voids an untouched credit and claws nothing back, because nothing accrued", async () => {
    const orderId = await makeOrder(120);
    const credit = await voidCredit(orgId, orderId);

    expect(credit.status).toBe("voided");
    expect((await releasedFor(orderId)).total).toBe(0);
  });

  it("refuses to void a credit that has been part paid", async () => {
    const orderId = await makeOrder(120);
    await recordCreditPayment({ orgId, orderId, amount: 20, method: "cash" });

    await expect(voidCredit(orgId, orderId)).rejects.toThrow(/already been paid/i);
  });
});
