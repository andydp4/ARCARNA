/**
 * Calls every GET route the server registers as a cashier, with real ids from
 * the money dataset, and lists any response that carries cost, margin,
 * profit or pay fields — figures a cashier must not see (COST_MIN_ROLE).
 *
 *   npx tsx tests/money/costCrawl.ts [role=CASHIER]
 */
import fs from "node:fs";
import path from "node:path";
import { api, SEED_USERS } from "./client";

const STATE = process.env.MONEY_STATE ?? "/tmp/money-state.json";
const s = JSON.parse(fs.readFileSync(STATE, "utf8"));
const role = (process.argv[2] ?? "CASHIER") as keyof typeof SEED_USERS;
const user = SEED_USERS[role];

const SENSITIVE = /"(costPrice|cost_price|unitCost|unit_cost|stockCost|stock_cost|cost|costTotal|totalCost|margin|marginPct|grossMargin|totalMargin|marginContributed|profit|netSalesProfit|net_sales_profit|businessRetainedProfit|commissionRate|commission_rate|payRate|hourlyRate|personalUseCost|refundCost|priceExceptionCost)"\s*:\s*(-?[0-9.]+|"[0-9.]+")/g;

function routes(): string[] {
  const dir = path.resolve(process.cwd(), "server/routes");
  const out = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/app\.get\(\s*["'`](\/api\/[^"'`]+)["'`]/g)) out.add(m[1]);
  }
  return [...out].sort();
}

function fill(p: string): string | null {
  const anyOrder = Object.values<any>(s.orders)[0]?.id;
  const ids: Record<string, string | undefined> = {
    ":id": anyOrder,
    ":orderId": anyOrder,
    ":customerId": s.customers?.alice,
    ":productId": s.products?.Widget?.id,
    ":userId": SEED_USERS.CASHIER,
    ":cashierId": SEED_USERS.CASHIER,
    ":locationId": s.mainId,
  };
  let out = p;
  for (const [k, v] of Object.entries(ids)) out = out.split(k).join(v ?? "x");
  if (/:[a-zA-Z]/.test(out)) return null;
  return out;
}

async function main() {
  const hits: string[] = [];
  for (const r of routes()) {
    const p = fill(r);
    if (!p || /stream|\.pdf|export|webhook/.test(p)) continue;
    const res = await api(user, "GET", p, undefined, { "x-org-id": s.orgId });
    if (!res.ok) continue;
    const found = new Set<string>();
    for (const m of res.text.matchAll(SENSITIVE)) {
      if (Number(String(m[2]).replace(/"/g, "")) !== 0) found.add(m[1]);
    }
    if (found.size) hits.push(`${res.status} GET ${r}  ->  ${[...found].join(", ")}`);
  }
  console.log(hits.length ? hits.join("\n") : `no cost, margin or pay figures reached ${role}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
