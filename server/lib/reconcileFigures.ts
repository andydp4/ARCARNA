/**
 * The figures check behind `scripts/reconcile-figures.ts`.
 *
 * Recomputes, from the source rows, the money figures arcarna shows —
 * takings, the 06:00 close, the till drawers, the cashier shift sheets and
 * the Credit List — and says in plain English wherever what was recorded or
 * shown does not match what the rows now add up to.
 *
 * READ ONLY by construction: every query runs inside one
 * `BEGIN TRANSACTION READ ONLY`, so Postgres itself refuses any write, and the
 * transaction is rolled back at the end. It never reads a customer's name,
 * phone, email or address — orders are named by their short code only.
 *
 * Independent of the app's own figure code on purpose (no import of the
 * services that produce the figures): a check that reuses the code it is
 * checking can only ever agree with it. The one shared piece is the trading
 * day (06:00 to 06:00 in the org's timezone), which is a definition, not a
 * calculation.
 */
import { Pool } from "pg";
import {
  currentTradingDay,
  shiftIsoDate,
  tradingDayBounds,
  tradingDayFor,
} from "@shared/time/tradingDay";
import { sslFor } from "./dbConnection";

export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export const CHECKS = {
  close: "The 06:00 close still matches the day's orders",
  closeCard: "The close counts card money only as card",
  deleted: "No settled sale was deleted",
  legs: "Every settled sale's payments add up to what it was settled at",
  arithmetic: "Every sale's lines, discounts and VAT add up to its total",
  drawers: "Each till drawer's expected cash still matches its sales",
  refundTender: "Refunds go back the way the money came in",
  shiftSheets: "Cashier shift sheets still match their orders",
  commissionPayroll: "Every commission earned reaches the payroll",
  unsettledInSheets: "Shift sheets and Z reports count settled sales only",
  credit: "Each tab's balance is what was given less what was paid",
  refundedTabs: "A refunded credit sale is taken off the tab",
  backdated: "Backdated sales are counted on the day they are dated",
  personalUse: "Personal use is not counted as sales",
  refunds: "Refunds never exceed what was paid",
} as const;
export type CheckId = keyof typeof CHECKS;

export type Problem = { check: CheckId; day?: string; message: string };

export type DaySummary = {
  day: string;
  sales: number;
  gross: number;
  refunds: number;
  takings: number;
  cash: number;
  card: number;
  cardLink: number;
  giftCard: number;
  credit: number;
  open: number;
};

export type OrgReconciliation = {
  orgId: string;
  orgName: string;
  timeZone: string;
  from: string;
  to: string;
  days: DaySummary[];
  problems: Problem[];
};

export type ReconcileOptions = { days: number; orgId?: string; now?: Date };

// ------------------------------------------------------------------ helpers

/** Money as whole pence: every sum below is exact. */
function p(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  return Math.round(Number(v) * 100);
}
function gbp(pence: number): string {
  const sign = pence < 0 ? "−" : "";
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
}
function short(id: string): string {
  return id.slice(0, 8);
}
function dayName(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function add(map: Map<string, number>, key: string, pence: number) {
  map.set(key, (map.get(key) ?? 0) + pence);
}
const isCash = (m: string) => m.toLowerCase() === "cash";
const isPersonal = (m: string | null | undefined) => String(m ?? "").toLowerCase() === "personal_use";

// ------------------------------------------------------------------- checks

export async function reconcileOrg(
  db: Queryable,
  org: { id: string; name: string; timezone: string | null },
  opts: ReconcileOptions,
): Promise<OrgReconciliation> {
  const tz = org.timezone || "Europe/London";
  const now = opts.now ?? new Date();
  const to = currentTradingDay(tz, now);
  const from = shiftIsoDate(to, -(Math.max(1, opts.days) - 1));
  const start = tradingDayBounds(from, tz).start;
  const end = tradingDayBounds(to, tz).end;
  const problems: Problem[] = [];
  const say = (check: CheckId, message: string, day?: string) => problems.push({ check, message, day });
  const orgId = org.id;

  // --- source rows
  const orders = (
    await db.query(
      `SELECT id, status, total, settled_total, settled_at, created_at, entered_at, payment_method, date_kind,
              shift_id, cashier_shift_id, completed_cashier_shift_id,
              subtotal, tier_discount, promo_discount, points_discount, vat_amount, delivery_fee, vat_rate
         FROM orders
        WHERE org_id = $1
          AND ((settled_at >= $2 AND settled_at < $3) OR (created_at >= $2 AND created_at < $3))`,
      [orgId, start, end],
    )
  ).rows;
  const orderById = new Map<string, any>(orders.map((o) => [o.id, o]));
  const ids = orders.map((o) => o.id);

  const legs = ids.length
    ? (await db.query(`SELECT order_id, method, amount, status FROM order_payments WHERE order_id = ANY($1::uuid[])`, [ids])).rows
    : [];
  const legsBy = new Map<string, any[]>();
  for (const l of legs) legsBy.set(l.order_id, [...(legsBy.get(l.order_id) ?? []), l]);

  const items = ids.length
    ? (await db.query(`SELECT id, order_id, quantity, unit_price, total_price FROM order_items WHERE order_id = ANY($1::uuid[])`, [ids])).rows
    : [];
  const itemsBy = new Map<string, any[]>();
  for (const it of items) itemsBy.set(it.order_id, [...(itemsBy.get(it.order_id) ?? []), it]);

  const refunds = (
    await db.query(
      `SELECT r.id, r.order_id, r.total, r.refund_method, r.created_at, r.shift_id,
              o.status AS order_status, o.settled_total, o.total AS order_total, o.payment_method,
              o.subtotal, r.delivery_fee AS refund_fee, o.delivery_fee, o.vat_rate
         FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE r.org_id = $1 AND ((r.created_at >= $2 AND r.created_at < $3) OR r.order_id = ANY($4::uuid[]))`,
      [orgId, start, end, ids],
    )
  ).rows;
  const refundIds = refunds.map((r) => r.id);
  const refundLines = refundIds.length
    ? (
        await db.query(
          `SELECT rl.refund_id, rl.order_line_id, rl.qty, rl.amount, oi.unit_price
             FROM refund_lines rl LEFT JOIN order_items oi ON oi.id = rl.order_line_id
            WHERE rl.refund_id = ANY($1::uuid[])`,
          [refundIds],
        )
      ).rows
    : [];

  // --- the day summary: takings as arcarna defines them (settled that day,
  // at the settlement snapshot, less refunds issued that day)
  const days: DaySummary[] = [];
  const dayIndex = new Map<string, DaySummary>();
  for (let d = from; d <= to; d = shiftIsoDate(d, 1)) {
    const row: DaySummary = { day: d, sales: 0, gross: 0, refunds: 0, takings: 0, cash: 0, card: 0, cardLink: 0, giftCard: 0, credit: 0, open: 0 };
    days.push(row);
    dayIndex.set(d, row);
  }
  for (const o of orders) {
    if (o.status === "completed" && o.settled_at) {
      const d = dayIndex.get(tradingDayFor(new Date(o.settled_at), tz));
      if (!d || isPersonal(o.payment_method)) continue;
      d.sales += 1;
      d.gross += p(o.settled_total ?? o.total);
      for (const l of legsBy.get(o.id) ?? []) {
        if (l.status !== "paid") continue;
        const m = String(l.method).toLowerCase();
        if (m === "cash") d.cash += p(l.amount);
        else if (m === "card") d.card += p(l.amount);
        else if (m === "card_link") d.cardLink += p(l.amount);
        else if (m === "gift_card") d.giftCard += p(l.amount);
        else if (m === "tick") d.credit += p(l.amount);
      }
    } else if (o.status !== "completed" && o.created_at) {
      const d = dayIndex.get(tradingDayFor(new Date(o.created_at), tz));
      if (d) d.open += 1;
    }
  }
  for (const r of refunds) {
    const d = dayIndex.get(tradingDayFor(new Date(r.created_at), tz));
    if (d) d.refunds += p(r.total);
  }
  for (const d of days) d.takings = d.gross - d.refunds;

  // --- 1. the 06:00 close, frozen
  const runs = (
    await db.query(
      `SELECT trading_day::text AS day, ran_at, order_count, gross_sales, cash_sales, card_sales,
              credit_given, credit_resolved, commission_accrued, personal_use_cost
         FROM daily_close_runs WHERE org_id = $1 AND trading_day BETWEEN $2::date AND $3::date ORDER BY trading_day`,
      [orgId, from, to],
    )
  ).rows;
  const commissionByDay = new Map<string, number>();
  for (const r of (
    await db.query(
      `SELECT accrued_on::text AS day, SUM(amount) AS amount FROM cashier_commission_entries
        WHERE org_id = $1 AND reversal_of IS NULL AND accrued_on BETWEEN $2::date AND $3::date GROUP BY 1`,
      [orgId, from, to],
    )
  ).rows) commissionByDay.set(r.day, p(r.amount));
  const creditGivenByDay = new Map<string, number>();
  for (const r of (
    await db.query(
      `SELECT given_on::text AS day, SUM(amount_given) AS amount FROM order_credit
        WHERE org_id = $1 AND given_on BETWEEN $2::date AND $3::date GROUP BY 1`,
      [orgId, from, to],
    )
  ).rows) creditGivenByDay.set(r.day, p(r.amount));
  const creditPaidByDay = new Map<string, number>();
  for (const r of (
    await db.query(
      `SELECT paid_on::text AS day, SUM(amount) AS amount FROM credit_payments
        WHERE org_id = $1 AND paid_on BETWEEN $2::date AND $3::date GROUP BY 1`,
      [orgId, from, to],
    )
  ).rows) creditPaidByDay.set(r.day, p(r.amount));

  // What the goods taken for personal use cost, by the day they left: the
  // order expense the till books at cost.
  const personalCostByDay = new Map<string, number>();
  for (const r of (
    await db.query(
      `SELECT o.settled_at, e.amount FROM order_expenses e JOIN orders o ON o.id = e.order_id
        WHERE e.org_id = $1 AND e.category = 'personal_use' AND o.status = 'completed'
          AND o.settled_at >= $2 AND o.settled_at < $3`,
      [orgId, start, end],
    )
  ).rows) add(personalCostByDay, tradingDayFor(new Date(r.settled_at), tz), p(r.amount));

  for (const run of runs) {
    const d = dayIndex.get(run.day);
    if (!d) continue;
    const label = dayName(run.day);
    // A backdated sale keyed in after its day closed is counted on its dated
    // day (the CHANGELOG promise), but the frozen close could not include it.
    // Named on its own, and left out of the comparison below.
    const lateBackdated = orders.filter(
      (o) =>
        o.date_kind === "backdated" &&
        o.status === "completed" &&
        o.settled_at &&
        o.entered_at &&
        !isPersonal(o.payment_method) &&
        tradingDayFor(new Date(o.settled_at), tz) === run.day &&
        new Date(o.entered_at) > new Date(run.ran_at),
    );
    const lateGross = lateBackdated.reduce((s, o) => s + p(o.settled_total ?? o.total), 0);
    const lateLegs = lateBackdated.flatMap((o) => (legsBy.get(o.id) ?? []).filter((l) => l.status === "paid"));
    const lateCash = lateLegs.filter((l) => String(l.method).toLowerCase() === "cash").reduce((s, l) => s + p(l.amount), 0);
    const lateCard = lateLegs.filter((l) => String(l.method).toLowerCase() === "card").reduce((s, l) => s + p(l.amount), 0);
    if (lateBackdated.length > 0) {
      say(
        "backdated",
        `${label}: ${lateBackdated.length} backdated sale(s) worth ${gbp(lateGross)} were keyed in after the day closed. ` +
          `The day's takings include them; the 06:00 close, which had already run, does not.`,
        run.day,
      );
    }
    if (p(run.gross_sales) !== d.gross - lateGross || Number(run.order_count) !== d.sales - lateBackdated.length) {
      say(
        "close",
        `${label}: the 06:00 close recorded ${gbp(p(run.gross_sales))} over ${run.order_count} sale(s); ` +
          `the sales settled that day now come to ${gbp(d.gross)} over ${d.sales}. ` +
          `A closed day has changed — a sale was deleted, reopened or settled into it afterwards.`,
        run.day,
      );
    }
    if (p(run.cash_sales) !== d.cash - lateCash) {
      say("close", `${label}: the close recorded cash ${gbp(p(run.cash_sales))}; the day's cash payments now come to ${gbp(d.cash)}.`, run.day);
    }
    const storedCard = p(run.card_sales);
    const dayCard = d.card - lateCard;
    if (storedCard !== dayCard) {
      const extra = storedCard - dayCard;
      const explained = extra === d.giftCard + d.cardLink || extra === d.giftCard || extra === d.cardLink;
      say(
        explained ? "closeCard" : "close",
        explained
          ? `${label}: the close counted ${gbp(storedCard)} as card, but only ${gbp(dayCard)} was taken on the card terminal — ` +
              `the rest is ${d.giftCard ? `${gbp(d.giftCard)} of gift card` : ""}${d.giftCard && d.cardLink ? " and " : ""}${d.cardLink ? `${gbp(d.cardLink)} of card link` : ""} money.`
          : `${label}: the close recorded card ${gbp(storedCard)}; the day's card payments now come to ${gbp(dayCard)}.`,
        run.day,
      );
    }
    const personalCost = personalCostByDay.get(run.day) ?? 0;
    if (p(run.personal_use_cost) !== personalCost) {
      say(
        "personalUse",
        `${label}: the close reported personal use of ${gbp(p(run.personal_use_cost))}; the goods taken cost ${gbp(personalCost)} (the close is using their sale price).`,
        run.day,
      );
    }
    const commissionNow = commissionByDay.get(run.day) ?? 0;
    if (p(run.commission_accrued) !== commissionNow) {
      say("close", `${label}: the close recorded commission of ${gbp(p(run.commission_accrued))}; the commission ledger for that day now holds ${gbp(commissionNow)}.`, run.day);
    }
    if (p(run.credit_given) !== (creditGivenByDay.get(run.day) ?? 0)) {
      say("close", `${label}: the close recorded credit given out of ${gbp(p(run.credit_given))}; the Credit List now shows ${gbp(creditGivenByDay.get(run.day) ?? 0)} given that day.`, run.day);
    }
    if (p(run.credit_resolved) !== (creditPaidByDay.get(run.day) ?? 0)) {
      say("close", `${label}: the close recorded ${gbp(p(run.credit_resolved))} paid off tabs; the tab payments for that day now come to ${gbp(creditPaidByDay.get(run.day) ?? 0)}.`, run.day);
    }
  }

  // --- 2. deleted settled sales
  const deleted = (
    await db.query(
      `SELECT order_id, at, user_id, meta FROM order_events
        WHERE org_id = $1 AND kind = 'deleted' AND at >= $2 AND at < $3 ORDER BY at`,
      [orgId, start, end],
    )
  ).rows;
  for (const e of deleted) {
    const status = e.meta?.status;
    if (status !== "completed") continue;
    const day = tradingDayFor(new Date(e.at), tz);
    say(
      "deleted",
      `${dayName(day)}: settled sale ${short(e.order_id)} (${gbp(p(e.meta?.total))}) was deleted. ` +
        `It had already been counted in its day's takings, close, drawer and commission; deleting it rewrites those figures.`,
      day,
    );
  }

  // --- 3. payments add up; 4. order arithmetic
  for (const o of orders) {
    if (o.status !== "completed" || isPersonal(o.payment_method)) continue;
    const ls = legsBy.get(o.id) ?? [];
    const settled = p(o.settled_total ?? o.total);
    const legSum = ls.reduce((s, l) => s + p(l.amount), 0);
    const day = o.settled_at ? tradingDayFor(new Date(o.settled_at), tz) : undefined;
    if (ls.length > 0 && legSum !== settled) {
      say("legs", `Sale ${short(o.id)} was settled at ${gbp(settled)} but its payments add up to ${gbp(legSum)}.`, day);
    }
    if (p(o.total) !== settled) {
      say("legs", `Sale ${short(o.id)} was settled at ${gbp(settled)} but now totals ${gbp(p(o.total))}: takings use the first figure, the till and shift sheets the second.`, day);
    }
  }
  for (const o of orders) {
    if (o.subtotal === null || o.subtotal === undefined || isPersonal(o.payment_method)) continue;
    const lineSum = (itemsBy.get(o.id) ?? []).reduce((s, it) => s + p(it.total_price), 0);
    // The delivery fee (v1.2.1) sits on top of the goods; its VAT is in vat_amount.
    const expected = p(o.subtotal) - p(o.tier_discount) - p(o.promo_discount) + p(o.delivery_fee) + p(o.vat_amount) - p(o.points_discount);
    if (lineSum !== p(o.subtotal)) {
      say("arithmetic", `Order ${short(o.id)}: its lines add up to ${gbp(lineSum)} but its subtotal says ${gbp(p(o.subtotal))}.`);
    }
    if (expected !== p(o.total)) {
      say("arithmetic", `Order ${short(o.id)}: subtotal less discounts plus VAT is ${gbp(expected)}, but its total is ${gbp(p(o.total))}.`);
    }
  }

  // --- 5. till drawers and refund tender
  const tills = (
    await db.query(
      `SELECT id, user_id, opened_at, closed_at, opening_float, expected_cash, closing_count, variance, tab_cash_in_expected
         FROM shifts WHERE org_id = $1 AND closed_at >= $2 AND closed_at < $3 AND status = 'closed'`,
      [orgId, start, end],
    )
  ).rows;
  for (const t of tills) {
    const tillOrders = (await db.query(`SELECT id, payment_method, status FROM orders WHERE shift_id = $1`, [t.id])).rows;
    const tIds = tillOrders.map((o: any) => o.id);
    const tLegs = tIds.length
      ? (await db.query(`SELECT method, amount, status FROM order_payments WHERE order_id = ANY($1::uuid[])`, [tIds])).rows
      : [];
    const cashIn = tLegs.filter((l: any) => isCash(l.method) && l.status === "paid").reduce((s: number, l: any) => s + p(l.amount), 0);
    const tRefunds = (await db.query(`SELECT refund_method, total, credit_amount FROM refunds WHERE shift_id = $1`, [t.id])).rows;
    // Only what was paid out leaves the drawer; a part taken off a tab never did.
    const cashOut = tRefunds
      .filter((r: any) => r.refund_method === "cash" || r.refund_method === "original")
      .reduce((s: number, r: any) => s + p(r.total) - p(r.credit_amount), 0);
    const repaid = t.tab_cash_in_expected
      ? (
          await db.query(`SELECT COALESCE(SUM(amount),0) AS a FROM credit_payments WHERE shift_id = $1 AND lower(method) = 'cash'`, [t.id])
        ).rows[0].a
      : 0;
    const expectedNow = p(t.opening_float) + cashIn - cashOut + p(repaid);
    const day = tradingDayFor(new Date(t.opened_at), tz);
    if (t.expected_cash !== null && p(t.expected_cash) !== expectedNow) {
      say(
        "drawers",
        `${dayName(day)}: a till cashed up expecting ${gbp(p(t.expected_cash))}; its sales, refunds and tab payments now come to ${gbp(expectedNow)}. The drawer's sales changed after it was counted.`,
        day,
      );
    }
    const unsettled = tillOrders.filter((o: any) => o.status !== "completed" && !isPersonal(o.payment_method));
    if (unsettled.length > 0) {
      say(
        "unsettledInSheets",
        `${dayName(day)}: the Z report for a till counts ${unsettled.length} order(s) that were never settled (${unsettled.map((o: any) => short(o.id)).join(", ")}), so its sales disagree with the day's takings.`,
        day,
      );
    }
  }
  for (const r of refunds) {
    if (r.refund_method !== "cash") continue;
    const ls = legsBy.get(r.order_id) ?? (await db.query(`SELECT method, amount, status FROM order_payments WHERE order_id = $1`, [r.order_id])).rows;
    const tookCash = ls.some((l: any) => isCash(l.method));
    if (!tookCash) {
      const how = [...new Set(ls.map((l: any) => String(l.method)))].join(" and ") || String(r.payment_method);
      const day = tradingDayFor(new Date(r.created_at), tz);
      say(
        "refundTender",
        `${dayName(day)}: a refund of ${gbp(p(r.total))} on sale ${short(r.order_id)}, which was paid by ${how}, was paid out of the cash drawer. ` +
          (ls.some((l: any) => /tick|credit/i.test(String(l.method)))
            ? `The sale was on the Credit List, so the customer was handed cash for goods they had not paid for; the refund should have come off their tab.`
            : `Check the customer was given cash; if it went back to their card, the drawer's expected cash is ${gbp(p(r.total))} too low.`),
        day,
      );
    }
  }

  // --- 6. cashier shift sheets
  const sheets = (
    await db.query(
      `SELECT s.shift_id, s.gross_sales, s.commission_amount, s.closed_at, c.trading_day::text AS trading_day,
              COALESCE((SELECT SUM(e.amount) FROM cashier_commission_entries e
                         WHERE e.cashier_shift_id = s.shift_id AND e.reversal_of IS NULL), 0) AS ledger
         FROM cashier_shift_summaries s JOIN cashier_shifts c ON c.id = s.shift_id
        WHERE s.org_id = $1 AND s.closed_at >= $2 AND s.closed_at < $3`,
      [orgId, start, end],
    )
  ).rows;
  for (const sh of sheets) {
    const rows = (
      await db.query(
        `SELECT id, total, status, payment_method FROM orders
          WHERE COALESCE(completed_cashier_shift_id, cashier_shift_id) = $1`,
        [sh.shift_id],
      )
    ).rows;
    const grossNow = rows.filter((o: any) => !isPersonal(o.payment_method)).reduce((s: number, o: any) => s + Math.max(0, p(o.total)), 0);
    const day = sh.trading_day ?? tradingDayFor(new Date(sh.closed_at), tz);
    if (p(sh.gross_sales) !== grossNow) {
      say("shiftSheets", `${dayName(day)}: a cashier shift sheet recorded sales of ${gbp(p(sh.gross_sales))}; its orders now come to ${gbp(grossNow)}.`, day);
    }
    if (p(sh.commission_amount) !== p(sh.ledger)) {
      say(
        "commissionPayroll",
        `${dayName(day)}: a cashier shift sheet (the payroll row) says ${gbp(p(sh.commission_amount))} commission; the commission ledger for that shift now holds ${gbp(p(sh.ledger))}.`,
        day,
      );
    }
    const unsettled = rows.filter((o: any) => o.status !== "completed" && !isPersonal(o.payment_method));
    if (unsettled.length > 0) {
      say(
        "unsettledInSheets",
        `${dayName(day)}: a cashier shift sheet counts ${unsettled.length} unsettled order(s) (${gbp(unsettled.reduce((s: number, o: any) => s + p(o.total), 0))}) as sales and commission.`,
        day,
      );
    }
  }

  // Commission earned when a tab is paid belongs to no shift, so no shift
  // sheet — and no payroll row — carries it.
  for (const r of (
    await db.query(
      `SELECT accrued_on::text AS day, SUM(amount) AS amount, COUNT(*)::int AS n FROM cashier_commission_entries
        WHERE org_id = $1 AND cashier_shift_id IS NULL AND reversal_of IS NULL AND accrued_on BETWEEN $2::date AND $3::date
        GROUP BY 1 ORDER BY 1`,
      [orgId, from, to],
    )
  ).rows) {
    say(
      "commissionPayroll",
      `${dayName(r.day)}: ${gbp(p(r.amount))} of commission earned when tabs were paid is in the commission ledger but on no payroll row, so it is never shown as owed.`,
      r.day,
    );
  }

  // --- 7. the Credit List (whole book, not just the window: a tab is a tab)
  const tabs = (
    await db.query(
      `SELECT c.order_id, c.amount_given, c.amount_outstanding, c.status,
              COALESCE((SELECT SUM(cp.amount) FROM credit_payments cp WHERE cp.order_id = c.order_id), 0) AS paid,
              COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = c.order_id), 0) AS refunded,
              COALESCE((SELECT SUM(r.credit_amount) FROM refunds r WHERE r.order_id = c.order_id), 0) AS off_tab,
              o.status AS order_status
         FROM order_credit c JOIN orders o ON o.id = c.order_id
        WHERE c.org_id = $1`,
      [orgId],
    )
  ).rows;
  for (const t of tabs) {
    if (t.status === "written_off" || t.status === "voided") continue;
    const expected = Math.max(0, p(t.amount_given) - p(t.paid) - p(t.off_tab));
    if (p(t.amount_outstanding) !== expected) {
      say(
        "credit",
        `Tab on sale ${short(t.order_id)}: ${gbp(p(t.amount_given))} given, ${gbp(p(t.paid))} paid` +
          (p(t.off_tab) ? `, ${gbp(p(t.off_tab))} refunded off the tab` : "") +
          `, but the Credit List says ${gbp(p(t.amount_outstanding))} is outstanding (expected ${gbp(expected)}).`,
      );
    }
    // A refund paid out while the tab is still owed: it should have come off the tab.
    const paidOutRefund = p(t.refunded) - p(t.off_tab);
    if (paidOutRefund > 0 && p(t.amount_outstanding) > 0) {
      say(
        "refundedTabs",
        `Tab on sale ${short(t.order_id)}: ${gbp(paidOutRefund)} of the sale was refunded and paid out, but the customer is still shown owing ${gbp(p(t.amount_outstanding))} for it.`,
      );
    }
    if (t.order_status !== "completed" && ["outstanding", "partial"].includes(t.status)) {
      say("credit", `Tab on sale ${short(t.order_id)} is outstanding but the sale itself is not settled.`);
    }
  }

  // --- 8. backdated sales on the right day
  for (const o of orders) {
    if (o.date_kind !== "backdated" || o.status !== "completed" || !o.settled_at || !o.created_at) continue;
    const datedDay = tradingDayFor(new Date(o.created_at), tz);
    const countedDay = tradingDayFor(new Date(o.settled_at), tz);
    if (datedDay !== countedDay) {
      say(
        "backdated",
        `Sale ${short(o.id)} (${gbp(p(o.settled_total ?? o.total))}) is dated ${dayName(datedDay)} but takings count it on ${dayName(countedDay)}, the day it was keyed in and settled.`,
        countedDay,
      );
    }
  }

  // --- 9. personal use
  for (const o of orders) {
    if (!isPersonal(o.payment_method) || o.status !== "completed") continue;
    // (Its lines keep their value at sale price, as a record of what was
    // taken; since v1.2.1 every product figure leaves personal use out.)
    const day = o.settled_at ? tradingDayFor(new Date(o.settled_at), tz) : undefined;
    if (p(o.total) !== 0) {
      say("personalUse", `Personal use ${short(o.id)} has a total of ${gbp(p(o.total))}; it should be £0.00.`, day);
    }
  }

  // --- 10. refunds
  const linesByRefund = new Map<string, any[]>();
  for (const l of refundLines) linesByRefund.set(l.refund_id, [...(linesByRefund.get(l.refund_id) ?? []), l]);
  const refundedByOrder = new Map<string, number>();
  for (const r of refunds) add(refundedByOrder, r.order_id, p(r.total));
  for (const r of refunds) {
    const day = tradingDayFor(new Date(r.created_at), tz);
    if (r.order_status !== "completed") {
      say("refunds", `${dayName(day)}: ${gbp(p(r.total))} was refunded on order ${short(r.order_id)}, which was never settled — the refund comes off takings for money that was never counted in.`, day);
    }
    // A refund of the delivery fee (v1.2.1) has no line: it is on the refund row.
    const lineSum = (linesByRefund.get(r.id) ?? []).reduce((s, l) => s + p(l.amount), 0) + p(r.refund_fee);
    if (lineSum !== p(r.total)) {
      say("refunds", `${dayName(day)}: refund on ${short(r.order_id)} totals ${gbp(p(r.total))} but its lines add up to ${gbp(lineSum)}.`, day);
    }
    // Paid for those lines: the settled total shared across lines by their
    // value, so a discount on the sale is honoured on the way back too.
    // The refunded items at their list price, shared the same way; a penny
    // a line either way is rounding (the last refund of a sale takes it up).
    const orderLineValue = p(r.subtotal);
    const rLines = linesByRefund.get(r.id) ?? [];
    const listValue = rLines.reduce((s, l) => s + Math.round(Number(l.qty) * p(l.unit_price)), 0);
    if (orderLineValue > 0 && listValue > 0) {
      // The fee (as charged, VAT included) is not the goods' money.
      const feeCharged = Math.round(p(r.delivery_fee) * (1 + Number(r.vat_rate ?? 0) / 100));
      const settled = Math.max(0, p(r.settled_total ?? r.order_total) - feeCharged);
      const paidForLines = Math.round((listValue * settled) / orderLineValue);
      // Only giving back MORE than was paid is a leak; a smaller refund (a
      // goodwill part-refund) is the refunder's call.
      if (lineSum - p(r.refund_fee) - paidForLines > rLines.length + 1) {
        say(
          "refunds",
          `${dayName(day)}: refund on sale ${short(r.order_id)} gave back ${gbp(lineSum)} for items the customer paid ${gbp(paidForLines)} for (the sale's discount was not taken off the refund).`,
          day,
        );
      }
    }
  }
  for (const [orderId, refunded] of refundedByOrder) {
    const o = orderById.get(orderId) ?? refunds.find((r) => r.order_id === orderId);
    const settled = p(o?.settled_total ?? o?.total ?? o?.order_total);
    if (refunded > settled + 1) {
      say("refunds", `Sale ${short(orderId)} has been refunded ${gbp(refunded)}, more than the ${gbp(settled)} it was settled at.`);
    }
  }

  // (Small-hours sales used to be checked here: the Truths overview and the
  // revenue charts bucketed by UTC date. Since v1.2.1 every figure uses the
  // 06:00 trading day, so there is nothing left to disagree.)

  return { orgId, orgName: org.name, timeZone: tz, from, to, days, problems };
}

export async function reconcileFigures(db: Queryable, opts: ReconcileOptions): Promise<OrgReconciliation[]> {
  const orgs = (
    await db.query(
      opts.orgId
        ? `SELECT id, name, timezone FROM organizations WHERE id = $1`
        : `SELECT id, name, timezone FROM organizations ORDER BY name`,
      opts.orgId ? [opts.orgId] : [],
    )
  ).rows;
  const out: OrgReconciliation[] = [];
  for (const org of orgs) out.push(await reconcileOrg(db, org, opts));
  return out;
}

/** Runs `fn` on one connection inside a READ ONLY transaction that is always rolled back. */
export async function withReadOnlyDb<T>(connectionString: string, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString, ssl: sslFor(connectionString), max: 1 });
  const conn = await pool.connect();
  const db: Queryable = { query: (text, params) => conn.query(text, params) as Promise<{ rows: any[] }> };
  try {
    await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout = '60s'");
    return await fn(db);
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    conn.release();
    await (pool as unknown as { end: () => Promise<void> }).end().catch(() => undefined);
  }
}

// --------------------------------------------------------------- the report

export function formatReconciliation(reports: OrgReconciliation[], opts: { showDays?: boolean } = {}): string {
  const out: string[] = [];
  for (const r of reports) {
    out.push(`arcarna figures check — ${r.orgName}`);
    out.push(`Trading days ${dayName(r.from)} to ${dayName(r.to)} (06:00 to 06:00, ${r.timeZone}). Read only: nothing was changed.`);
    if (opts.showDays !== false) {
      out.push("");
      out.push("Day            Sales    Gross   Refunds   Takings     Cash     Card  Card link  Gift card   Credit  Open");
      for (const d of r.days) {
        if (d.sales === 0 && d.refunds === 0 && d.open === 0) continue;
        const col = (pence: number, w: number) => (pence / 100).toFixed(2).padStart(w);
        out.push(
          `${dayName(d.day).padEnd(13)}${String(d.sales).padStart(6)}${col(d.gross, 9)}${col(d.refunds, 10)}${col(d.takings, 10)}` +
            `${col(d.cash, 9)}${col(d.card, 9)}${col(d.cardLink, 11)}${col(d.giftCard, 11)}${col(d.credit, 9)}${String(d.open).padStart(6)}`,
        );
      }
    }
    out.push("");
    const byCheck = new Map<CheckId, Problem[]>();
    for (const pr of r.problems) byCheck.set(pr.check, [...(byCheck.get(pr.check) ?? []), pr]);
    const passed = (Object.keys(CHECKS) as CheckId[]).filter((c) => !byCheck.has(c));
    if (byCheck.size === 0) {
      out.push(`All ${passed.length} checks passed: the figures match the orders.`);
    } else {
      out.push(`${r.problems.length} thing(s) do not add up, in ${byCheck.size} of ${Object.keys(CHECKS).length} checks.`);
      for (const [check, list] of byCheck) {
        out.push("");
        out.push(`PROBLEM  ${CHECKS[check]} (${list.length})`);
        for (const pr of list) out.push(`  - ${pr.message}`);
      }
      out.push("");
      out.push(`Passed: ${passed.map((c) => CHECKS[c].toLowerCase()).join("; ")}.`);
    }
    out.push("");
  }
  return out.join("\n");
}

export function totalProblems(reports: OrgReconciliation[]): number {
  return reports.reduce((s, r) => s + r.problems.length, 0);
}
