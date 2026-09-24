/**
 * The money audit dataset, one trading day at a time, through the app's API.
 *
 *   npx tsx tests/money/buildDataset.ts setup           # products, people, second shop
 *   npx tsx tests/money/buildDataset.ts day <i> <last>  # trade day i of 0..last
 *
 * `tests/money/run.sh` drives it: trade a day, cash up, move the database
 * back a day (timeTravel.ts), run the 06:00 close (closeDay.ts), repeat. The
 * last day is left trading, as "today".
 *
 * Alongside the API calls it keeps a journal of what money actually changed
 * hands — the ground truth the figures are checked against, written by the
 * scenario's author rather than read back from the app.
 */
import fs from "node:fs";
import pg from "pg";
import { api, must, SEED_USERS } from "./client";

const STATE = process.env.MONEY_STATE ?? "/tmp/money-state.json";

const CASHIER = SEED_USERS.CASHIER;
const CASHIER2 = "money-cashier-02";
const MANAGER = SEED_USERS.MANAGER;
const ADMIN = SEED_USERS.ADMIN;

type Journal = {
  day: number;
  kind:
    | "sale" // an order settled (completed) this day
    | "refund"
    | "repayment"
    | "deleted" // a settled order removed
    | "open"; // an order taken and not settled this day
  orderRef: string;
  orderId?: string;
  /** value of the settlement / refund / repayment */
  amount: number;
  /** the money actually taken or given back, by tender */
  tender: Record<string, number>;
  location: "main" | "second";
  by: string;
  /** whose till took the money, when not `by` */
  taker?: string;
  personalUse?: boolean;
  note?: string;
};

type State = {
  orgId: string;
  mainId: string;
  secondId: string;
  products: Record<string, { id: string; price: number; cost: number | null; minPrice?: number }>;
  customers: Record<string, string>;
  orders: Record<string, { id: string; day: number; total: number; lines?: any[] }>;
  giftCardCode?: string;
  promoCode?: string;
  journal: Journal[];
  tills: Record<string, string>; // `${day}:${user}` -> till shift id
  attempts: Array<{ day: number; what: string; status: number; body: string }>;
};

function load(): State {
  return JSON.parse(fs.readFileSync(STATE, "utf8"));
}
function save(s: State) {
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
}
const r2 = (n: number) => Math.round(n * 100) / 100;

async function setup() {
  const me = await must(ADMIN, "GET", "/api/auth/user");
  const orgId = me.orgId as string;
  const hdr = { "x-org-id": orgId };
  const locations = await must<any[]>(ADMIN, "GET", "/api/locations", undefined, hdr);
  const mainId = (locations.find((l) => l.isDefault === 1) ?? locations[0]).id;

  // Staff login for a second cashier: setup, the way the seed makes logins.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(
    `INSERT INTO allowed_users (replit_user_id, email, name, org_id, role)
     VALUES ($1, 'cashier02@example.invalid', 'Cashier 02', $2, 'CASHIER')
     ON CONFLICT (replit_user_id) DO NOTHING`,
    [CASHIER2, orgId],
  );
  await pool.end();

  // Production runs at 0% VAT; commission on, 10%.
  await must(ADMIN, "PATCH", "/api/org/setup", {
    cashierCommissionEnabled: true,
    defaultCashierCommissionRate: 10,
    defaultTaxRate: "0",
  }, hdr);

  const second = await must(ADMIN, "POST", "/api/locations", { name: "Second Shop", address: "2 Test Street", city: "Testford", state: "Testshire", zipCode: "TE1 1ST", phone: "07700900199", email: "second@example.invalid", isActive: true }, hdr);

  const products: State["products"] = {};
  const defs: Array<[string, number, number | null, number | undefined]> = [
    ["Widget", 10, 4, undefined],
    ["Gadget", 25, 12, undefined],
    ["Gizmo", 7.5, null, undefined], // unknown cost
    ["Floor Item", 20, 9, 15], // has a minimum price
  ];
  for (const [name, price, cost, minPrice] of defs) {
    const suffix = Date.now().toString(36);
    const p = await must(ADMIN, "POST", "/api/products", {
      name: `Money ${name}`,
      productCode: `MNY-${name.slice(0, 3).toUpperCase()}-${suffix}`,
      ...(cost == null ? {} : { costPrice: cost }),
      salePrice: price,
      defaultSalePrice: price,
      ...(minPrice ? { minPrice } : {}),
      stock: 0,
      stockLimit: 5000,
    }, hdr);
    for (const loc of [mainId, second.id]) {
      await must(ADMIN, "PATCH", `/api/inventory/${p.id}`, { adjustment: 2000, type: "set" }, { ...hdr, "x-location-id": loc });
    }
    products[name] = { id: p.id, price, cost, minPrice };
  }

  const customers: Record<string, string> = {};
  for (const [key, name, phone] of [
    ["alice", "Alice Tabwell", "07700900101"],
    ["bob", "Bob Ledger", "07700900102"],
    ["cara", "Cara Points", "07700900103"],
  ]) {
    const c = await must(MANAGER, "POST", "/api/customers", {
      name,
      phone,
      email: `${key}@example.invalid`,
      confirmNew: true,
    }, hdr);
    customers[key] = c.id ?? c.customer?.id;
  }

  // POST /api/promotions refuses every JSON body: its schema wants Date
  // objects for startDate/endDate and JSON only carries strings (finding:
  // the Promotions page cannot create or edit a promotion). The promotion is
  // therefore set up the way the seed would, and is then used through the
  // till's own promo path like any other.
  const promo = await api(ADMIN, "POST", "/api/promotions", {
    name: "Money ten off",
    code: "MONEY10",
    type: "percentage",
    value: "10",
    startDate: new Date(Date.now() - 40 * 86400000).toISOString(),
    endDate: new Date(Date.now() + 40 * 86400000).toISOString(),
    isActive: 1,
  }, hdr);
  if (!promo.ok) {
    const pool2 = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await pool2.query(
      `INSERT INTO promotions (org_id, name, code, type, value, start_date, end_date, is_active)
       VALUES ($1, 'Money ten off', 'MONEY10', 'percentage', 10, now() - interval '40 days', now() + interval '40 days', 1)`,
      [orgId],
    );
    await pool2.end();
  }

  const state: State = {
    orgId,
    mainId,
    secondId: second.id,
    products,
    customers,
    orders: {},
    promoCode: "MONEY10",
    journal: [],
    tills: {},
    attempts: promo.ok ? [] : [{ day: -1, what: "create promotion", status: promo.status, body: promo.text.slice(0, 300) }],
  };
  save(state);
  console.log(JSON.stringify({ orgId, mainId, secondId: second.id, promo: promo.status }));
}

// ---------------------------------------------------------------- trading

type Line = { product: string; qty: number; price?: number };

class Day {
  constructor(public s: State, public day: number, public last: number) {}
  hdr(loc: "main" | "second") {
    return { "x-org-id": this.s.orgId, "x-location-id": loc === "main" ? this.s.mainId : this.s.secondId };
  }
  lines(ls: Line[]) {
    return ls.map((l) => ({
      productId: this.s.products[l.product].id,
      quantity: l.qty,
      unitPrice: l.price ?? this.s.products[l.product].price,
    }));
  }
  note(what: string, r: { status: number; text: string }) {
    this.s.attempts.push({ day: this.day, what, status: r.status, body: r.text.slice(0, 400) });
  }

  async openTill(user: string, loc: "main" | "second", float: number) {
    const key = `${this.day}:${user}`;
    const cur = await api(user, "GET", "/api/shifts/current", undefined, this.hdr(loc));
    const existing = cur.body?.shift;
    if (existing?.status === "open") {
      this.s.tills[key] = existing.id;
      return existing.id;
    }
    const opened = await must(user, "POST", "/api/shifts/open", {
      locationId: loc === "main" ? this.s.mainId : this.s.secondId,
      openingFloat: float,
    }, this.hdr(loc));
    this.s.tills[key] = opened.id;
    return opened.id as string;
  }

  /** Places an order; returns the order id and total as the app priced it. */
  async place(
    ref: string,
    user: string,
    loc: "main" | "second",
    ls: Line[],
    paymentMethod: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; total: number } | null> {
    const r = await api(user, "POST", "/api/orders", { lines: this.lines(ls), paymentMethod, ...extra }, this.hdr(loc));
    if (!r.ok) {
      this.note(`place ${ref}`, r);
      console.warn(`  ! place ${ref}: ${r.status} ${r.text.slice(0, 200)}`);
      return null;
    }
    const id = r.body.orderId as string;
    const total = Number(r.body.order?.total);
    this.s.orders[ref] = { id, day: this.day, total, lines: ls };
    return { id, total };
  }

  async complete(ref: string, user: string, action: "complete" = "complete") {
    const o = this.s.orders[ref];
    const r = await api(user, "POST", `/api/orders/${o.id}/transition`, { action }, { "x-org-id": this.s.orgId });
    if (!r.ok) {
      this.note(`complete ${ref}`, r);
      console.warn(`  ! complete ${ref}: ${r.status} ${r.text.slice(0, 200)}`);
      return false;
    }
    return true;
  }

  /** Sell and settle in one go, journalling the money taken. */
  async sale(
    ref: string,
    user: string,
    loc: "main" | "second",
    ls: Line[],
    tender: Record<string, number> | string,
    extra: Record<string, unknown> = {},
    completer = user,
  ) {
    const single = typeof tender === "string";
    const paymentMethod = single ? (tender as string) : "split";
    const body: Record<string, unknown> = { ...extra };
    if (!single) body.payments = Object.entries(tender).map(([method, amount]) => ({ method, amount }));
    const placed = await this.place(ref, user, loc, ls, single ? (tender as string) : "cash", body);
    if (!placed) return null;
    const ok = await this.complete(ref, completer);
    const tenderMap = single ? { [tender as string]: placed.total } : (tender as Record<string, number>);
    this.s.journal.push({
      day: this.day,
      kind: ok ? "sale" : "open",
      orderRef: ref,
      orderId: placed.id,
      amount: placed.total,
      tender: tenderMap,
      location: loc,
      by: completer,
      taker: user,
      personalUse: paymentMethod === "personal_use",
    });
    return placed;
  }

  async refund(ref: string, user: string, lineIdx: number[], qty: number[], method: "original" | "cash" | "store_credit") {
    const o = this.s.orders[ref];
    const detail = await must(user, "GET", `/api/orders/${o.id}`, undefined, { "x-org-id": this.s.orgId });
    const items: any[] = detail.items ?? detail.order?.items ?? [];
    const lines = lineIdx.map((i, k) => ({ orderLineId: items[i]?.id, qty: qty[k] }));
    const r = await api(user, "POST", `/api/orders/${o.id}/refunds`, {
      reason: "damaged",
      refundMethod: method,
      lines,
    }, { "x-org-id": this.s.orgId });
    if (!r.ok) {
      this.note(`refund ${ref}`, r);
      console.warn(`  ! refund ${ref}: ${r.status} ${r.text.slice(0, 200)}`);
      return null;
    }
    const total = Number(r.body.refund?.total);
    // Ground truth: money goes back the way it came in. A card sale refunded
    // "to original" goes back to the card, not out of the drawer.
    const origTender = this.s.journal.find((j) => j.orderRef === ref && j.kind === "sale")?.tender ?? {};
    const via = method === "cash" ? "cash" : method === "store_credit" ? "store_credit" : Object.keys(origTender)[0] ?? "cash";
    this.s.journal.push({
      day: this.day,
      kind: "refund",
      orderRef: ref,
      orderId: o.id,
      amount: total,
      tender: { [via]: total },
      location: "main",
      by: user,
      note: `method=${method} stored=${r.body.refund?.refundMethod}`,
    });
    return total;
  }

  /**
   * A tab payment. Recording one is manager and above (the Credit List, Q11),
   * so at the counter the cashier takes the money into their drawer and a
   * manager records it: `taker` is whose drawer the cash physically went into.
   */
  async repay(ref: string, taker: string, amount: number, method: "cash" | "card", loc: "main" | "second" = "main") {
    const user = MANAGER;
    const o = this.s.orders[ref];
    const r = await api(user, "POST", `/api/credit/${o.id}/payments`, { amount, method }, this.hdr(loc));
    if (!r.ok) {
      this.note(`repay ${ref}`, r);
      console.warn(`  ! repay ${ref}: ${r.status} ${r.text.slice(0, 200)}`);
      return;
    }
    this.s.journal.push({ day: this.day, kind: "repayment", orderRef: ref, orderId: o.id, amount, tender: { [method]: amount }, location: loc, by: user, taker });
  }

  async closeTill(user: string, loc: "main" | "second") {
    const id = this.s.tills[`${this.day}:${user}`];
    if (!id) return;
    // Ground-truth drawer: float + cash taken + cash repayments − cash given back, by this person at this shop today.
    const float = loc === "main" ? 100 : 50;
    let cash = float;
    for (const j of this.s.journal) {
      if (j.day !== this.day || (j.taker ?? j.by) !== user || j.location !== loc) continue;
      const c = j.tender.cash ?? 0;
      if (j.kind === "sale" || j.kind === "open" || j.kind === "repayment") cash += c;
      if (j.kind === "refund") cash -= c;
    }
    const r = await api(user, "POST", `/api/shifts/${id}/close`, { closingCount: r2(cash), notes: "money audit" }, this.hdr(loc));
    if (!r.ok) this.note(`close till ${user}`, r);
    this.s.attempts.push({ day: this.day, what: `till ${user}@${loc} counted ${r2(cash)}`, status: r.status, body: JSON.stringify({ expectedCash: r.body?.expectedCash ?? r.body?.shift?.expectedCash, variance: r.body?.variance ?? r.body?.shift?.variance }) });
  }
}

async function tradeDay(i: number, last: number) {
  const s = load();
  const d = new Day(s, i, last);
  const isToday = i === last;
  console.log(`day ${i}${isToday ? " (today)" : ""}`);

  await d.openTill(CASHIER, "main", 100);
  await d.openTill(CASHIER2, "second", 50);

  // Every day: plain cash and card at both shops, a split, an unknown-cost line.
  await d.sale(`d${i}-cash`, CASHIER, "main", [{ product: "Widget", qty: 1 + (i % 3) }], "cash");
  await d.sale(`d${i}-card`, CASHIER, "main", [{ product: "Gadget", qty: 2 }], "card");
  await d.sale(`d${i}-split`, CASHIER, "main", [{ product: "Widget", qty: 1 }, { product: "Gadget", qty: 1 }], { cash: 15, card: 20 });
  await d.sale(`d${i}-c2cash`, CASHIER2, "second", [{ product: "Gizmo", qty: 2 }], "cash");
  await d.sale(`d${i}-c2card`, CASHIER2, "second", [{ product: "Widget", qty: 1 }], "card");

  if (i % 3 === 0) {
    await d.sale(`d${i}-tick`, CASHIER, "main", [{ product: "Gadget", qty: 1 }], "tick", { customerId: s.customers.alice });
  }
  if (i % 4 === 1) {
    await d.sale(`d${i}-cashtick`, CASHIER2, "second", [{ product: "Widget", qty: 3 }], { cash: 10, tick: 20 }, { customerId: s.customers.bob });
  }
  if (i % 5 === 2) {
    const tab = Object.keys(s.orders).filter((k) => k.endsWith("-tick") && s.orders[k].day < i).pop();
    if (tab) await d.repay(tab, CASHIER, 10, "cash");
  }
  if (i % 5 === 4) {
    const tab = Object.keys(s.orders).filter((k) => k.endsWith("-cashtick") && s.orders[k].day < i).pop();
    if (tab) await d.repay(tab, CASHIER2, 20, "card", "second");
  }
  if (i === 12) {
    // A tab payment recorded today but dated two days ago (a closed day).
    const tab = Object.keys(s.orders).filter((k) => k.endsWith("-tick") && s.orders[k].day < i - 2).pop();
    const cc = await api(MANAGER, "GET", "/api/control-centre", undefined, d.hdr("main"));
    if (tab && cc.body?.tradingDay) {
      const dt = new Date(`${cc.body.tradingDay}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - 2);
      const paidOn = dt.toISOString().slice(0, 10);
      const r = await api(MANAGER, "POST", `/api/credit/${s.orders[tab].id}/payments`, { amount: 5, method: "card", paidOn }, d.hdr("main"));
      d.note(`backdated tab payment on ${tab} dated ${paidOn}`, r);
      if (r.ok) s.journal.push({ day: i - 2, kind: "repayment", orderRef: tab, orderId: s.orders[tab].id, amount: 5, tender: { card: 5 }, location: "main", by: MANAGER, note: `recorded day ${i}, dated ${paidOn}` });
    }
  }
  if (i % 4 === 2 && s.promoCode) {
    await d.sale(`d${i}-promo`, CASHIER, "main", [{ product: "Gadget", qty: 2 }], "card", { promoCode: s.promoCode, customerId: s.customers.cara });
  }
  if (i % 3 === 1) {
    // Delivery: taken by the cashier, settled by the manager.
    await d.sale(`d${i}-delivery`, CASHIER, "main", [{ product: "Gadget", qty: 1 }, { product: "Widget", qty: 2 }], "card", { fulfilmentMethod: "delivery", deliveryAddress: "1 Test Road", deliveryPostcode: "TE1 2ST", customerId: s.customers.cara }, MANAGER);
  }
  if (i === 3) {
    await d.sale(`d${i}-personal`, CASHIER, "main", [{ product: "Widget", qty: 2 }], "personal_use", { personalUseReason: "Staff lunch test" });
  }
  if (i === 5) {
    const gc = await api(MANAGER, "POST", "/api/gift-cards", { amount: 30, reason: "Money audit gift card", customerId: s.customers.cara }, d.hdr("main"));
    if (gc.ok) s.giftCardCode = gc.body.code;
    else d.note("issue gift card", gc);
  }
  if ((i === 6 || i === 12) && s.giftCardCode) {
    await d.sale(`d${i}-gift`, CASHIER, "main", [{ product: "Widget", qty: i === 6 ? 2 : 1 }], "gift_card", { giftCardCode: s.giftCardCode, giftCardAmount: i === 6 ? 20 : 10, customerId: s.customers.cara });
  }
  if (i === 7) {
    // Below minimum: sold at 12 against a 15 floor.
    await d.sale(`d${i}-belowmin`, CASHIER, "main", [{ product: "Floor Item", qty: 1, price: 12 }], "cash");
  }
  if (i === 11) {
    // Admin steps in and completes the cashier's order: no commission.
    await d.sale(`d${i}-admin`, CASHIER, "main", [{ product: "Gadget", qty: 1 }], "cash", {}, ADMIN);
  }
  if (i === 14) {
    // Points: Cara redeems 100 points, if she has them.
    const cust = await api(MANAGER, "GET", `/api/customers/${s.customers.cara}`, undefined, d.hdr("main"));
    const pts = Number(cust.body?.loyaltyPoints ?? cust.body?.customer?.loyaltyPoints ?? 0);
    if (pts >= 100) {
      await d.sale(`d${i}-points`, CASHIER, "main", [{ product: "Gadget", qty: 1 }], "card", { customerId: s.customers.cara, redeemPoints: 100 });
    } else {
      s.attempts.push({ day: i, what: "points redeem skipped", status: 0, body: `points=${pts}` });
    }
  }

  // Refunds: yesterday's cash sale in full (to original), and today's card sale in part.
  if (i % 5 === 4 && s.orders[`d${i - 1}-cash`]) {
    const o = s.orders[`d${i - 1}-cash`];
    await d.refund(`d${i - 1}-cash`, CASHIER, [0], [o.lines![0].qty], "original");
  }
  if (i % 6 === 5) {
    await d.refund(`d${i}-card`, CASHIER, [0], [1], "original");
  }
  if (i === 9) {
    // Refund of a sale still on the credit list.
    const tab = Object.keys(s.orders).filter((k) => k.endsWith("-tick") && s.orders[k].day < i).pop();
    if (tab) await d.refund(tab, MANAGER, [0], [1], "original");
  }

  // A discounted sale refunded in part: one of two Gadgets from today's promo sale.
  if (i === 14 && s.orders[`d${i}-promo`]) {
    await d.refund(`d${i}-promo`, CASHIER, [0], [1], "cash");
  }
  // Void: an order taken in error and deleted the same day.
  if (i === 8) {
    const placed = await d.place(`d${i}-void`, CASHIER, "main", [{ product: "Widget", qty: 5 }], "cash");
    if (placed) {
      const r = await api(MANAGER, "DELETE", `/api/orders/${placed.id}`, undefined, d.hdr("main"));
      d.note("delete same-day open order", r);
    }
  }
  // Adversarial: delete a settled sale from a closed day.
  if (i === 10 && s.orders["d2-cash"]) {
    const r = await api(MANAGER, "DELETE", `/api/orders/${s.orders["d2-cash"].id}`, undefined, d.hdr("main"));
    d.note("delete settled order from a closed day (d2-cash)", r);
    if (r.ok) s.journal.push({ day: i, kind: "deleted", orderRef: "d2-cash", orderId: s.orders["d2-cash"].id, amount: s.orders["d2-cash"].total, tender: {}, location: "main", by: MANAGER });
  }
  // Adversarial: reopen a settled sale from a closed day.
  if (i === 10 && s.orders["d3-card"]) {
    const r = await api(MANAGER, "POST", `/api/orders/${s.orders["d3-card"].id}/transition`, { action: "reopen" }, d.hdr("main"));
    d.note("reopen settled order from a closed day (d3-card)", r);
  }

  // Edit after sale: reopen today's split-free card sale, add a Widget, settle again.
  if (i === 10) {
    const ref = `d${i}-card`;
    const o = s.orders[ref];
    const re = await api(MANAGER, "POST", `/api/orders/${o.id}/transition`, { action: "reopen" }, d.hdr("main"));
    d.note("reopen same-day sale", re);
    const ed = await api(MANAGER, "PUT", `/api/orders/${o.id}`, { lines: d.lines([{ product: "Gadget", qty: 2 }, { product: "Widget", qty: 1 }]) }, d.hdr("main"));
    d.note("edit reopened sale", ed);
    const done = await d.complete(ref, CASHIER);
    if (done && ed.ok) {
      const after = await must(MANAGER, "GET", `/api/orders/${o.id}`, undefined, d.hdr("main"));
      const newTotal = Number(after.total ?? after.order?.total);
      // The customer pays the difference by card.
      const j = s.journal.find((x) => x.orderRef === ref && x.kind === "sale")!;
      j.note = `edited ${j.amount} -> ${newTotal}`;
      j.tender = { card: newTotal };
      j.amount = newTotal;
    }
  }

  // Backdated: a sale from two days ago keyed in today.
  if (i === 14) {
    const r = await api(CASHIER, "GET", "/api/control-centre", undefined, d.hdr("main"));
    const today = r.body?.tradingDay as string;
    if (today) {
      const dt = new Date(`${today}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - 2);
      const orderDate = dt.toISOString().slice(0, 10);
      const placed = await d.place(`d${i}-backdated`, CASHIER, "main", [{ product: "Widget", qty: 4 }], "card", { orderDate });
      if (placed && (await d.complete(`d${i}-backdated`, CASHIER))) {
        s.journal.push({ day: i - 2, kind: "sale", orderRef: `d${i}-backdated`, orderId: placed.id, amount: placed.total, tender: { card: placed.total }, location: "main", by: CASHIER, note: `backdated to ${orderDate}` });
      }
    }
  }

  // Card (link): one left waiting for the customer, one paid via Stripe.
  if (i === 13 || i === 14) {
    const ref = `d${i}-link`;
    const placed = await d.place(ref, CASHIER, "main", [{ product: "Gadget", qty: 1 }], "card_link", { customerId: s.customers.cara });
    if (placed) {
      const link = await api(CASHIER, "POST", `/api/card-links/${placed.id}`, {}, d.hdr("main"));
      d.note(`make card link ${ref}`, link);
      if (i === 14 && link.ok) {
        const url: string = link.body?.url ?? link.body?.link?.url ?? "";
        const sessionId = url.split("/").pop();
        await payLink(s, placed.id, sessionId!, Math.round(placed.total * 100), link.body);
        if (await d.complete(ref, CASHIER)) {
          s.journal.push({ day: i, kind: "sale", orderRef: ref, orderId: placed.id, amount: placed.total, tender: { card_link: placed.total }, location: "main", by: CASHIER });
        }
      } else {
        s.journal.push({ day: i, kind: "open", orderRef: ref, orderId: placed.id, amount: placed.total, tender: {}, location: "main", by: CASHIER, note: "card link awaiting" });
      }
    }
  }

  // Open work: a delivery left for tomorrow on day 10, and one open today.
  if (i === 10 || isToday) {
    const ref = `d${i}-carried`;
    const placed = await d.place(ref, CASHIER, "main", [{ product: "Widget", qty: 1 }], "cash", { fulfilmentMethod: "delivery", deliveryAddress: "1 Test Road", deliveryPostcode: "TE1 2ST", customerId: s.customers.bob });
    if (placed) s.journal.push({ day: i, kind: "open", orderRef: ref, orderId: placed.id, amount: placed.total, tender: { cash: placed.total }, location: "main", by: CASHIER, note: "open overnight" });
  }
  if (i === 11 && s.orders["d10-carried"]) {
    if (await d.complete("d10-carried", MANAGER)) {
      const j = s.journal.find((x) => x.orderRef === "d10-carried")!;
      s.journal.push({ ...j, day: 11, kind: "sale", by: MANAGER, tender: {}, note: "settled the day after it was taken (cash taken on day 10)" });
    }
  }

  if (isToday && s.orders[`d${i}-carried`]) {
    const total = await d.refund(`d${i}-carried`, CASHIER, [0], [1], "cash");
    const j = s.journal.find((x) => x.kind === "refund" && x.orderRef === `d${i}-carried`);
    if (total && j) j.note = "unsettled order refunded";
  }
  if (isToday) {
    // Invoices for the awkward cases: a part-paid tab, a refunded sale, a
    // discounted sale, an open order and a card link still waiting.
    const refs = [
      Object.keys(s.orders).filter((k) => k.endsWith("-tick")).shift(),
      Object.keys(s.orders).filter((k) => k.endsWith("-cashtick")).shift(),
      "d5-card",
      Object.keys(s.orders).filter((k) => k.endsWith("-promo")).pop(),
      `d${i}-carried`,
      "d13-link",
    ].filter((r): r is string => !!r && !!s.orders[r]);
    for (const ref of refs) {
      const r = await api(MANAGER, "POST", `/api/invoices/for-order/${s.orders[ref].id}`, {}, d.hdr("main"));
      d.note(`invoice for ${ref}`, r);
    }
  }

  if (!isToday) {
    await d.closeTill(CASHIER, "main");
    await d.closeTill(CASHIER2, "second");
  }
  save(s);
}

async function payLink(s: State, orderId: string, sessionId: string, amountMinor: number, view: any) {
  const { signStripePayload } = await import("../../server/stripe/verify");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  // Read-only lookup of the ids the app put in the session metadata.
  const { rows } = await pool.query(
    `SELECT id, payment_id FROM card_payment_links WHERE session_id = $1`,
    [sessionId],
  );
  await pool.end();
  const link = rows[0];
  const event = {
    id: `evt_test_${Math.random().toString(36).slice(2, 12)}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        status: "complete",
        payment_status: "paid",
        amount_total: amountMinor,
        currency: "gbp",
        payment_intent: `pi_test_${Math.random().toString(36).slice(2, 10)}`,
        client_reference_id: orderId,
        metadata: { org_id: s.orgId, order_id: orderId, link_id: link?.id, payment_id: link?.payment_id },
      },
    },
  };
  const raw = JSON.stringify(event);
  const sig = signStripePayload(raw, process.env.STRIPE_WEBHOOK_SECRET ?? "", Math.floor(Date.now() / 1000));
  const { baseUrl } = await import("./client");
  const res = await fetch(`${baseUrl()}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sig },
    body: raw,
  });
  s.attempts.push({ day: -1, what: `stripe webhook paid ${orderId}`, status: res.status, body: (await res.text()).slice(0, 200) });
  void view;
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "setup") return setup();
  if (cmd === "day") return tradeDay(Number(a), Number(b));
  throw new Error("usage: setup | day <i> <last>");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
