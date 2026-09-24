/**
 * Reads every money figure the app shows for the money dataset, as each role
 * would, and compares it with the ground truth the dataset's journal records
 * (what money actually changed hands, and on which trading day).
 *
 *   npx tsx tests/money/checkFigures.ts [evidenceDir]
 *
 * Writes every response it read to evidenceDir (default /tmp/money-evidence)
 * and prints one line per mismatch.
 */
import fs from "node:fs";
import path from "node:path";
import { api, SEED_USERS } from "./client";

const STATE = process.env.MONEY_STATE ?? "/tmp/money-state.json";
const OUT = process.argv[2] ?? "/tmp/money-evidence";
fs.mkdirSync(OUT, { recursive: true });

const s = JSON.parse(fs.readFileSync(STATE, "utf8"));
const hdr = { "x-org-id": s.orgId };
const ADMIN = SEED_USERS.ADMIN;
const MANAGER = SEED_USERS.MANAGER;
const CASHIER = SEED_USERS.CASHIER;

const mismatches: string[] = [];
const oks: string[] = [];
const r2 = (n: number) => Math.round(n * 100) / 100;
function cmp(what: string, app: number | undefined | null, truth: number) {
  const a = Number(app ?? NaN);
  if (!Number.isFinite(a) || Math.abs(a - truth) > 0.005) mismatches.push(`${what}: app ${app} vs truth ${r2(truth)}`);
  else oks.push(`${what}: ${r2(truth)}`);
}

async function get(user: string, p: string, name: string) {
  const r = await api(user, "GET", p, undefined, hdr);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ status: r.status, path: p, user, body: r.body }, null, 2));
  return r;
}
function shiftIso(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

async function main() {
  const cc = await get(ADMIN, "/api/control-centre", "control-centre.admin");
  const today: string = cc.body.tradingDay;
  const lastIdx = Math.max(...s.journal.map((j: any) => j.day));
  const dayOf = (i: number) => shiftIso(today, i - lastIdx);

  // ---- ground truth per trading day
  type T = { takings: number; sales: number; cash: number; card: number; cardLink: number; gift: number; tick: number; refunds: number; repaidCash: number; repaidCard: number };
  const truth = new Map<string, T>();
  const t = (d: string) => {
    if (!truth.has(d)) truth.set(d, { takings: 0, sales: 0, cash: 0, card: 0, cardLink: 0, gift: 0, tick: 0, refunds: 0, repaidCash: 0, repaidCard: 0 });
    return truth.get(d)!;
  };
  for (const j of s.journal) {
    const d = t(dayOf(j.day));
    if (j.kind === "sale" && !j.personalUse) {
      d.takings += j.amount;
      d.sales += 1;
      d.cash += j.tender.cash ?? 0;
      d.card += j.tender.card ?? 0;
      d.cardLink += j.tender.card_link ?? 0;
      d.gift += j.tender.gift_card ?? 0;
      d.tick += j.tender.tick ?? 0;
    }
    if (j.kind === "refund") {
      d.takings -= j.amount;
      d.refunds += j.amount;
    }
    if (j.kind === "repayment") {
      d.repaidCash += j.tender.cash ?? 0;
      d.repaidCard += j.tender.card ?? 0;
    }
  }

  // ---- Control Centre (today, and the 7-day trend)
  cmp(`Control Centre today's takings (${today})`, cc.body.today?.revenue, t(today).takings);
  for (const pt of cc.body.revenueTrend ?? []) cmp(`Control Centre trend ${pt.date}`, pt.revenue, t(pt.date).takings);
  const tabsTruth = (() => {
    const owed = new Map<string, number>();
    for (const j of s.journal) {
      if (j.kind === "sale" && j.tender.tick) owed.set(j.orderRef, (owed.get(j.orderRef) ?? 0) + j.tender.tick);
      if (j.kind === "repayment") owed.set(j.orderRef, (owed.get(j.orderRef) ?? 0) - j.amount);
      if (j.kind === "refund" && j.tender.tick) owed.set(j.orderRef, (owed.get(j.orderRef) ?? 0) - j.tender.tick);
    }
    return [...owed.values()].reduce((a, b) => a + Math.max(0, b), 0);
  })();
  cmp("Control Centre credit outstanding", cc.body.creditOutstandingTotal, tabsTruth);
  const openTruth = s.journal.filter((j: any) => j.kind === "open" && !s.journal.some((k: any) => k.kind === "sale" && k.orderRef === j.orderRef)).length;
  cmp("Control Centre open orders", cc.body.openOrders, openTruth);
  const ccCashier = await get(CASHIER, "/api/control-centre", "control-centre.cashier");
  if (ccCashier.body?.creditOutstandingTotal !== 0) mismatches.push(`Control Centre as cashier shows credit total ${ccCashier.body?.creditOutstandingTotal}`);

  // ---- business health (the scheduled report / assistant source)
  const bh = await get(ADMIN, "/api/business-health", "business-health");
  cmp(`Business health revenueToday (should be trading day ${today})`, bh.body.revenueToday, t(today).takings);

  // ---- Daily Sales, every day
  for (let i = 0; i <= lastIdx; i++) {
    const d = dayOf(i);
    const r = await get(ADMIN, `/api/reports/ARC-T1-001?from=${d}`, `daily-sales.${d}`);
    const sum = r.body.summary ?? {};
    const tr = t(d);
    cmp(`Daily Sales ${d} total`, sum.totalRevenue, tr.takings);
    cmp(`Daily Sales ${d} orders`, sum.ordersProcessed, tr.sales);
    // Tender split: gross by tender (refunds are netted per order inside the app's split)
    const refundByTender = { cash: 0, card: 0, tick: 0 };
    void refundByTender;
    cmp(`Daily Sales ${d} cash+card+link+gift+tick = total`, r2((sum.cashRevenue ?? 0) + (sum.cardRevenue ?? 0) + (sum.tickRevenue ?? 0) + (sum.giftCardRevenue ?? 0) + (sum.websiteRevenue ?? 0) + (sum.otherRevenue ?? 0)), sum.totalRevenue ?? 0);
  }

  // ---- Weekly Sales + Weekly Margin over two weeks
  for (const [from, to] of [[dayOf(0), dayOf(6)], [dayOf(7), dayOf(13)], [dayOf(lastIdx - 6), dayOf(lastIdx)]]) {
    const w = await get(ADMIN, `/api/reports/ARC-T1-004?from=${from}&to=${to}`, `weekly-sales.${from}`);
    let tk = 0, n = 0;
    for (let d = from; d <= to; d = shiftIso(d, 1)) { tk += t(d).takings; n += t(d).sales; }
    cmp(`Weekly Sales ${from}..${to} total`, w.body.summary?.totalRevenue, tk);
    cmp(`Weekly Sales ${from}..${to} orders`, w.body.summary?.totalOrders, n);
    const m = await get(ADMIN, `/api/reports/ARC-T2-001?from=${from}&to=${to}`, `weekly-margin.${from}`);
    fs.writeFileSync(path.join(OUT, `weekly-margin.${from}.rows.txt`), JSON.stringify(m.body.rows ?? [], null, 1));
    const sp = await get(ADMIN, `/api/evidence/staff-performance?from=${from}&to=${to}`, `staff-performance.${from}`);
    let gross = 0;
    for (let d = from; d <= to; d = shiftIso(d, 1)) gross += t(d).takings + t(d).refunds;
    cmp(`Staff Performance ${from}..${to} gross settled sales`, sp.body.grossSettledSales ?? sp.body.team?.grossSettledSales, gross);
    await get(ADMIN, `/api/evidence/order-timing?from=${from}&to=${to}`, `order-timing.${from}`);
    await get(ADMIN, `/api/reports/ARC-T2-002?from=${from}&to=${to}`, `staff-report.${from}`);
    const hub = await get(ADMIN, `/api/reports?from=${from}&to=${to}`, `truths-hub.${from}`);
    cmp(`Truths hub revenue ${from}..${to}`, hub.body?.revenue?.total, tk);
  }

  // ---- Truths charts (calendar days)
  const dr = await get(ADMIN, "/api/analytics/daily-revenue?days=30", "daily-revenue");
  for (const row of Array.isArray(dr.body) ? dr.body : []) {
    const d = String(row.date).slice(0, 10);
    if (truth.has(d)) cmp(`Daily revenue chart ${d}`, row.revenue, t(d).takings);
  }
  await get(ADMIN, "/api/analytics/monthly-summary", "monthly-summary");

  // ---- daily close signals / runs
  await get(ADMIN, "/api/notifications", "notifications");

  // ---- Credit List
  const tick = await get(ADMIN, "/api/tick-customers", "tick-customers");
  const tickTotal = (Array.isArray(tick.body) ? tick.body : tick.body?.customers ?? []).reduce((a: number, c: any) => a + Number(c.totalDebt ?? c.outstanding ?? 0), 0);
  cmp("Credit List total outstanding", tickTotal, tabsTruth);
  await get(ADMIN, "/api/credit/outstanding", "credit-outstanding");
  await get(MANAGER, "/api/tick-customers", "tick-customers.manager");
  const tickCashier = await get(CASHIER, "/api/tick-customers", "tick-customers.cashier");
  if (tickCashier.status !== 403) mismatches.push(`Credit List as cashier: ${tickCashier.status}`);

  // ---- tills and Z reports
  const shifts = await get(ADMIN, "/api/shifts?hours=168", "shifts");
  const list: any[] = Array.isArray(shifts.body) ? shifts.body : shifts.body?.shifts ?? [];
  for (const sh of list) {
    const z = await get(ADMIN, `/api/shifts/${sh.id}/report`, `z.${sh.id.slice(0, 8)}`);
    const v = z.body?.report?.cashSummary?.variance;
    if (v != null && Math.abs(Number(v)) > 0.005) mismatches.push(`Till ${sh.id.slice(0, 8)} (${sh.userId ?? sh.userName}, opened ${sh.openedAt}): variance ${v} against a ground-truth count`);
  }
  const cs = await get(ADMIN, "/api/cashier-shifts", "cashier-shifts");
  for (const c of (Array.isArray(cs.body) ? cs.body : []).slice(0, 60)) await get(ADMIN, `/api/cashier-shifts/${c.id}/summary`, `cashier-shift.${c.id.slice(0, 8)}`);
  await get(ADMIN, "/api/cashier-commission", "cashier-commission");
  await get(ADMIN, "/api/cashier-commission/payments", "cashier-commission-payments");
  await get(ADMIN, "/api/orders/board", "ops-board");
  await get(ADMIN, "/api/invoices", "invoices");
  await get(CASHIER, "/api/my-performance", "my-performance.cashier");
  await get("money-cashier-02", "/api/my-performance", "my-performance.cashier02");
  await get(MANAGER, "/api/my-performance", "my-performance.manager");

  for (const d of [...truth.keys()].sort()) {
    const x = truth.get(d)!;
    oks.push(`truth ${d}: takings ${r2(x.takings)} sales ${x.sales} cash ${r2(x.cash)} card ${r2(x.card)} link ${r2(x.cardLink)} gift ${r2(x.gift)} tick ${r2(x.tick)} refunds ${r2(x.refunds)}`);
  }
  fs.writeFileSync(path.join(OUT, "_summary.txt"), [...mismatches.map((m) => `MISMATCH ${m}`), ...oks.map((o) => `ok ${o}`)].join("\n"));
  console.log(mismatches.map((m) => `MISMATCH ${m}`).join("\n"));
  console.log(`${mismatches.length} mismatch(es), ${oks.length} ok; evidence in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
