/**
 * scripts/reconcile-figures.ts — the owner's read-only figures check.
 *
 * A clean day must pass every check; each kind of mismatch the v1.2.1 money
 * audit reproduced must be named, in plain English, by its own check; and
 * the check must be unable to write.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import pg from "pg";
import {
  CHECKS,
  formatReconciliation,
  reconcileFigures,
  withReadOnlyDb,
  type OrgReconciliation,
} from "../lib/reconcileFigures";

const hasDb = !!process.env.DATABASE_URL;

describe("the figures report", () => {
  const report: OrgReconciliation = {
    orgId: "o",
    orgName: "Test Shop",
    timeZone: "Europe/London",
    from: "2026-06-09",
    to: "2026-06-15",
    days: [
      { day: "2026-06-15", sales: 2, gross: 3000, refunds: 500, takings: 2500, cash: 1000, card: 2000, cardLink: 0, giftCard: 0, credit: 0, open: 1 },
    ],
    problems: [],
  };

  it("says plainly when everything matches", () => {
    const text = formatReconciliation([report]);
    expect(text).toContain(`All ${Object.keys(CHECKS).length} checks passed`);
    expect(text).toContain("Read only: nothing was changed.");
    expect(text).toMatch(/Mon 15 Jun\s+2\s+30\.00\s+5\.00\s+25\.00/);
  });

  it("groups problems under the check they fail", () => {
    const text = formatReconciliation([
      { ...report, problems: [{ check: "deleted", message: "Mon 15 Jun: settled sale abcdef12 (£10.00) was deleted." }] },
    ]);
    expect(text).toContain("1 thing(s) do not add up");
    expect(text).toContain(`PROBLEM  ${CHECKS.deleted} (1)`);
    expect(text).toContain("  - Mon 15 Jun: settled sale abcdef12 (£10.00) was deleted.");
  });
});

describe.skipIf(!hasDb)("reconcileFigures against the database", () => {
  // Noon on Monday 15 June 2026, BST: the 15th's trading day.
  const NOW = new Date("2026-06-15T11:00:00.000Z");
  const DAY = "2026-06-15";
  const at = (hhmm: string, day = DAY) => {
    // Local BST wall-clock -> UTC instant.
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(`${day}T00:00:00.000Z`);
    d.setUTCHours(h - 1, m);
    return d;
  };
  let client: pg.Client;
  let orgId: string;

  async function order(opts: {
    total: number;
    method: string;
    status?: string;
    createdAt: Date;
    settledAt?: Date | null;
    settledTotal?: number;
    dateKind?: string;
    legs?: Array<[string, number]>;
    lines?: Array<[number, number]>; // qty, unit
    subtotal?: number;
    promo?: number;
  }): Promise<string> {
    const id = randomUUID();
    const status = opts.status ?? "completed";
    const settledAt = opts.settledAt === undefined ? (status === "completed" ? opts.createdAt : null) : opts.settledAt;
    const lines = opts.lines ?? [[1, opts.total]];
    const subtotal = opts.subtotal ?? lines.reduce((s, [q, u]) => s + q * u, 0);
    await client.query(
      `INSERT INTO orders (id, org_id, total, payment_method, status, created_at, entered_at, settled_at, settled_total, date_kind,
                           subtotal, tier_discount, promo_discount, points_discount, vat_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,0,$11,0,0)`,
      [id, orgId, opts.total.toFixed(2), opts.method, status, opts.createdAt, settledAt,
        settledAt ? (opts.settledTotal ?? opts.total).toFixed(2) : null, opts.dateKind ?? "live",
        subtotal.toFixed(2), (opts.promo ?? 0).toFixed(2)],
    );
    for (const [q, u] of lines) {
      await client.query(
        `INSERT INTO order_items (org_id, order_id, quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5)`,
        [orgId, id, q, u.toFixed(2), (q * u).toFixed(2)],
      );
    }
    for (const [m, a] of opts.legs ?? [[opts.method, opts.total]]) {
      await client.query(`INSERT INTO order_payments (org_id, order_id, method, amount) VALUES ($1,$2,$3,$4)`, [orgId, id, m, a.toFixed(2)]);
    }
    return id;
  }
  async function firstLine(orderId: string): Promise<string> {
    return (await client.query(`SELECT id FROM order_items WHERE order_id = $1 LIMIT 1`, [orderId])).rows[0].id;
  }
  async function refund(orderId: string, total: number, method: string, when: Date, offTab = 0) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO refunds (id, order_id, org_id, cashier_id, reason, refund_method, total, created_at, credit_amount) VALUES ($1,$2,$3,'u','damaged',$4,$5,$6,$7)`,
      [id, orderId, orgId, method, total.toFixed(2), when, offTab.toFixed(2)],
    );
    await client.query(`INSERT INTO refund_lines (refund_id, order_line_id, qty, amount) VALUES ($1,$2,1,$3)`, [id, await firstLine(orderId), total.toFixed(2)]);
  }
  async function closeRun(day: string, gross: number, count: number, cash: number, card: number) {
    await client.query(
      `INSERT INTO daily_close_runs (org_id, trading_day, order_count, gross_sales, cash_sales, card_sales) VALUES ($1,$2,$3,$4,$5,$6)`,
      [orgId, day, count, gross.toFixed(2), cash.toFixed(2), card.toFixed(2)],
    );
  }
  const run = async () => (await withReadOnlyDb(process.env.DATABASE_URL!, (db) => reconcileFigures(db, { days: 7, orgId, now: NOW })))[0];
  const checksHit = (r: OrgReconciliation) => new Set(r.problems.map((p) => p.check));

  beforeEach(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    orgId = randomUUID();
    await client.query(`INSERT INTO organizations (id, name, timezone) VALUES ($1, 'Reconcile Test', 'Europe/London')`, [orgId]);
  });

  afterEach(async () => {
    for (const t of ["refund_lines r USING refunds f WHERE r.refund_id = f.id AND f.org_id = $1"]) {
      await client.query(`DELETE FROM ${t}`, [orgId]);
    }
    for (const t of ["cashier_commission_entries", "refunds", "order_expenses", "order_credit", "credit_payments", "order_payments", "order_items", "order_events", "daily_close_runs", "orders", "organizations"]) {
      await client.query(`DELETE FROM ${t} WHERE ${t === "organizations" ? "id" : "org_id"} = $1`, [orgId]);
    }
    await client.end();
  });

  it("passes a clean day: two sales, a partial refund, a close that matches", async () => {
    const a = await order({ total: 20, method: "cash", createdAt: at("09:00", "2026-06-14") });
    await order({ total: 30, method: "split", createdAt: at("10:00", "2026-06-14"), legs: [["cash", 10], ["card", 20]] });
    await closeRun("2026-06-14", 50, 2, 30, 20);
    await refund(a, 5, "original", at("10:30"));
    const r = await run();
    expect(r.problems).toEqual([]);
    const sun = r.days.find((d) => d.day === "2026-06-14")!;
    expect(sun).toMatchObject({ sales: 2, gross: 5000, cash: 3000, card: 2000, takings: 5000 });
    expect(r.days.find((d) => d.day === DAY)).toMatchObject({ refunds: 500, takings: -500 });
  });

  it("names a settled sale deleted after its day closed", async () => {
    const a = await order({ total: 20, method: "cash", createdAt: at("09:00", "2026-06-14") });
    await order({ total: 10, method: "cash", createdAt: at("09:30", "2026-06-14") });
    await closeRun("2026-06-14", 30, 2, 30, 0);
    // What DELETE /api/orders/:id leaves behind.
    await client.query(
      `INSERT INTO order_events (org_id, order_id, kind, at, meta) VALUES ($1,$2,'deleted',$3,'{"status":"completed","total":"20.00"}')`,
      [orgId, a, at("10:00")],
    );
    await client.query(`DELETE FROM order_payments WHERE order_id = $1`, [a]);
    await client.query(`DELETE FROM order_items WHERE order_id = $1`, [a]);
    await client.query(`DELETE FROM orders WHERE id = $1`, [a]);
    const r = await run();
    expect(checksHit(r)).toEqual(new Set(["close", "deleted"]));
    expect(r.problems.find((p) => p.check === "close")!.message).toContain("the 06:00 close recorded £30.00 over 2 sale(s); the sales settled that day now come to £10.00 over 1");
  });

  it("names gift card and card link money counted as card by the close", async () => {
    await order({ total: 20, method: "card", createdAt: at("09:00", "2026-06-14") });
    await order({ total: 15, method: "gift_card", createdAt: at("09:10", "2026-06-14") });
    await closeRun("2026-06-14", 35, 2, 0, 35);
    const r = await run();
    expect([...checksHit(r)]).toEqual(["closeCard"]);
    expect(r.problems[0].message).toContain("only £20.00 was taken on the card terminal");
    expect(r.problems[0].message).toContain("£15.00 of gift card");
  });

  it("names a backdated sale counted on the day it was keyed in", async () => {
    await order({ total: 12, method: "card", createdAt: at("12:00", "2026-06-12"), settledAt: at("10:00"), dateKind: "backdated" });
    const r = await run();
    expect([...checksHit(r)]).toEqual(["backdated"]);
    expect(r.problems[0].message).toContain("is dated Fri 12 Jun but takings count it on Mon 15 Jun");
  });

  it("raises nothing for personal use recorded at £0, whose lines every product figure now leaves out", async () => {
    await order({ total: 0, method: "personal_use", createdAt: at("09:00"), lines: [[2, 10]], legs: [["personal_use", 0]], subtotal: 0 });
    const r = await run();
    expect(r.problems.map((p) => p.check)).not.toContain("personalUse");
  });

  it("names a close that reports personal use at sale price rather than cost", async () => {
    const o = await order({ total: 0, method: "personal_use", createdAt: at("09:00", "2026-06-14"), lines: [[2, 10]], legs: [["personal_use", 20]], subtotal: 0 });
    await client.query(`INSERT INTO order_expenses (org_id, order_id, category, amount) VALUES ($1,$2,'personal_use',8)`, [orgId, o]);
    await client.query(
      `INSERT INTO daily_close_runs (org_id, trading_day, personal_use_cost) VALUES ($1,'2026-06-14',20)`,
      [orgId],
    );
    const r = await run();
    const msg = r.problems.filter((p) => p.check === "personalUse").map((p) => p.message).join("\n");
    expect(msg).toContain("the close reported personal use of £20.00; the goods taken cost £8.00");
  });

  it("names a refunded credit sale still on the tab, and a card sale refunded from the drawer", async () => {
    const tick = await order({ total: 25, method: "tick", createdAt: at("09:00") });
    await client.query(
      `INSERT INTO order_credit (order_id, org_id, amount_given, amount_outstanding, status, given_on) VALUES ($1,$2,25,25,'outstanding',$3)`,
      [tick, orgId, DAY],
    );
    await refund(tick, 25, "cash", at("10:00"));
    const card = await order({ total: 30, method: "card", createdAt: at("09:30") });
    await refund(card, 10, "cash", at("10:05"));
    const r = await run();
    const hit = checksHit(r);
    expect(hit.has("refundedTabs")).toBe(true);
    expect(hit.has("refundTender")).toBe(true);
    expect(r.problems.find((p) => p.check === "refundedTabs")!.message).toContain("£25.00 of the sale was refunded and paid out, but the customer is still shown owing £25.00");
  });

  it("is clean when a tab sale's refund came off the tab (v1.2.1 fix)", async () => {
    const tick = await order({ total: 25, method: "tick", createdAt: at("09:00") });
    // £10 repaid, then the whole sale refunded: £15 off the tab, £10 handed back.
    await client.query(
      `INSERT INTO order_credit (order_id, org_id, amount_given, amount_outstanding, status, given_on) VALUES ($1,$2,25,0,'settled',$3)`,
      [tick, orgId, DAY],
    );
    await client.query(`INSERT INTO credit_payments (org_id, order_id, amount, method, paid_on) VALUES ($1,$2,10,'cash',$3)`, [orgId, tick, DAY]);
    await refund(tick, 25, "original", at("10:00"), 15);
    const hit = checksHit(await run());
    expect(hit.has("refundedTabs")).toBe(false);
    expect(hit.has("credit")).toBe(false);
    expect(hit.has("refundTender")).toBe(false);
  });

  it("names a refund on a discounted sale that gives back more than was paid", async () => {
    // Two £10 lines, 10% promotion: the customer paid £18, so £9 a line.
    const o = await order({ total: 18, method: "card", createdAt: at("09:00"), lines: [[1, 10], [1, 10]], subtotal: 20, promo: 2 });
    await refund(o, 10, "original", at("09:30"));
    const r = await run();
    const msg = r.problems.find((p) => p.check === "refunds")?.message ?? "";
    expect(msg).toContain("gave back £10.00 for items the customer paid £9.00 for");
  });

  it("is clean for a delivery fee sale, and for refunds of its goods and of the fee (v1.2.1)", async () => {
    // Two £10 lines, a £3 fee on top, £2 off the goods: £21 paid.
    const o = await order({ total: 21, method: "card", createdAt: at("09:00"), lines: [[1, 10], [1, 10]], subtotal: 20, promo: 2 });
    await client.query(`UPDATE orders SET delivery_fee = 3.00, vat_rate = 0 WHERE id = $1`, [o]);
    // One line back at its share of the goods (£18 over £20 of lines: £9).
    await refund(o, 9, "card", at("09:30"));
    // The fee back on its own: a refund row with no lines.
    await client.query(
      `INSERT INTO refunds (id, order_id, org_id, cashier_id, reason, refund_method, total, created_at, credit_amount, delivery_fee)
       VALUES ($1,$2,$3,'u','damaged','card',3.00,$4,0,3.00)`,
      [randomUUID(), o, orgId, at("09:40")],
    );
    const r = await run();
    expect(r.problems).toEqual([]);
  });

  it("names a refund on an order that was never settled", async () => {
    const o = await order({ total: 10, method: "cash", status: "pending", createdAt: at("09:00") });
    await refund(o, 10, "cash", at("09:30"));
    const r = await run();
    expect(r.problems.map((p) => p.check)).toContain("refunds");
    expect(r.problems.find((p) => p.check === "refunds")!.message).toContain("which was never settled");
  });

  it("raises nothing for a small-hours sale, which every figure now counts on its trading day", async () => {
    // 02:00 BST on the 15th = 01:00 UTC on the 15th: trading day the 14th.
    await order({ total: 40, method: "cash", createdAt: new Date("2026-06-15T01:00:00.000Z") });
    const r = await run();
    expect(r.problems).toEqual([]);
  });

  it("names commission earned on a tab payment that no payroll row carries", async () => {
    const o = await order({ total: 25, method: "tick", createdAt: at("09:00") });
    await client.query(
      `INSERT INTO cashier_commission_entries (org_id, order_id, user_id, role, basis, amount, accrued_on)
       VALUES ($1,$2,'u','completer','credit_resolution',1.80,$3)`,
      [orgId, o, DAY],
    );
    const r = await run();
    const msg = r.problems.find((p) => p.check === "commissionPayroll")?.message ?? "";
    expect(msg).toContain("£1.80 of commission earned when tabs were paid is in the commission ledger but on no payroll row");
  });

  it("cannot write, whatever it is asked to do", async () => {
    await expect(
      withReadOnlyDb(process.env.DATABASE_URL!, (db) => db.query(`UPDATE organizations SET name = 'x' WHERE id = $1`, [orgId])),
    ).rejects.toThrow(/read-only transaction/);
    const still = await client.query(`SELECT name FROM organizations WHERE id = $1`, [orgId]);
    expect(still.rows[0].name).toBe("Reconcile Test");
  });
});
